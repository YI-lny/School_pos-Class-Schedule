/**
 * pdf-importer.js —— PDF 课表导入器（浏览器本地解析，不上传、不保存）。
 *
 * 数据流（与其它导入方式完全一致）：
 *   PDF File → pdf-text(pdf.js) → 带坐标文本项 → schedule-parser → 原始行
 *            → 统一 Course[]（course-model.normalizeCourses）→ 现有 Preview → course-store
 *
 * 注意：PDF 解析是异步的，而 Importer.parse() 是同步契约，
 * 因此这里提供 parseAsync(file)，由 index.js 的 importPdfFile() 调用；
 * parse() 保留给"误用"场景，给出明确提示而不是静默失败。
 */

import { ImportError, createImportResult, defineImporter } from './importer.js';
import { normalizeCourses } from '../../data/course-model.js';
import { extractPdfTextItems } from './pdf/pdf-text.js';
import { parseSchedulePages } from './pdf/schedule-parser.js';

/**
 * 解析 PDF 的原始行（可单测：直接喂 pages）。
 * @param {Array} pages
 * @param {{source?:string}} [meta]
 */
export function rowsFromPages(pages, { source = 'pdf' } = {}) {
  const { rows, warnings, stats } = parseSchedulePages(pages);

  if (rows.length === 0) {
    throw new ImportError(
      stats.blocks > 0 || stats.items > 0
        ? '未识别到有效课程，请确认这是学校教务系统导出的课表 PDF。'
        : '暂时无法识别此学校的课表 PDF 格式。',
      {
        hint:
          stats.blocks > 0
            ? '识别到了课程块，但缺少「星期 / 节次 / 周次」等必要信息'
            : '当前版本按「星期表头 + (a-b节) + 周次 + 校区/场地/教师」的结构解析，其它排版的 PDF 暂不支持',
        detail: { stats, source },
        source: 'pdf',
      },
    );
  }

  return { rows, warnings, stats };
}

/** 原始行 → 统一 Course[]（复用 course-model，不新建数据结构） */
export function pdfRowsToCourses(rows, { warnings = [], stats = {} } = {}) {
  const { courses, issues, duplicates } = normalizeCourses(rows);
  const allWarnings = [...(stats.merged ? [] : []), ...warnings, ...issues.warnings];

  if (courses.length === 0) {
    throw new ImportError('未识别到有效课程，请确认这是学校教务系统导出的课表 PDF。', {
      hint: '解析出来的课程缺少名称/星期/节次等必要字段',
      detail: { issues, stats },
      source: 'pdf',
    });
  }

  return createImportResult({
    courses,
    issues: { errors: issues.errors, warnings: allWarnings },
    duplicates,
    total: rows.length,
    source: 'pdf',
    importer: 'PDF 课表',
  });
}

/**
 * 从 File 对象导入 PDF（浏览器用）。
 * @param {File} file
 * @returns {Promise<import('../importer.js').ImportResult>}
 */
export async function importPdfFile(file) {
  if (!file) {
    throw new ImportError('没有选择文件', { hint: '请选择一个 PDF 文件', source: 'pdf' });
  }

  const name = String(file.name ?? '');
  if (!/\.pdf$/i.test(name) && !String(file.type ?? '').includes('pdf')) {
    throw new ImportError('请选择 PDF 文件', {
      hint: `「${name || '该文件'}」不是 PDF。如果学校导出的是 Excel，请先另存为 CSV，用「JSON / CSV 文件导入」导入`,
      source: 'pdf',
    });
  }

  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    throw new ImportError('无法读取此 PDF，请确认文件未损坏。', { detail: error, source: 'pdf' });
  }

  const { pages } = await extractPdfTextItems(new Uint8Array(buffer));
  const { rows, warnings, stats } = rowsFromPages(pages);
  return pdfRowsToCourses(rows, { warnings, stats });
}

export const pdfImporter = defineImporter({
  id: 'pdf',
  label: 'PDF 课表',
  accept: '.pdf,application/pdf',
  hint: '学校教务系统导出的课表 PDF，在浏览器本地解析',
  detect: () => false, // 二进制格式，不做文本探测
  parse: () => {
    throw new ImportError('PDF 需要用文件方式导入', {
      hint: '请在「PDF 课表导入」里选择 PDF 文件，而不是粘贴文本',
      source: 'pdf',
    });
  },
});
