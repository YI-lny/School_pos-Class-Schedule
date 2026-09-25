/**
 * importer.js —— Importer 接口与通用约定（导入体系的地基）。
 *
 * 数据流（所有导入方式都必须遵守）：
 *
 *   外部数据（JSON / CSV / 教务系统响应 / 学校导出文件）
 *        ↓  Importer.parse()          读取 + 识别格式 + 抽取原始行
 *        ↓  toCourses()               字段映射 + weekday/节次/周次 转换
 *        ↓  course-model.normalize()  统一 Course 数据结构
 *   统一 Course[]
 *        ↓  course-store.importCourses()
 *   现有 timetable / layout-engine / UI（完全不需要知道数据来自哪里）
 *
 * 约定：
 *   - Importer 只做"数据 → 数据"，绝不碰 DOM，也不修改 store；
 *   - 解析失败必须抛 ImportError（带 message / hint / detail），
 *     由 UI 统一展示 message + hint，detail 打到 console 方便排查。
 */

/** 导入流程中可预期的错误（区别于代码 bug 造成的异常） */
export class ImportError extends Error {
  /**
   * @param {string} message 给用户看的一句话
   * @param {{hint?:string, detail?:any, source?:string}} [options]
   */
  constructor(message, { hint = '', detail = null, source = 'unknown' } = {}) {
    super(message);
    this.name = 'ImportError';
    this.hint = hint;
    this.detail = detail;
    this.source = source;
  }
}

/**
 * 统一的导入结果（UI 只认这个结构）。
 * @typedef {object} ImportResult
 * @property {Array}  courses     统一 Course[]
 * @property {{errors:string[], warnings:string[]}} issues
 * @property {number} duplicates  被去重掉的数量
 * @property {string} source      来源标识：'json' | 'csv' | 'school:<id>'
 * @property {string} importer    导入器/适配器的显示名
 * @property {number} total       原始条数
 */

/**
 * 定义一个 Importer。
 *
 * @param {object} def
 * @param {string} def.id            唯一标识（'json' / 'csv' / ...）
 * @param {string} def.label         界面上显示的名字
 * @param {string} [def.accept]      文件选择框的 accept
 * @param {string} [def.hint]        界面提示语
 * @param {(text:string)=>boolean} [def.detect]  根据文本判断是否归它处理（auto 模式用）
 * @param {(payload:any, ctx:object)=>Array} def.parse  返回"原始行"（对象数组）
 * @returns {object} 冻结后的 importer
 */
export function defineImporter(def = {}) {
  const { id, label, accept = '', hint = '', detect = null, parse } = def;

  if (!id) throw new Error('defineImporter: 缺少 id');
  if (typeof parse !== 'function') throw new Error(`defineImporter(${id}): 缺少 parse()`);

  return Object.freeze({
    id,
    label: label || id,
    accept,
    hint,
    detect,
    parse,
  });
}

/** 去掉文本开头的 BOM（Windows 导出的 CSV / JSON 常见） */
export function stripBOM(text) {
  return String(text ?? '').replace(/^\uFEFF/, '');
}

/** 看起来像 JSON 吗 */
export function looksLikeJSON(text) {
  const t = stripBOM(text).trim();
  return t.startsWith('[') || t.startsWith('{');
}

/**
 * 组装 ImportResult（统一出口，保证字段齐全）。
 */
export function createImportResult({
  courses = [],
  issues = { errors: [], warnings: [] },
  duplicates = 0,
  total = courses.length,
  source = 'unknown',
  importer = '',
} = {}) {
  return {
    courses,
    issues: {
      errors: issues.errors ?? [],
      warnings: issues.warnings ?? [],
    },
    duplicates,
    total,
    source,
    importer,
  };
}
