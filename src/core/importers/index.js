/**
 * importers/index.js —— 导入体系统一出口。
 *
 * 对外只暴露三件事：
 *   importPayload(payload, source)  文本/对象 → 统一 Course[]（auto 会自动识别 JSON / CSV）
 *   importFile(file)                文件 → 统一 Course[]
 *   IMPORTERS / SCHOOL_ADAPTERS     给 UI 渲染"导入方式"列表用
 *
 * store、UI 都只依赖这里，因此以后新增 Excel / 学校适配器时，
 * 上层代码不需要改动（这就是"UI 不处理各学校原始数据"的保证）。
 */

import { ImportError, createImportResult } from './importer.js';
import { jsonImporter, parseJSON } from './json-importer.js';
import { csvImporter, fromRows, parseCSV, parseSections, parseWeekday } from './csv-importer.js';
import { htmlImporter, hasHtmlTable, htmlTablesToRows, parseHtmlTables } from './html-importer.js';
import { pdfImporter, importPdfFile, pdfRowsToCourses, rowsFromPages } from './pdf-importer.js';
import { formatWeeks, parsePdfWeeks, parseSchedulePages } from './pdf/schedule-parser.js';
import {
  NOT_CONFIGURED_HINT,
  NOT_CONFIGURED_MESSAGE,
  clearSchoolAdapters,
  defineSchoolAdapter,
  getSchoolAdapter,
  getSchoolAdapters,
  hasSchoolAdapters,
  registerSchoolAdapter,
  runSchoolAdapter,
} from './school-adapter.js';
import { SCHOOL_ADAPTERS, registerBuiltinAdapters } from './adapters/index.js';
import { normalizeCourses } from '../../data/course-model.js';

// 加载时登记内置的学校适配器（当前为空，见 adapters/index.js）
registerBuiltinAdapters();

/** 文件 / 粘贴导入用的解析器（保持原有行为：JSON + CSV） */
export const IMPORTERS = Object.freeze([jsonImporter, csvImporter]);

/**
 * 全部可用解析器（多了 HTML 表格与 PDF 课表）。
 * 单独列出是为了不动 IMPORTERS —— JSON / CSV 的现有 UI 与行为完全不变。
 */
export const ALL_IMPORTERS = Object.freeze([jsonImporter, csvImporter, htmlImporter, pdfImporter]);

export function getImporter(id) {
  return ALL_IMPORTERS.find((importer) => importer.id === id) ?? null;
}

/** 根据内容自动判断用哪个导入器（JSON / CSV / HTML 表格） */
export function detectImporter(payload) {
  if (typeof payload !== 'string') return jsonImporter;
  const text = payload;
  const found = ALL_IMPORTERS.find((importer) => importer.detect?.(text));
  return found ?? jsonImporter;
}

/**
 * 原始行数组 → 统一 Course[]（所有导入方式的公共收尾）。
 * @param {Array} rows
 * @param {{source?:string, importer?:string}} [meta]
 */
export function toCourses(rows = [], { source = 'unknown', importer = '' } = {}) {
  const total = rows.length;
  const { courses, issues, duplicates } = normalizeCourses(rows);

  if (courses.length === 0) {
    throw new ImportError('无法识别该课表格式', {
      hint:
        '没有解析出任何一门有效课程。请确认文件里有「课程名称」以及「星期」「节次」等必要字段，' +
        '或导入学校教务系统导出的课表文件、选择对应学校。',
      detail: { issues, total },
      source,
    });
  }

  return createImportResult({ courses, issues, duplicates, total, source, importer });
}

/**
 * 统一导入入口（保持与旧版 importers.js 相同的调用方式）。
 *
 * @param {string|object|Array} payload
 * @param {'auto'|'json'|'csv'} [source='auto']
 * @returns {import('./importer.js').ImportResult}
 */
export function importPayload(payload, source = 'auto') {
  const importer = source === 'auto' ? detectImporter(payload) : getImporter(source);

  if (!importer) {
    throw new ImportError('暂不支持该导入方式', {
      hint: `可用的导入方式：${IMPORTERS.map((i) => i.label).join(' / ')}`,
      source,
    });
  }

  let rows;
  try {
    rows = importer.parse(payload, { source: importer.id });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // 代码层面的意外错误：给用户一句话，细节留给 console
    throw new ImportError('无法识别该课表格式', {
      hint: '解析过程中出错，详细信息见浏览器控制台',
      detail: error,
      source: importer.id,
    });
  }

  return toCourses(rows, { source: importer.id, importer: importer.label });
}

/**
 * 从 <input type="file"> 的文件对象导入。
 *
 * 支持 JSON / CSV / TXT：
 *   - .json 或 MIME 为 json           → JSON 导入器
 *   - .csv 或 MIME 为 csv             → CSV 导入器
 *   - .txt / 其它扩展名 / 未知 MIME    → auto：按文件内容自动识别（内容像 JSON 就走 JSON，否则按 CSV）
 * 读取失败、内容为空、格式无法识别都会抛 ImportError，由面板显示错误而不是静默失败。
 *
 * @param {File} file
 */
export async function importFile(file) {
  if (!file) {
    throw new ImportError('没有选择文件', { hint: '请重新点击「选择文件」', source: 'file' });
  }

  const name = String(file.name ?? '').toLowerCase();
  const mime = String(file.type ?? '').toLowerCase();

  let text;
  try {
    text = await file.text();
  } catch (error) {
    throw new ImportError('文件读取失败', {
      hint: `无法读取「${file.name ?? '该文件'}」，请确认文件没有被其它程序占用，或换一个文件试试`,
      detail: error,
      source: 'file',
    });
  }

  let source = 'auto';
  if (name.endsWith('.json') || mime.includes('json')) source = 'json';
  else if (name.endsWith('.csv') || mime.includes('csv')) source = 'csv';

  return importPayload(text, source);
}

/**
 * 教务系统直连导入：返回统一 Course[]。
 * 没有配置对应学校的适配器时会抛 ImportError（文案：暂未配置当前学校的教务系统适配器）。
 */
export async function importFromSchool(adapterId, options = {}) {
  const rows = await runSchoolAdapter(adapterId, options);
  return toCourses(rows, {
    source: `school:${adapterId}`,
    importer: getSchoolAdapter(adapterId)?.label ?? adapterId,
  });
}

/* ------------------------------------------------------------------ 导出汇总 */

export {
  // 具体导入器
  jsonImporter,
  csvImporter,
  htmlImporter,
  pdfImporter,
  importPdfFile,
  pdfRowsToCourses,
  rowsFromPages,
  parseJSON,
  parseCSV,
  fromRows,
  parseWeekday,
  parseSections,
  parseHtmlTables,
  htmlTablesToRows,
  hasHtmlTable,
  // PDF 课表（纯解析函数，便于单测与复用）
  parseSchedulePages,
  parsePdfWeeks,
  formatWeeks,
  // 教务系统适配器框架
  defineSchoolAdapter,
  registerSchoolAdapter,
  getSchoolAdapters,
  getSchoolAdapter,
  hasSchoolAdapters,
  runSchoolAdapter,
  clearSchoolAdapters,
  NOT_CONFIGURED_MESSAGE,
  NOT_CONFIGURED_HINT,
  SCHOOL_ADAPTERS,
  // 错误与工具
  ImportError,
  createImportResult,
};

/* ------------------------------------------------ 通用教务系统导入（第二阶段入口） */

export {
  BROWSER_SECURITY_NOTES,
  CAPABILITY,
  CAPABILITY_LABELS,
  CAPABILITY_ROWS,
  assessCapabilities,
  detectHelperBridge,
  isBrowserEnvironment,
  isSameOrigin,
  probeOpenedWindow,
  probeTarget,
  safeOrigin,
  summarizeProbe,
} from './browser-capabilities.js';

export {
  FLOW_STEPS,
  FLOW_STEP_LABELS,
  STEP_INDEX,
  createGenericFlow,
  detectFormats,
  normalizeTargetUrl,
} from './generic-flow.js';

/** 规划中（未实现，调用会明确报错，不会假装成功） */
export async function importExcel() {
  throw new ImportError('Excel 导入尚未接入', {
    hint: '建议在 Excel 里「另存为 CSV」后使用「导入 CSV」；如需直接读 .xlsx，需要引入 SheetJS 解析成二维数组后调用 fromRows(rows)',
    source: 'excel',
  });
}
