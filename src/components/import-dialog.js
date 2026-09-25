/**
 * import-dialog —— 「导入课表」面板。
 *
 * 三个入口（第一阶段新增前两个）：
 *   ① 学校专用导入        —— 已安装的 SchoolAdapter 列表（当前为空，如实说明）
 *   ② 通用教务系统导入    —— 状态机 + 真实能力探测 + 手工带回数据（HTML/JSON/CSV）
 *   ③ JSON / CSV 文件导入 —— 原有实现，行为不变（粘贴 / 选择文件）
 *
 * 职责边界：
 *   - 只调用 core/importers 的公开接口，拿到的一定是统一 Course[]；
 *   - 不解析任何学校原始数据，也不直接改 UI；
 *   - 导入前一定先预览，用户点「导入这些课程」才调用 store.importCourses()。
 */

import { h, clear } from '../utils/dom.js';
import {
  IMPORTERS,
  ImportError,
  getSchoolAdapters,
  importFile,
  importFromSchool,
  importPayload,
} from '../core/importers/index.js';
import { findConflictingCourseIds } from '../core/layout-engine.js';
import { isCourseInWeek } from '../core/week-utils.js';
import { createPdfImportPanel } from './pdf-import-panel.js';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * @param {object} options
 * @param {object} options.store course-store
 * @param {(state:object)=>void} [options.onImported] 导入成功后的回调（便于刷新页面其它部分）
 */
export function createImportDialog({ store, onImported = null } = {}) {
  /** 顶层入口：'school' | 'generic' | 'files' */
  let method = 'files';
  /** 文件导入里的子入口：'json' | 'csv'（保持原有行为） */
  let fileMethod = 'json';
  let step = 'input'; // input | preview | done
  let result = null;
  let errorInfo = null;
  let restoreArmed = false;
  let doneInfo = null;

  /* ------------------------------------------------------------------ 结构 */

  const title = h('h2', { class: 'import-modal__title', id: 'import-dialog-title', text: '导入课表' });
  const subtitle = h('p', {
    class: 'import-modal__sub',
    text: '导入后先预览，确认无误再替换课表',
  });

  const closeBtn = h('button', {
    class: 'import-modal__close',
    type: 'button',
    'aria-label': '关闭',
    title: '关闭',
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    onClick: () => close(),
  });

  const head = h('header', { class: 'import-modal__head' }, [
    h('div', { class: 'import-modal__head-text' }, [title, subtitle]),
    closeBtn,
  ]);

  /* ---- 顶层三个入口：学校专用 / 通用教务系统 / JSON·CSV 文件 ---- */
  const METHOD_LABELS = {
    school: '学校专用',
    pdf: 'PDF 课表导入',
    files: 'JSON / CSV 文件导入',
  };

  const methodButtons = ['school', 'pdf', 'files'].map((id) =>
    h('button', {
      class: ['import-method', id === method ? 'is-active' : ''],
      type: 'button',
      role: 'tab',
      dataset: { method: id },
      text: METHOD_LABELS[id],
      onClick: () => selectMethod(id),
    }),
  );
  const methods = h('div', { class: 'import-methods', role: 'tablist' }, methodButtons);

  /* ---- 文本 / 文件输入面板 ---- */
  const textareas = {};
  const fileInputs = {};
  const panes = {};

  const SOURCE_HINT = {
    json: '支持课程数组，或 { "courses": [ ... ] }；字段名中英文都可以',
    csv: '首行表头，列名可用：课程名称 / 教师 / 教室 / 星期 / 开始节次 / 结束节次 / 周次',
    school: '',
  };

  for (const importer of IMPORTERS) {
    const id = importer.id;

    textareas[id] = h('textarea', {
      class: 'import-textarea',
      rows: '7',
      spellcheck: 'false',
      placeholder:
        id === 'json'
          ? '[\n  { "name": "Java高级编程", "teacher": "邓军", "room": "K-408", "weekday": 3, "startSection": 3, "endSection": 5, "weeks": "1-16" }\n]'
          : '课程名称,教师,教室,星期,开始节次,结束节次,周次\nJava高级编程,邓军,K-408,周三,3,5,1-16',
    });

    /*
     * 文件选择：<label for="..."> + <input id="..."> 必须成对。
     * 之前 input 没有 id，而 label 上写了 for="import-file-xxx"，
     * 按 HTML 规范：label 一旦有 for，就以 for 指向的元素为准；
     * 找不到对应 id 时 label 没有"被标注控件"，点击 label 什么都不会发生 —— 这正是"点击没反应"的原因。
     */
    const fileInputId = `import-file-${id}`;

    fileInputs[id] = h('input', {
      class: 'import-file',
      id: fileInputId,
      type: 'file',
      accept: importer.accept || '',
      dataset: { method: id },
      onChange: (event) => handleFile(event, id),
    });

    const fileLabel = h('label', { class: 'import-filebtn', for: fileInputId }, ['选择文件']);

    // 双保险：即使某些浏览器对 for/id 的处理有差异，也保证点击一定打开文件选择框
    fileLabel.addEventListener('click', (event) => {
      event.preventDefault();
      fileInputs[id].click();
    });

    panes[id] = h('div', { class: 'import-pane import-pane--file', dataset: { pane: id }, hidden: id !== fileMethod }, [
      h('div', { class: 'import-row' }, [fileLabel, fileInputs[id], h('span', { class: 'import-or', text: '或直接粘贴内容' })]),
      textareas[id],
      h('p', { class: 'import-hint', text: SOURCE_HINT[id] }),
      h('div', { class: 'import-actions' }, [
        h('button', {
          class: 'import-btn import-btn--primary',
          type: 'button',
          dataset: { action: 'parse' },
          text: '解析并预览',
          onClick: () => parseText(id),
        }),
      ]),
    ]);
  }

  /* ---- ③ JSON / CSV 文件导入：子切换 + 原有的两个面板（行为完全不变） ---- */
  const fileMethodButtons = IMPORTERS.map((importer) =>
    h('button', {
      class: ['import-submethod', importer.id === fileMethod ? 'is-active' : ''],
      type: 'button',
      dataset: { fileMethod: importer.id },
      text: importer.id === 'json' ? 'JSON' : 'CSV',
      onClick: () => selectFileMethod(importer.id),
    }),
  );

  const filesPane = h('div', { class: 'import-pane', dataset: { pane: 'files' } }, [
    h('div', { class: 'import-submethods' }, [
      h('span', { class: 'import-submethods__label', text: '格式：' }),
      ...fileMethodButtons,
    ]),
    ...IMPORTERS.map((importer) => panes[importer.id]),
  ]);
  panes.files = filesPane;

  /* ---- ① 学校专用导入（没有适配器时如实说明） ---- */
  const schoolPane = h('div', { class: 'import-pane', dataset: { pane: 'school' }, hidden: true });
  panes.school = schoolPane;

  /* ---- ② PDF 课表导入（浏览器本地解析，不外传） ---- */
  const pdfPanel = createPdfImportPanel({
    onPreviewReady: (importResult) => showPreview(importResult),
    onError: (error) => {
      handleError(error);
      renderState();
    },
  });
  const pdfPane = h('div', { class: 'import-pane', dataset: { pane: 'pdf' }, hidden: true }, [pdfPanel.el]);
  panes.pdf = pdfPane;

  /* ---- 错误提示 ---- */
  const errorTitle = h('strong', { class: 'import-alert__title', text: '无法识别该课表格式' });
  const errorHint = h('p', { class: 'import-alert__hint' });
  const alertBox = h('div', { class: 'import-alert', hidden: true }, [errorTitle, errorHint]);

  /* ---- 预览 ---- */
  const previewSummary = h('div', { class: 'import-preview__summary' });
  const previewTable = h('table', { class: 'import-table' });
  const previewScroll = h('div', { class: 'import-preview__scroll' }, [previewTable]);

  const modeInputs = ['replace', 'merge'].map((value) =>
    h('label', { class: 'import-mode__item' }, [
      h('input', {
        type: 'radio',
        name: 'import-mode',
        value,
        checked: value === 'replace',
        onChange: () => updateConfirmLabel(),
      }),
      h('span', { text: value === 'replace' ? '替换现有课表' : '合并到现有课表' }),
    ]),
  );
  const modeRow = h('div', { class: 'import-mode' }, [
    h('span', { class: 'import-mode__label', text: '导入方式：' }),
    ...modeInputs,
  ]);

  const previewBox = h('div', { class: 'import-preview', hidden: true }, [
    previewSummary,
    previewScroll,
    modeRow,
  ]);

  /* ---- 完成 ---- */
  const doneBox = h('div', { class: 'import-done', hidden: true });

  const body = h('div', { class: 'import-modal__body' }, [
    methods,
    schoolPane,
    pdfPane,
    filesPane,
    alertBox,
    previewBox,
    doneBox,
  ]);

  /* ---- 底部 ---- */
  const restoreBtn = h('button', {
    class: 'import-btn import-btn--ghost',
    type: 'button',
    dataset: { action: 'restore' },
    text: '恢复示例课表',
    onClick: () => handleRestore(),
  });

  const cancelBtn = h('button', {
    class: 'import-btn import-btn--ghost',
    type: 'button',
    dataset: { action: 'cancel' },
    text: '取消',
    onClick: () => close(),
  });

  const confirmBtn = h('button', {
    class: 'import-btn import-btn--primary',
    type: 'button',
    dataset: { action: 'confirm' },
    text: '导入这些课程',
    onClick: () => confirmImport(),
  });

  const foot = h('footer', { class: 'import-modal__foot' }, [
    restoreBtn,
    h('div', { class: 'import-modal__foot-right' }, [cancelBtn, confirmBtn]),
  ]);

  const card = h(
    'section',
    {
      class: 'import-modal__card',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'import-dialog-title',
    },
    [head, body, foot],
  );

  const backdrop = h('div', { class: 'import-modal__backdrop', onClick: () => close() });
  const el = h('div', { class: 'import-modal', hidden: true, dataset: { open: 'false' } }, [
    backdrop,
    card,
  ]);

  /* ------------------------------------------------------------------ 行为 */

  /** 顶层入口切换：school / generic / files */
  function selectMethod(id) {
    method = id;
    step = 'input';
    errorInfo = null;
    for (const button of methodButtons) {
      button.classList.toggle('is-active', button.dataset.method === id);
    }
    if (id === 'school') renderSchoolPane();
    updateVisibility();
    renderState();
  }

  /** 文件导入里的 JSON / CSV 子切换（行为与以前一致） */
  function selectFileMethod(id) {
    fileMethod = id;
    step = 'input';
    errorInfo = null;
    for (const button of fileMethodButtons) {
      button.classList.toggle('is-active', button.dataset.fileMethod === id);
    }
    updateVisibility();
    renderState();
  }

  /** 面板显隐统一在这里处理（预览 / 完成状态下隐藏所有输入面板） */
  function updateVisibility() {
    const showInput = step === 'input';
    panes.school.hidden = !(showInput && method === 'school');
    panes.pdf.hidden = !(showInput && method === 'pdf');
    panes.files.hidden = !(showInput && method === 'files');
    panes.json.hidden = fileMethod !== 'json';
    panes.csv.hidden = fileMethod !== 'csv';
  }

  /** 通用教务系统面板解析成功后，直接复用现有预览流程 */
  function showPreview(importResult) {
    result = importResult;
    step = 'preview';
    errorInfo = null;
    renderState();
  }

  function parseText(id) {
    const text = textareas[id]?.value ?? '';
    try {
      result = importPayload(text, id);
      step = 'preview';
      errorInfo = null;
    } catch (error) {
      handleError(error);
    }
    renderState();
  }

  async function handleFile(event, id) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
      result = await importFile(file);
      step = 'preview';
      errorInfo = null;
    } catch (error) {
      handleError(error);
    } finally {
      // 允许重复选择同一个文件；即使浏览器不允许清空也不能影响导入结果
      try {
        if (event.target) event.target.value = '';
      } catch {
        /* ignore */
      }
    }
    renderState();
  }

  function handleError(error) {
    step = 'input';
    result = null;
    if (error instanceof ImportError) {
      errorInfo = { message: error.message, hint: error.hint };
      console.error('[课表导入] 解析失败：', error.message, error.hint, error.detail ?? '');
    } else {
      errorInfo = {
        message: '无法识别该课表格式',
        hint: '请导入学校教务系统导出的课表文件，或选择对应学校。',
      };
      console.error('[课表导入] 未预期错误：', error);
    }
  }

  function selectedMode() {
    const checked = modeInputs
      .map((label) => label.querySelector('input'))
      .find((input) => input.checked);
    return checked?.value === 'merge' ? 'merge' : 'replace';
  }

  /** 确认按钮跟着"替换 / 合并"的选择走，避免语义含糊 */
  function updateConfirmLabel() {
    confirmBtn.textContent = selectedMode() === 'merge' ? '合并到现有课表' : '替换当前课表';
  }

  function confirmImport() {
    if (!result?.courses?.length) return;

    const mode = selectedMode();
    const info = store.importCourses(result.courses, { source: result.source, mode });

    const state = store.getState();
    // 周次判断统一用 week-utils.isCourseInWeek（不再自己解析 weeks 字符串）
    const visibleThisWeek = result.courses.filter((course) => isCourseInWeek(course, state.viewingWeek)).length;

    doneInfo = {
      count: result.courses.length,
      mode,
      duplicates: result.duplicates,
      warnings: result.issues?.warnings ?? [],
      viewingWeek: state.viewingWeek,
      visibleThisWeek,
      saved: Boolean(state.savedAt),
      source: info?.source ?? result.source,
    };
    step = 'done';
    errorInfo = null;
    renderState();
    onImported?.(store.getState());
  }

  function handleRestore() {
    if (!restoreArmed) {
      restoreArmed = true;
      restoreBtn.textContent = '确认恢复？';
      restoreBtn.classList.add('is-armed');
      setTimeout(() => {
        if (!restoreArmed) return;
        restoreArmed = false;
        restoreBtn.textContent = '恢复示例课表';
        restoreBtn.classList.remove('is-armed');
      }, 4000);
      return;
    }

    restoreArmed = false;
    restoreBtn.textContent = '恢复示例课表';
    restoreBtn.classList.remove('is-armed');
    store.restoreSampleTimetable();
    doneInfo = { restored: true, count: store.getState().courseCount };
    step = 'done';
    result = null;
    errorInfo = null;
    renderState();
    onImported?.(store.getState());
  }

  function renderSchoolPane() {
    clear(schoolPane);
    const adapters = getSchoolAdapters();

    if (adapters.length === 0) {
      schoolPane.appendChild(
        h('div', { class: 'import-notice' }, [
          h('strong', {
            class: 'import-notice__title',
            text: '暂无已安装的学校适配器，可以使用 PDF 课表导入。',
          }),
          h('p', {
            class: 'import-notice__text',
            text:
              '学校专用适配器需要针对具体学校实现（登录方式、课表接口、字段映射都不一样）。' +
              '目前还没有为任何学校安装适配器，也没有写死任何学校的地址或接口。',
          }),
          h('div', { class: 'import-actions' }, [
            h('button', {
              class: 'import-btn import-btn--ghost',
              type: 'button',
              dataset: { action: 'goto-pdf' },
              text: '改用 PDF 课表导入',
              onClick: () => selectMethod('pdf'),
            }),
          ]),
          h('p', {
            class: 'import-notice__text',
            text:
              '如果你提供学校教务系统的网址、课表页面截图、以及开发者工具里的请求信息，' +
              '就可以按 src/core/importers/adapters/index.js 里的模板为这所学校实现适配器，' +
              '装好后它会自动出现在这里。',
          }),
        ]),
      );
      return;
    }

    // 有适配器时才渲染选择与登录（框架已就绪，等具体学校适配器接入）
    const select = h(
      'select',
      { class: 'import-select' },
      adapters.map((adapter) => h('option', { value: adapter.id, text: adapter.label })),
    );
    const fields = adapters[0].needs ?? [];
    const inputs = fields.map((field) =>
      h('input', { class: 'import-input', type: 'text', placeholder: field, dataset: { need: field } }),
    );

    schoolPane.appendChild(
      h('div', { class: 'import-school' }, [
        h('label', { class: 'import-field' }, [h('span', { text: '学校' }), select]),
        ...inputs.map((input) => h('label', { class: 'import-field' }, [input])),
        h('div', { class: 'import-actions' }, [
          h('button', {
            class: 'import-btn import-btn--primary',
            type: 'button',
            dataset: { action: 'school-connect' },
            text: '连接并导入',
            onClick: async () => {
              try {
                const credentials = {};
                for (const input of inputs) credentials[input.dataset.need] = input.value;
                result = await importFromSchool(select.value, { credentials });
                step = 'preview';
                errorInfo = null;
              } catch (error) {
                handleError(error);
              }
              renderState();
            },
          }),
        ]),
      ]),
    );
  }

  function renderPreview() {
    clear(previewTable);
    if (!result) return;

    const conflicting = findConflictingCourseIds(result.courses);
    const conflicts = result.courses.filter((course) => conflicting.has(course.id)).length;

    clear(previewSummary);
    previewSummary.appendChild(
      h('span', {}, [
        document.createTextNode('发现 '),
        h('b', { text: String(result.courses.length) }),
        document.createTextNode(' 门课程'),
      ]),
    );
    if (result.duplicates) {
      previewSummary.appendChild(h('span', { class: 'import-preview__note', text: `· 已忽略 ${result.duplicates} 条重复` }));
    }
    if (conflicts > 0) {
      previewSummary.appendChild(
        h('span', { class: 'import-preview__warn', text: `⚠ ${conflicts} 门课程存在时间冲突（会并排显示）` }),
      );
    }

    previewTable.appendChild(
      h('thead', {}, [
        h('tr', {}, [
          h('th', { text: '课程名称' }),
          h('th', { text: '教师' }),
          h('th', { text: '教室' }),
          h('th', { text: '星期' }),
          h('th', { text: '节次' }),
          h('th', { text: '周次' }),
        ]),
      ]),
    );

    const tbody = h('tbody', {});
    for (const course of result.courses) {
      const hasConflict = conflicting.has(course.id);
      tbody.appendChild(
        h('tr', { class: hasConflict ? 'is-conflict' : '', dataset: { courseId: course.id } }, [
          h('td', { class: 'import-table__name' }, [
            hasConflict ? h('span', { class: 'import-table__flag', title: '时间冲突', text: '⚠' }) : null,
            document.createTextNode(course.name),
          ]),
          h('td', { text: course.teacher || '—' }),
          h('td', { text: course.room || '—' }),
          h('td', { text: WEEKDAY_LABELS[course.weekday - 1] ?? '—' }),
          h('td', { text: `${course.startSection}-${course.endSection}节` }),
          h('td', { text: `${course.weeks}周` }),
        ]),
      );
    }
    previewTable.appendChild(tbody);
  }

  function renderDone() {
    clear(doneBox);
    if (!doneInfo) return;

    if (doneInfo.restored) {
      doneBox.appendChild(
        h('div', { class: 'import-done__box' }, [
          h('strong', { text: '已恢复示例课表' }),
          h('p', {
            class: 'import-done__text',
            text: `当前显示 ${doneInfo.count} 门示例课程，本地保存的用户课表已清除。`,
          }),
        ]),
      );
      return;
    }

    doneBox.appendChild(
      h('div', { class: 'import-done__box' }, [
        h('strong', { text: `已导入 ${doneInfo.count} 门课程` }),
        h('p', {
          class: 'import-done__text',
          text:
            (doneInfo.mode === 'merge' ? '已合并到现有课表' : '已替换现有课表') +
            (doneInfo.saved ? '，并已保存到本地（刷新后仍在）' : '（本地保存失败，刷新后会恢复示例课表）'),
        }),
        doneInfo.visibleThisWeek === 0
          ? h('p', {
              class: 'import-done__hint',
              text: `提示：当前查看的第 ${doneInfo.viewingWeek} 周里没有这些课程，可以用「上一周 / 下一周」切换，或看看导入数据里的周次设置。`,
            })
          : null,
        doneInfo.warnings?.length
          ? h('p', { class: 'import-done__hint', text: `有 ${doneInfo.warnings.length} 条提醒，详见控制台。` })
          : null,
      ]),
    );
  }

  function renderState() {
    const showPreview = step === 'preview' && Boolean(result);
    const showDone = step === 'done' && Boolean(doneInfo);

    previewBox.hidden = !showPreview;
    doneBox.hidden = !showDone;
    alertBox.hidden = !errorInfo;

    updateVisibility();
    methods.hidden = showDone;

    if (errorInfo) {
      errorTitle.textContent = errorInfo.message;
      errorHint.textContent = errorInfo.hint || '';
    }

    if (showPreview) renderPreview();
    if (showDone) renderDone();
    updateConfirmLabel();

    confirmBtn.hidden = !showPreview;
    confirmBtn.disabled = !showPreview;
    restoreBtn.hidden = showDone;
    cancelBtn.textContent = showDone ? '完成' : '取消';
    subtitle.textContent = showDone
      ? '完成'
      : showPreview
        ? `发现 ${result.courses.length} 门课程，确认后再写入课表`
        : '导入后先预览，确认无误再替换课表';
  }

  function open() {
    el.hidden = false;
    el.dataset.open = 'true';
    step = 'input';
    errorInfo = null;
    doneInfo = null;
    result = null;
    selectMethod(method);
    requestAnimationFrame(() => textareas[method]?.focus?.());
  }

  function close() {
    el.hidden = true;
    el.dataset.open = 'false';
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && !el.hidden) close();
  }
  document.addEventListener('keydown', handleKeydown);

  renderSchoolPane();
  renderState();

  return {
    el,
    open,
    close,
    isOpen: () => !el.hidden,
    destroy: () => document.removeEventListener('keydown', handleKeydown),
  };
}
