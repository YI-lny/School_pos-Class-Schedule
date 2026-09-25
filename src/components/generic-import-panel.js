/**
 * generic-import-panel —— 「通用教务系统导入」面板（最终版：简单、稳定、低复杂度）。
 *
 * 本版本的定位（明确不做的事）：
 *   ✗ 不开发浏览器扩展 / 本地辅助程序 / Native Messaging
 *   ✗ 不自动读取其它标签页的 DOM 或 Network Response
 *   ✗ 不接管学校 VPN / SSO 登录，不要求账号密码
 *   ✗ 不保存 Cookie / Token / Session / Authorization
 *
 * 因此第 7 步「获取课表数据」= 用户自己把数据带回来，面板只负责解析：
 *   ① 复制课表表格（HTML Importer，最推荐）
 *   ② 复制课表 JSON（JSON Importer）
 *   ③ 导出 / 粘贴 CSV（CSV Importer）
 *   → 统一 Course[] → 现有 Preview → 确认后替换当前课表。
 *
 * 安全边界：不要求账号密码、不读取密码、不保存任何登录凭据；
 * 用户填写的访问网址只存在内存里，刷新即忘。
 */

import { h, clear } from '../utils/dom.js';
import {
  BROWSER_SECURITY_NOTES,
  FLOW_STEP_LABELS,
  STEP_INDEX,
  createGenericFlow,
  importFile,
  importPayload,
} from '../core/importers/index.js';

/** 安全边界说明（常驻显示） */
const SECURITY_POINTS = [
  '不要求你输入账号密码，也没有任何账密输入框',
  '不读取、不保存你的密码',
  '不保存 Cookie / Session / Token / Authorization',
  'VPN、统一身份认证请在学校页面中自行完成，School_pos 不接管登录',
  '你填写的访问网址只存在内存里，刷新 School_pos 后即清空',
];

/** 三种把数据带回来的方式（文案按最终产品要求） */
const METHOD_DEFS = [
  {
    id: 'html',
    badge: '①',
    title: '复制课表表格',
    desc: '最简单的方法。在教务系统的课表页面选中课表 → 复制 → 回到 School_pos → 粘贴到下面。',
    placeholder: '请把教务系统课表表格复制并粘贴到这里……',
    actionText: '解析课表',
    format: 'html',
    recommended: true,
  },
  {
    id: 'json',
    badge: '②',
    title: '复制课表 JSON',
    desc: '打开浏览器开发者工具 → 网络（Network）→ 找到课表相关请求 → 复制响应 JSON → 粘贴到下面。',
    placeholder: '请粘贴课表接口返回的 JSON……',
    actionText: '解析 JSON',
    format: 'json',
  },
  {
    id: 'csv',
    badge: '③',
    title: '导入 CSV',
    desc: '如果学校系统支持导出课表，请导出 CSV；如果只能导出 Excel，请先另存为 CSV，再上传。',
    placeholder: '也可以直接粘贴 CSV 文本（第一行是表头）',
    actionText: '解析 CSV',
    format: 'csv',
  },
];

/**
 * @param {object} options
 * @param {(result:object)=>void} options.onPreviewReady 解析成功 → 交给现有预览
 * @param {(error:Error)=>void} options.onError 解析失败 → 交给现有错误提示
 */
export function createGenericImportPanel({ onPreviewReady, onError } = {}) {
  const flow = createGenericFlow({ onChange: () => render() });
  let method = 'html';
  let openAttempted = false;

  /* ------------------------------------------------------------------ 元素 */

  const stepList = h('ol', { class: 'generic__steps' });

  /* ---- 第一步：进入学校系统 ---- */
  const urlInput = h('input', {
    class: 'generic__input',
    type: 'url',
    inputmode: 'url',
    placeholder: 'https://vpn.example.edu.cn/  或  https://jwglxt.example.edu.cn/',
    dataset: { role: 'url' },
    onInput: (event) => flow.setUrl(event.target.value),
  });

  const openBtn = h('button', {
    class: 'import-btn import-btn--primary',
    type: 'button',
    dataset: { action: 'open-target' },
    text: '打开',
    onClick: () => openTarget(),
  });

  const entryBlock = h('section', { class: 'generic__block' }, [
    h('h3', { class: 'generic__section-title', text: '进入学校系统' }),
    h('label', { class: 'generic__label', text: '学校访问入口网址' }),
    h('div', { class: 'generic__row' }, [urlInput, openBtn]),
    h('p', {
      class: 'generic__note',
      text: 'School_pos 只负责打开网址。登录、VPN 和统一身份认证请在学校页面中自行完成。',
    }),
  ]);

  /* ---- 里程碑 ---- */
  const milestoneHint = h('p', { class: 'generic__text' });
  const mkBtn = (action, text, handler) =>
    h('button', {
      class: 'import-btn import-btn--ghost',
      type: 'button',
      dataset: { action },
      text,
      onClick: handler,
    });

  const authBtn = mkBtn('mark-auth', '我已完成学校认证（VPN / 统一身份认证）', () => flow.markAuthDone());
  const jwxtBtn = mkBtn('mark-jwxt', '我已进入教务系统', () => flow.markInJwxt());
  const courseBtn = mkBtn('mark-course', '我已打开课表页面', () => flow.markCoursePageReady());
  const backBtn = mkBtn('mark-back', '我已回到 School_pos', () => flow.markBackToSchoolPos());

  const milestoneBlock = h('div', { class: 'generic__block', dataset: { panel: 'milestones' }, hidden: true }, [
    milestoneHint,
    h('div', { class: 'generic__row' }, [authBtn, jwxtBtn, courseBtn, backBtn]),
  ]);

  /* ---- 第二步：获取课表数据（三种方式） ---- */
  const methodCards = METHOD_DEFS.map((def) =>
    h('button', {
      class: ['generic__method', def.id === method ? 'is-active' : ''],
      type: 'button',
      dataset: { method: def.id },
      onClick: () => selectMethod(def.id),
    }, [
      h('span', { class: 'generic__method-head' }, [
        h('span', { class: 'generic__method-badge', text: def.badge }),
        h('b', { class: 'generic__method-title', text: def.title }),
        def.recommended ? h('span', { class: 'generic__method-tag', text: '推荐' }) : null,
      ]),
      h('span', { class: 'generic__method-desc', text: def.desc }),
    ]),
  );
  const methodGrid = h('div', { class: 'generic__methods' }, methodCards);

  const textarea = h('textarea', {
    class: 'import-textarea',
    rows: '7',
    spellcheck: 'false',
    dataset: { role: 'payload' },
    onInput: (event) => {
      flow.markFetchingData();
      flow.receiveData(event.target.value);
    },
  });

  const parseBtn = h('button', {
    class: 'import-btn import-btn--primary',
    type: 'button',
    dataset: { action: 'parse-payload' },
    onClick: () => parsePayload(),
  });

  const fileInput = h('input', {
    class: 'import-file',
    id: 'generic-import-file',
    type: 'file',
    accept: '.csv,.txt,text/csv',
    dataset: { role: 'file' },
    onChange: (event) => handleFile(event),
  });
  const fileLabel = h('label', { class: 'import-filebtn', for: 'generic-import-file' }, ['选择 CSV 文件']);
  fileLabel.addEventListener('click', (event) => {
    event.preventDefault();
    fileInput.click();
  });

  const formatRow = h('div', { class: 'generic__formats', dataset: { panel: 'formats' }, hidden: true });

  const collectBlock = h('section', { class: 'generic__block', dataset: { panel: 'collect' } }, [
    h('h3', { class: 'generic__section-title', text: '获取课表数据' }),
    h('p', {
      class: 'generic__text',
      text: '当前版本无法直接读取另一个标签页中的教务系统内容，这是浏览器的安全限制。请使用下面任意一种方式把课表数据带回 School_pos：',
    }),
    methodGrid,
    h('p', {
      class: 'generic__warn',
      text: '只需要课表内容本身：请不要复制 Cookie、Authorization、Session 等登录凭据，School_pos 不需要它们，也不会保存它们。',
    }),
    textarea,
    h('div', { class: 'generic__row' }, [parseBtn, fileLabel, fileInput]),
    formatRow,
    h('details', { class: 'generic__why' }, [
      h('summary', { text: '为什么不能自动读取？（技术说明）' }),
      h('ul', { class: 'generic__why-list' }, BROWSER_SECURITY_NOTES.map((note) =>
        h('li', {}, [h('b', { text: `${note.mechanism}：` }), h('span', { text: note.detail })]),
      )),
    ]),
  ]);

  /* ---- 安全边界 ---- */
  const securityBlock = h('section', { class: 'generic__security' }, [
    h('b', { class: 'generic__security-title', text: '安全边界' }),
    h('ul', {}, SECURITY_POINTS.map((text) => h('li', { text }))),
  ]);

  const el = h('div', { class: 'generic', dataset: { pane: 'generic' } }, [
    stepList,
    entryBlock,
    milestoneBlock,
    collectBlock,
    securityBlock,
  ]);

  /* ------------------------------------------------------------------ 行为 */

  /** 用户从学校标签页切回来时自动识别（真实 focus 事件） */
  function handleWindowFocus() {
    if (!openAttempted) return;
    const state = flow.getState();
    if (['opened', 'auth-done', 'in-jwxt', 'course-page-ready'].includes(state.step)) {
      flow.markBackToSchoolPos();
    }
  }

  function openTarget() {
    const current = flow.getState();
    if (!current.url) {
      onError?.(new Error('请先填写学校访问入口网址'));
      return;
    }

    openAttempted = true;
    try {
      // 只负责打开；拿到句柄后立刻切断 opener 关系，不做任何读取
      const handle = window.open(current.url, '_blank');
      if (handle) handle.opener = null;
    } catch {
      /* 弹窗被拦截也不影响后续流程：用户可手动打开 */
    }

    window.addEventListener('focus', handleWindowFocus);
    flow.markOpened();
    render();
  }

  function selectMethod(id) {
    method = id;
    flow.markFetchingData();
    render();
  }

  async function handleFile(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
      const result = await importFile(file);
      flow.markFetchingData();
      flow.markPreview();
      onPreviewReady?.(result);
    } catch (error) {
      onError?.(error);
    } finally {
      try {
        if (event.target) event.target.value = '';
      } catch {
        /* ignore */
      }
    }
  }

  function parsePayload() {
    const def = METHOD_DEFS.find((item) => item.id === method) ?? METHOD_DEFS[0];
    const text = textarea.value;
    if (!text.trim()) {
      onError?.(new Error('请先把课表内容粘贴到上面'));
      return;
    }
    try {
      // 三种方式都走现有 Importer：html / json / csv
      const result = importPayload(text, def.format);
      flow.markPreview();
      onPreviewReady?.(result);
    } catch (error) {
      onError?.(error);
    }
  }

  /* ------------------------------------------------------------------ 渲染 */

  function renderSteps(state) {
    const activeIndex = STEP_INDEX[state.step] ?? 0;
    clear(stepList);
    FLOW_STEP_LABELS.forEach((step, index) => {
      stepList.appendChild(
        h(
          'li',
          {
            class: ['generic__step', index < activeIndex ? 'is-done' : '', index === activeIndex ? 'is-active' : ''],
            dataset: { step: step.key },
            title: step.hint,
          },
          [
            h('span', { class: 'generic__step-index', text: String(index + 1) }),
            h('span', { class: 'generic__step-dot' }),
            h('span', { text: step.text }),
          ],
        ),
      );
    });
  }

  function renderMilestones(state) {
    const show = ['opened', 'auth-done', 'in-jwxt', 'course-page-ready', 'back-to-school-pos'].includes(state.step);
    milestoneBlock.hidden = !show;
    if (!show) return;

    const hints = {
      opened: `已在新标签页打开 ${state.host}。请在那个标签页里自行完成学校认证（VPN / 统一身份认证 / 校园网）。`,
      'auth-done': '认证完成后，从学校入口点进教务系统。',
      'in-jwxt': '进入教务系统后，打开「课表查询 / 我的课表」这类页面。',
      'course-page-ready': '课表页面打开后，切回 School_pos（会自动识别），或点「我已回到 School_pos」。',
      'back-to-school-pos': '接下来在下面选择一种方式，把课表数据带回来。',
    };
    milestoneHint.textContent = hints[state.step] ?? '';

    authBtn.disabled = !state.canMarkAuthDone;
    jwxtBtn.disabled = !state.canMarkInJwxt;
    courseBtn.disabled = !state.canMarkCoursePageReady;
    backBtn.disabled = !state.canMarkBack;
  }

  function renderCollect(state) {
    // 三种带回方式常驻显示：即使不打开学校系统，也可以直接用 JSON / CSV
    const show = state.step !== 'imported';
    collectBlock.hidden = !show;
    if (!show) return;

    const def = METHOD_DEFS.find((item) => item.id === method) ?? METHOD_DEFS[0];
    for (const card of methodCards) {
      card.classList.toggle('is-active', card.dataset.method === method);
    }
    textarea.placeholder = def.placeholder;
    parseBtn.textContent = def.actionText;
    fileLabel.hidden = def.id !== 'csv';
    fileInput.hidden = def.id !== 'csv';

    const showFormats = state.formats.length > 1 && !['preview', 'imported'].includes(state.step);
    formatRow.hidden = !showFormats;
    if (!showFormats) return;

    clear(formatRow);
    formatRow.appendChild(h('span', { class: 'generic__text', text: '识别到多种格式，请选择一种：' }));
    for (const format of state.formats) {
      formatRow.appendChild(
        h('button', {
          class: ['import-btn', 'import-btn--ghost', state.selectedFormat === format.format ? 'is-armed' : ''],
          type: 'button',
          dataset: { format: format.format },
          text: format.label,
          onClick: () => flow.chooseFormat(format.format),
        }),
      );
    }
  }

  function render() {
    const state = flow.getState();
    renderSteps(state);
    renderMilestones(state);
    renderCollect(state);

    openBtn.disabled = !state.canOpen;
    openBtn.textContent = state.step === 'idle' || state.step === 'url-entered' ? '打开' : '重新打开';
  }

  function reset() {
    openAttempted = false;
    window.removeEventListener('focus', handleWindowFocus);
    textarea.value = '';
    method = 'html';
    flow.reset();
    render();
  }

  render();

  return { el, reset, flow };
}
