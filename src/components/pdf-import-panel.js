/**
 * pdf-import-panel —— 「PDF 课表导入」面板。
 *
 * 流程（全部在浏览器本地完成，PDF 不上传、不保存）：
 *   选择/拖入 PDF → 开始解析 → 显示"已识别 XX 个课程安排" → 预览导入
 *   → 复用现有 Import Preview → 确认 → course-store → 课表显示
 *
 * 不涉及：学校网址、登录、VPN、Cookie、Token、自动读取其它标签页。
 */

import { h, clear } from '../utils/dom.js';
import { importPdfFile } from '../core/importers/index.js';

/** @param {object} options @param {(result:object)=>void} options.onPreviewReady @param {(error:Error)=>void} options.onError */
export function createPdfImportPanel({ onPreviewReady, onError } = {}) {
  let file = null;
  let result = null;
  let busy = false;

  const fileNameEl = h('p', { class: 'pdf__filename', dataset: { role: 'filename' }, hidden: true });
  const hintEl = h('p', { class: 'pdf__hint', dataset: { role: 'hint' }, text: '支持：PDF（学校教务系统导出的课表文件）' });
  const countEl = h('p', { class: 'pdf__count', dataset: { role: 'count' }, hidden: true });

  const fileInput = h('input', {
    class: 'import-file',
    id: 'pdf-import-file',
    type: 'file',
    accept: '.pdf,application/pdf',
    dataset: { role: 'file' },
    onChange: (event) => pickFile(event.target?.files?.[0] ?? null),
  });

  const pickLabel = h('label', { class: 'import-filebtn', for: 'pdf-import-file' }, ['选择 PDF 文件']);
  pickLabel.addEventListener('click', (event) => {
    event.preventDefault();
    fileInput.click();
  });

  const parseBtn = h('button', {
    class: 'import-btn import-btn--primary',
    type: 'button',
    dataset: { action: 'parse-pdf' },
    text: '开始解析',
    disabled: true,
    onClick: () => parsePdf(),
  });

  const previewBtn = h('button', {
    class: 'import-btn import-btn--primary',
    type: 'button',
    dataset: { action: 'pdf-preview' },
    text: '预览导入',
    hidden: true,
    onClick: () => {
      if (result) onPreviewReady?.(result);
    },
  });

  const dropZone = h('div', { class: 'pdf__drop', dataset: { role: 'drop' } }, [
    h('span', { class: 'pdf__drop-title', text: '或者将 PDF 拖到这里' }),
    pickLabel,
    fileInput,
  ]);

  const clearBtn = h('button', {
    class: 'import-btn import-btn--ghost',
    type: 'button',
    dataset: { action: 'pdf-clear' },
    text: '重新选择',
    hidden: true,
    onClick: () => reset(),
  });

  const el = h('div', { class: 'pdf', dataset: { pane: 'pdf' } }, [
    h('h3', { class: 'generic__section-title', text: 'PDF 课表导入' }),
    h('p', {
      class: 'generic__text',
      text: '请上传学校教务系统导出的课表 PDF。文件只在你的浏览器里解析，不会上传到任何服务器，也不会被保存。',
    }),
    dropZone,
    fileNameEl,
    hintEl,
    h('div', { class: 'generic__row' }, [parseBtn, previewBtn, clearBtn]),
    countEl,
  ]);

  /* ---------------------------------------------------------------- 交互 */

  function setHint(text, kind = '') {
    hintEl.textContent = text;
    hintEl.className = `pdf__hint${kind ? ` is-${kind}` : ''}`;
  }

  function pickFile(nextFile) {
    if (!nextFile) return;
    file = nextFile;
    result = null;
    busy = false;

    fileNameEl.hidden = false;
    fileNameEl.textContent = `文件名：${nextFile.name}`;
    countEl.hidden = true;
    previewBtn.hidden = true;
    clearBtn.hidden = false;
    parseBtn.disabled = false;

    if (!/\.pdf$/i.test(nextFile.name) && !String(nextFile.type ?? '').includes('pdf')) {
      parseBtn.disabled = true;
      setHint(
        '这不是 PDF 文件。如果学校导出的是 Excel，请先另存为 CSV，用「JSON / CSV 文件导入」导入。',
        'error',
      );
      return;
    }
    setHint('文件已就绪，点「开始解析」在本地解析这份 PDF。');
  }

  async function parsePdf() {
    if (!file || busy) return;
    busy = true;
    parseBtn.disabled = true;
    parseBtn.textContent = '正在解析…';
    setHint('正在浏览器本地解析 PDF…');

    try {
      result = await importPdfFile(file);
      countEl.hidden = false;
      countEl.textContent = `已识别 ${result.courses.length} 个课程安排`;
      previewBtn.hidden = false;
      setHint('解析完成。点「预览导入」查看课程列表，确认后再替换课表。', 'ok');
    } catch (error) {
      result = null;
      previewBtn.hidden = true;
      countEl.hidden = true;
      setHint(error?.message ?? '解析失败', 'error');
      onError?.(error);
      console.error('[PDF 导入] 解析失败：', error?.message, error?.hint ?? '', error?.detail ?? '');
    } finally {
      busy = false;
      parseBtn.textContent = '开始解析';
      parseBtn.disabled = false;
      try {
        fileInput.value = '';
      } catch {
        /* ignore */
      }
    }
  }

  function reset() {
    file = null;
    result = null;
    busy = false;
    fileNameEl.hidden = true;
    countEl.hidden = true;
    previewBtn.hidden = true;
    clearBtn.hidden = true;
    parseBtn.disabled = true;
    setHint('支持：PDF（学校教务系统导出的课表文件）');
    try {
      fileInput.value = '';
    } catch {
      /* ignore */
    }
  }

  /* ---- 拖拽 ---- */
  for (const type of ['dragenter', 'dragover']) {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-over');
    });
  }
  dropZone.addEventListener('drop', (event) => {
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) pickFile(dropped);
  });

  return { el, reset };
}
