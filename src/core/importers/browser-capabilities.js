/**
 * browser-capabilities.js —— 通用教务系统导入的「当前环境检测」。
 *
 * 设计原则：
 *   1. 结果必须来自**实际检测**，不是预设结论；
 *   2. 检测不出来就报「无法确定」，绝不把"没测"写成"失败"，也绝不把失败写成成功；
 *   3. 一律用 origin（协议 + 主机 + 端口）比较来判断能不能读 DOM，
 *      不是"window.open 成功了就能读"；
 *   4. 只输出用户看得懂的结论 + 少量证据，不堆术语。
 *
 * 安全约定（务必保持）：
 *   - 所有探测请求 credentials:'omit'，绝不携带 / 读取 / 保存任何登录凭据；
 *   - 不读 document.cookie，不碰 localStorage，日志里不写敏感信息；
 *   - 只针对用户自己填写的学校入口网址，且只在用户点「开始提取课表」之后执行。
 */

/** 能力状态：三种，缺一不可（"无法确定"必须与"不可用"区分开） */
export const CAPABILITY = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
};

export const CAPABILITY_LABELS = {
  [CAPABILITY.AVAILABLE]: '可用',
  [CAPABILITY.UNAVAILABLE]: '不可用',
  [CAPABILITY.UNKNOWN]: '无法确定',
};

/** 四项能力的显示名与说明（简洁，用户可以看懂） */
export const CAPABILITY_ROWS = [
  { key: 'pageDom', label: '页面 DOM（School_pos 自己）' },
  { key: 'crossTabDom', label: '跨标签页 DOM（学校系统页面）' },
  { key: 'crossTabNetwork', label: '跨标签页 Network Response' },
  { key: 'crossOriginFetch', label: '跨源请求读取（fetch）' },
];

/**
 * 为什么做不到 —— 用大白话解释（常驻显示，不再折叠成空的 details）
 */
export const BROWSER_SECURITY_NOTES = [
  {
    id: 'sop',
    mechanism: '同源策略',
    detail:
      '只有"协议 + 域名 + 端口"完全相同，两个页面才算同源。学校教务系统通常和 School_pos 不同源，' +
      '所以 School_pos 读不到那个标签页里的内容。',
  },
  {
    id: 'cors',
    mechanism: '跨源请求（CORS）',
    detail:
      '网页向别的域名发请求时，除非对方服务器明确允许，浏览器会把响应内容藏起来。' +
      '所以即使网络能连通，也拿不到里面的 JSON / HTML。',
  },
  {
    id: 'framing',
    mechanism: 'iframe 嵌入限制',
    detail: '多数学校系统禁止被别的网站用 iframe 套进来，所以"嵌进来再读"这条路也走不通。',
  },
  {
    id: 'cookie',
    mechanism: '登录凭据（Cookie / SSH 单点登录）',
    detail:
      '学校系统的登录状态保存在它自己域下的 Cookie 里，通常带 HttpOnly 与 SameSite 限制，' +
      '别的网站既读不到也带不上。VPN、反向代理、统一身份认证（SSO）都属于这种情况，' +
      '必须由你在学校页面上自己完成，School_pos 不接管、也不需要你的密码。',
  },
  {
    id: 'network',
    mechanism: '跨标签页的网络响应',
    detail:
      '网页平台没有给普通页面提供"读取另一个标签页请求结果"的接口。' +
      '要做到自动读取，需要浏览器扩展、本地辅助程序，或学校提供允许跨源的接口（学校专用适配器）。',
  },
];

const ABOUT_BLANK = 'about:blank';

export function isBrowserEnvironment() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** 取 origin（协议 + 主机 + 端口）；取不到返回 null */
export function safeOrigin(url) {
  try {
    return new URL(url, isBrowserEnvironment() ? window.location.href : undefined).origin;
  } catch {
    return null;
  }
}

/** 两个地址是否同源（协议 / 主机 / 端口逐项比较，交给 URL.origin） */
export function isSameOrigin(a, b) {
  const oa = safeOrigin(a);
  const ob = safeOrigin(b);
  return Boolean(oa && ob && oa === ob);
}

/**
 * 带超时的 fetch。超时通过 abort / reject 表达，绝不在 setTimeout 里 throw。
 */
async function fetchWithTimeout(doFetch, url, options, timeoutMs) {
  if (typeof AbortController === 'function') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  let timer = null;
  try {
    return await Promise.race([
      doFetch(url, options),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('请求超时'), { name: 'AbortError' })),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function describeError(error) {
  if (!error) return '未知错误';
  if (error.name === 'AbortError') return '请求超时';
  if (error.name === 'TypeError') return '请求被浏览器拦下（跨源限制）或网络不可达';
  return `${error.name}: ${error.message}`;
}

/**
 * 检查 window.open() 拿到的窗口能不能读 DOM。
 *
 * ⚠️ 关键：不能因为"窗口打开了"就说"可以读取"。
 *    - 刚打开时窗口往往还是 about:blank（同源！），这时读 document 会误判为"可读"；
 *    - 必须看 **location.href 的 origin**：读得到且与 School_pos 同源才叫可读；
 *      读 location 直接抛 SecurityError，就说明确定是跨源窗口 → 不可读。
 *
 * @param {Window|null} openedWindow
 * @param {string} [targetUrl] 期望打开的目标地址
 */
export function probeOpenedWindow(openedWindow, targetUrl = '') {
  if (!openedWindow) {
    return {
      status: CAPABILITY.UNKNOWN,
      reason: '新标签页被浏览器拦下（弹窗拦截）或未打开，没有拿到窗口句柄，无法检测',
    };
  }

  try {
    if (openedWindow.closed) {
      return { status: CAPABILITY.UNKNOWN, reason: '目标标签页已关闭，无法检测' };
    }
  } catch {
    /* closed 访问失败就继续往下判断 */
  }

  let href = null;
  try {
    href = openedWindow.location.href;
  } catch (error) {
    return {
      status: CAPABILITY.UNAVAILABLE,
      reason: '读取该窗口的地址就抛 SecurityError → 确认是跨源窗口，DOM 读不到（同源策略）',
    };
  }

  if (!href || href.startsWith('about:')) {
    return {
      status: CAPABILITY.UNKNOWN,
      reason: '目标页面还没开始加载（当前仍是空白页），暂时无法确定，可稍后再试',
    };
  }

  const openedOrigin = safeOrigin(href);
  const selfOrigin = isBrowserEnvironment() ? window.location.origin : null;

  if (openedOrigin && selfOrigin && openedOrigin === selfOrigin) {
    return { status: CAPABILITY.AVAILABLE, reason: `与 School_pos 同源（${openedOrigin}），可以直接读取 DOM` };
  }

  const targetOrigin = targetUrl ? safeOrigin(targetUrl) : null;
  return {
    status: CAPABILITY.UNAVAILABLE,
    reason: `跨源窗口（${openedOrigin}${targetOrigin ? `，目标 ${targetOrigin}` : ''}）与 School_pos 不同源，DOM 读不到`,
  };
}

/** 检测是否装了配套的浏览器扩展 / 本地辅助程序（没有就如实说没有） */
export function detectHelperBridge() {
  if (!isBrowserEnvironment()) return null;
  if (window.__SCHOOL_POS_BRIDGE__) return '浏览器扩展';
  if (window.__SCHOOL_POS_LOCAL_HELPER__) return '本地辅助程序';
  return null;
}

/**
 * 评估当前环境的能力矩阵。
 *
 * @param {string} targetUrl 用户填写的学校访问入口
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] 注入 fetch（测试用）
 * @param {number}  [options.timeoutMs]
 * @param {Window}  [options.openedWindow] window.open 拿到的句柄（不传则按同源性判断）
 * @param {boolean} [options.checkNetwork=true] 是否真的发请求探测
 */
export async function assessCapabilities(targetUrl, options = {}) {
  const { fetchImpl = null, timeoutMs = 5000, openedWindow, checkNetwork = true } = options;

  const capabilities = {
    pageDom: { status: CAPABILITY.UNKNOWN, reason: '' },
    crossTabDom: { status: CAPABILITY.UNKNOWN, reason: '' },
    crossTabNetwork: { status: CAPABILITY.UNKNOWN, reason: '' },
    crossOriginFetch: { status: CAPABILITY.UNKNOWN, reason: '' },
  };
  const evidence = [];

  /* 非浏览器环境（例如 Node 测试）：如实说明，不假装 */
  if (!isBrowserEnvironment()) {
    return {
      environment: 'non-browser',
      capabilities,
      sameOrigin: null,
      conclusion: '当前不是浏览器环境，无法进行跨源检测。',
      readable: false,
      text: null,
      evidence,
      notes: BROWSER_SECURITY_NOTES,
      verdict: 'unsupported',
      headline: '当前不是浏览器环境，无法进行跨源检测。',
    };
  }

  const selfOrigin = window.location.origin;
  const targetOrigin = safeOrigin(targetUrl);
  const sameOrigin = Boolean(targetOrigin && targetOrigin === selfOrigin);

  /* ① 页面 DOM（本页）——直接读一下自己的文档 */
  try {
    const ok = Boolean(document.documentElement && document.title !== undefined);
    capabilities.pageDom = ok
      ? { status: CAPABILITY.AVAILABLE, reason: 'School_pos 自己的页面可以直接读取' }
      : { status: CAPABILITY.UNAVAILABLE, reason: '读取本页 DOM 失败' };
  } catch (error) {
    capabilities.pageDom = { status: CAPABILITY.UNAVAILABLE, reason: `读取本页 DOM 抛错：${error.message}` };
  }

  /* ② 跨标签页 DOM ——靠 origin 判断，不靠"窗口是否打开成功" */
  if (openedWindow === undefined) {
    capabilities.crossTabDom = sameOrigin
      ? { status: CAPABILITY.UNKNOWN, reason: '目标与 School_pos 同源，但还没有打开页面，暂时无法确定' }
      : {
          status: CAPABILITY.UNAVAILABLE,
          reason: `目标 ${targetOrigin ?? '(无法解析)'} 与 School_pos（${selfOrigin}）不同源，受同源策略限制读不到 DOM`,
        };
  } else {
    capabilities.crossTabDom = probeOpenedWindow(openedWindow, targetUrl);
  }
  evidence.push({ key: 'crossTabDom', status: capabilities.crossTabDom.status, reason: capabilities.crossTabDom.reason });

  /* ③ 跨标签页 Network Response ——先看有没有扩展 / 本地辅助程序 */
  const bridge = detectHelperBridge();
  capabilities.crossTabNetwork = bridge
    ? { status: CAPABILITY.AVAILABLE, reason: `检测到${bridge}，可由它读取学校页面已经加载的数据` }
    : {
        status: CAPABILITY.UNAVAILABLE,
        reason: '未检测到浏览器扩展 / 本地辅助程序；网页本身没有读取其它标签页网络响应的接口',
      };
  evidence.push({
    key: 'crossTabNetwork',
    status: capabilities.crossTabNetwork.status,
    reason: capabilities.crossTabNetwork.reason,
  });

  /* ④ 跨源请求读取 ——真发一次请求看结果 */
  const doFetch = fetchImpl ?? (typeof window.fetch === 'function' ? window.fetch.bind(window) : null);

  if (!checkNetwork || typeof doFetch !== 'function') {
    capabilities.crossOriginFetch = {
      status: CAPABILITY.UNKNOWN,
      reason: typeof doFetch === 'function' ? '本次没有发起网络检测' : '当前环境没有可用的 fetch',
    };
  } else {
    try {
      const response = await fetchWithTimeout(
        doFetch,
        targetUrl,
        { mode: 'cors', credentials: 'omit', redirect: 'follow' },
        timeoutMs,
      );
      const text = await response.text();
      capabilities.crossOriginFetch = {
        status: CAPABILITY.AVAILABLE,
        reason: `已读到响应内容（HTTP ${response.status}，${text.length} 字）`,
      };
      evidence.push({ key: 'corsFetch', status: CAPABILITY.AVAILABLE, reason: capabilities.crossOriginFetch.reason });
      return buildReport({
        capabilities,
        evidence,
        sameOrigin,
        selfOrigin,
        targetOrigin,
        readable: true,
        text,
      });
    } catch (error) {
      const isTimeout = error && error.name === 'AbortError';

      // 再用 no-cors 探一次：能通就说明"只是读不到内容"，而不是网络不通
      let reachable = null;
      try {
        const opaque = await fetchWithTimeout(
          doFetch,
          targetUrl,
          { mode: 'no-cors', credentials: 'omit', redirect: 'follow' },
          timeoutMs,
        );
        reachable = `能连通（opaque 响应 type=${opaque.type}、status=${opaque.status}），但内容被浏览器藏起来，读不到`;
      } catch (error2) {
        reachable = `也连不通：${describeError(error2)}`;
        evidence.push({ key: 'noCorsFetch', status: CAPABILITY.UNKNOWN, reason: reachable });
      }
      if (reachable && !reachable.startsWith('也连不通')) {
        evidence.push({ key: 'noCorsFetch', status: CAPABILITY.AVAILABLE, reason: reachable });
      }

      capabilities.crossOriginFetch = isTimeout
        ? {
            status: CAPABILITY.UNKNOWN,
            reason: `请求超时，无法判断是被安全策略拦下还是网络不可达（${reachable}）`,
          }
        : { status: CAPABILITY.UNAVAILABLE, reason: `${describeError(error)}；${reachable}` };
    }
  }

  evidence.push({
    key: 'crossOriginFetch',
    status: capabilities.crossOriginFetch.status,
    reason: capabilities.crossOriginFetch.reason,
  });

  return buildReport({ capabilities, evidence, sameOrigin, selfOrigin, targetOrigin, readable: false, text: null });
}

function buildReport({ capabilities, evidence, sameOrigin, selfOrigin, targetOrigin, readable, text }) {
  const canReadDom = capabilities.crossTabDom.status === CAPABILITY.AVAILABLE;
  const canReadFetch = capabilities.crossOriginFetch.status === CAPABILITY.AVAILABLE;
  const canReadTabNetwork = capabilities.crossTabNetwork.status === CAPABILITY.AVAILABLE;
  const readableNow = readable || canReadDom || canReadFetch || canReadTabNetwork;

  const conclusion = readableNow
    ? '当前环境可以读取该地址的数据，可以直接提取。'
    : '当前浏览器环境无法直接读取该学校系统的数据（受浏览器同源策略限制）。请用下面的三种方式把数据带回来；' +
      '如果需要自动读取，需要浏览器扩展、本地辅助程序，或学校提供可跨源访问的接口。';

  return {
    environment: 'browser',
    capabilities,
    evidence,
    sameOrigin,
    selfOrigin,
    targetOrigin,
    readable: readableNow,
    text: text ?? null,
    conclusion,
    notes: BROWSER_SECURITY_NOTES,
    /** 兼容旧字段 */
    verdict: readableNow ? 'readable' : 'blocked',
    headline: conclusion,
  };
}

/**
 * 兼容旧调用：等价于 assessCapabilities()。
 * @deprecated 新代码请用 assessCapabilities()
 */
export function probeTarget(url, options = {}) {
  return assessCapabilities(url, options);
}

/**
 * 把能力矩阵整理成 UI 直接可渲染的 4 行（每项只有 可用 / 不可用 / 无法确定）。
 */
export function summarizeProbe(report) {
  if (!report?.capabilities) return [];
  return CAPABILITY_ROWS.map((row) => {
    const entry = report.capabilities[row.key] ?? { status: CAPABILITY.UNKNOWN, reason: '' };
    return {
      key: row.key,
      label: row.label,
      status: entry.status,
      statusLabel: CAPABILITY_LABELS[entry.status] ?? '无法确定',
      reason: entry.reason ?? '',
    };
  });
}
