/**
 * generic-flow.js —— 「通用教务系统导入」的状态机（纯逻辑，可在 Node 里测试）。
 *
 * 面向**需要学校 VPN / 统一身份认证 / 校园网入口**的情况：
 * 学校入口（VPN / SSO） → 教务系统 → 课表页 这三段都由用户自己在新标签页里完成，
 * School_pos 只负责"打开网址"和"把数据带回来"，不接管任何登录过程。
 *
 * 状态流（与 UI 步骤条一一对应）：
 *   1 输入学校访问入口      idle → url-entered
 *   2 打开学校访问入口      opened
 *   3 自行完成认证(VPN/SSO) auth-done
 *   4 进入教务系统          in-jwxt
 *   5 进入课表页面          course-page-ready
 *   6 回到 School_pos       back-to-school-pos
 *   7 提取                  extracting →（读得到）discovered-data /（读不到）blocked
 *   8 带回数据              discovered-data
 *   9 选择格式              select-format
 *  10 预览导入              preview → confirm → imported
 *
 * 安全约束（写死在流程里）：
 *   - 只保存学校入口 URL，不保存任何账号、密码、Cookie、Token、Session、Authorization；
 *   - URL 也只存在于内存里，不写入 localStorage，刷新即忘；
 *   - 只用于 window.open 打开与一次探测，不做任何带凭据的请求。
 */

export const FLOW_STEPS = [
  'idle',
  'url-entered',
  'opened',
  'auth-done',
  'in-jwxt',
  'course-page-ready',
  'back-to-school-pos',
  /** 正在挑选/粘贴，对应步骤 7「获取课表数据」（本版本=用户自己从学校页面把数据带回来） */
  'fetching-data',
  'extracting',
  'blocked',
  'discovered-data',
  'select-format',
  'preview',
  'confirm',
  'imported',
];

/** UI 步骤条（10 步，与最终产品流程一一对应，编号唯一） */
export const FLOW_STEP_LABELS = [
  { key: 'url', text: '输入学校访问入口', hint: '可以是 VPN / 统一身份认证 / 教务系统入口' },
  { key: 'opened', text: '打开学校访问入口', hint: 'School_pos 只负责打开网址，不接管登录' },
  { key: 'auth', text: '自行完成学校认证', hint: 'VPN / 统一身份认证都由你在学校页面完成' },
  { key: 'jwxt', text: '进入教务系统', hint: '从学校入口点进教务系统' },
  { key: 'course', text: '进入课表页面', hint: '打开「课表查询 / 我的课表」页面' },
  { key: 'back', text: '回到 School_pos', hint: '切回本页面即可（会自动识别）' },
  { key: 'fetch', text: '获取课表数据', hint: '本版本由你自己把数据带回来：复制表格 / 复制 JSON / 导出 CSV' },
  { key: 'bring', text: '带回数据', hint: '把内容粘贴到下面，School_pos 负责解析' },
  { key: 'format', text: '选择格式', hint: '识别到多种格式时由你决定' },
  { key: 'preview', text: '预览导入', hint: '确认后替换当前课表' },
];

/** 状态 → 步骤条高亮位置（0 起） */
export const STEP_INDEX = {
  idle: 0,
  'url-entered': 0,
  opened: 1,
  'auth-done': 2,
  'in-jwxt': 3,
  'course-page-ready': 4,
  'back-to-school-pos': 5,
  'fetching-data': 6,
  'discovered-data': 7,
  'select-format': 8,
  preview: 9,
  confirm: 9,
  imported: 9,
  // 下面两个状态当前 UI 不再使用（保留给"自动读取"类方案将来复用）
  extracting: 6,
  blocked: 6,
};

/** 允许 http/https，其它一律拒绝（避免 javascript: 之类的伪协议） */
export function normalizeTargetUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return { ok: false, reason: '请输入学校访问入口网址' };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: '这不是一个有效的网址' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: '只支持 http / https 网址' };
  }

  return { ok: true, url: url.toString(), host: url.host, origin: url.origin };
}

/**
 * 从一段文本里判断它可能是什么格式（给 discovered-data / select-format 用）。
 * 只做"格式识别"，不做业务解析。
 * @returns {Array<{format:string,label:string,confidence:string}>}
 */
export function detectFormats(text) {
  const value = String(text ?? '').trim();
  if (!value) return [];

  const found = [];
  const looksJson = value.startsWith('[') || value.startsWith('{');
  if (looksJson) found.push({ format: 'json', label: 'JSON', confidence: 'high' });
  if (/<table\b[^>]*>/i.test(value)) found.push({ format: 'html', label: 'HTML 表格', confidence: 'high' });

  const firstLine = value.split(/\r?\n/)[0] ?? '';
  if (!looksJson && /[,\t;]/.test(firstLine)) {
    found.push({ format: 'csv', label: 'CSV / 分隔文本', confidence: 'medium' });
  }

  return found;
}

/**
 * @param {object} [options]
 * @param {(state:object)=>void} [options.onChange]
 */
export function createGenericFlow({ onChange = null } = {}) {
  const state = {
    step: 'idle',
    url: '',
    host: '',
    origin: '',
    /** 当前环境检测报告（只在内存里，不持久化） */
    probe: null,
    /** 各个里程碑是否完成（全部由用户自己确认，School_pos 不代劳） */
    authDone: false,
    inJwxt: false,
    coursePageReady: false,
    backToSchoolPos: false,
    /** 发现的数据格式候选 */
    formats: [],
    /** 用户选定的格式 */
    selectedFormat: null,
    /** 用户手工带回来的原始文本（不落盘） */
    payload: '',
    error: null,
    history: [],
  };

  const listeners = new Set();

  function snapshot() {
    return {
      ...state,
      formats: [...state.formats],
      canOpen: state.step === 'url-entered' || state.step === 'opened',
      canMarkAuthDone: state.step === 'opened',
      canMarkInJwxt: state.step === 'auth-done',
      canMarkCoursePageReady: state.step === 'in-jwxt',
      canMarkBack: state.step === 'course-page-ready',
      canExtract: ['course-page-ready', 'back-to-school-pos'].includes(state.step),
      /** 是否已经进入"获取课表数据"这一步（选了方式或开始粘贴） */
      canFetchData: ['course-page-ready', 'back-to-school-pos'].includes(state.step),
      canManualInput: [
        'course-page-ready',
        'back-to-school-pos',
        'fetching-data',
        'blocked',
        'extracting',
        'discovered-data',
        'select-format',
      ].includes(state.step),
      canChooseFormat: state.step === 'select-format' && state.formats.length > 1,
      canPreview:
        state.step === 'select-format' ||
        (state.step === 'discovered-data' && state.formats.length === 1),
    };
  }

  function emit() {
    const snap = snapshot();
    if (onChange) onChange(snap);
    for (const listener of listeners) listener(snap);
  }

  function go(step, patch = {}) {
    Object.assign(state, patch, { step });
    state.history.push(step);
    emit();
    return snapshot();
  }

  /** ① 输入学校访问入口（VPN / 统一身份认证 / 教务系统入口都可以） */
  function setUrl(input) {
    const result = normalizeTargetUrl(input);
    if (!result.ok) {
      state.error = result.reason;
      state.step = 'idle';
      emit();
      return { ok: false, reason: result.reason };
    }
    state.error = null;
    state.url = result.url;
    state.host = result.host;
    state.origin = result.origin;
    go('url-entered');
    return { ok: true, url: result.url, host: result.host, origin: result.origin };
  }

  /** ② 打开学校访问入口（真正调用 window.open 由 UI 负责） */
  function markOpened() {
    if (!state.url) return { ok: false, reason: '还没有输入学校访问入口网址' };
    go('opened');
    return { ok: true };
  }

  /** ③ 用户表示已自行完成学校认证（VPN / 统一身份认证 / 校园网） */
  function markAuthDone() {
    state.authDone = true;
    go('auth-done');
    return { ok: true };
  }

  /** ④ 用户表示已进入教务系统 */
  function markInJwxt() {
    state.inJwxt = true;
    go('in-jwxt');
    return { ok: true };
  }

  /** ⑤ 用户表示已打开课表页面 */
  function markCoursePageReady() {
    state.coursePageReady = true;
    go('course-page-ready');
    return { ok: true };
  }

  /**
   * ⑥ 回到 School_pos。
   * 由真实的窗口焦点事件触发（用户切回来时自动识别），也可由按钮手动确认。
   */
  function markBackToSchoolPos() {
    if (state.backToSchoolPos) return { ok: true, already: true };
    state.backToSchoolPos = true;
    // 只有在还没有进入提取流程时才推进步骤，避免把之后的步骤拉回来
    if (['opened', 'auth-done', 'in-jwxt', 'course-page-ready'].includes(state.step)) {
      go('back-to-school-pos');
    } else {
      emit();
    }
    return { ok: true };
  }

  /** ⑦ 进入「获取课表数据」这一步（本版本=用户自己把数据带回来，不自动读取） */
  function markFetchingData() {
    if (['course-page-ready', 'back-to-school-pos'].includes(state.step)) {
      go('fetching-data');
    }
    return { ok: true };
  }

  /** 开始提取（自动读取方案预留；当前版本 UI 不调用） */
  function markExtracting() {
    go('extracting');
    return { ok: true };
  }

  /**
   * ⑥ 探测结束：能读到数据 → discovered-data；读不到 → blocked（不伪造成功）
   * @param {object} probe  browser-capabilities.probeTarget() 的结果
   */
  function finishExtract(probe) {
    state.probe = probe;
    if (probe?.readable && probe?.text) {
      return receiveData(probe.text, probe.detectedFormat ?? null);
    }
    state.formats = [];
    state.selectedFormat = null;
    return go('blocked');
  }

  /**
   * 用户从教务系统带回来的数据（粘贴 / 上传 / 适配器 / 扩展），
   * 统一从这里进入 discovered-data → select-format。
   */
  function receiveData(text, preferredFormat = null) {
    const value = String(text ?? '');
    state.payload = value;
    state.formats = detectFormats(value);

    if (state.formats.length === 0) {
      state.error = '无法识别这段内容的格式';
      return go('blocked');
    }

    if (state.formats.length === 1) {
      state.selectedFormat = state.formats[0].format;
      state.error = null;
      return go('discovered-data');
    }

    if (preferredFormat && state.formats.some((f) => f.format === preferredFormat)) {
      state.selectedFormat = preferredFormat;
      state.error = null;
      return go('discovered-data');
    }

    state.selectedFormat = null;
    state.error = null;
    return go('select-format');
  }

  /** ⑦ 选择格式（多候选时） */
  function chooseFormat(format) {
    if (!state.formats.some((f) => f.format === format)) {
      return { ok: false, reason: '这个格式不在已发现的候选里' };
    }
    state.selectedFormat = format;
    go('select-format');
    return { ok: true, format };
  }

  /** 进入现有预览（真正的 importPayload 由 UI 调用） */
  function markPreview() {
    return go('preview');
  }

  function markConfirm() {
    return go('confirm');
  }

  function markImported() {
    return go('imported');
  }

  function reset() {
    Object.assign(state, {
      step: 'idle',
      url: '',
      host: '',
      origin: '',
      probe: null,
      authDone: false,
      inJwxt: false,
      coursePageReady: false,
      backToSchoolPos: false,
      formats: [],
      selectedFormat: null,
      payload: '',
      error: null,
      history: [],
    });
    emit();
    return snapshot();
  }

  return {
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setUrl,
    markOpened,
    markAuthDone,
    markInJwxt,
    markCoursePageReady,
    markBackToSchoolPos,
    markFetchingData,
    markExtracting,
    finishExtract,
    receiveData,
    chooseFormat,
    markPreview,
    markConfirm,
    markImported,
    reset,
    /** 仅用于测试断言 */
    steps: FLOW_STEPS,
    stepLabels: FLOW_STEP_LABELS,
  };
}
