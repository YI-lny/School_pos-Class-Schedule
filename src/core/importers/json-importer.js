/**
 * json-importer.js —— JSON 导入器。
 *
 * 支持的输入：
 *   [ {...}, {...} ]                 课程数组
 *   { "courses": [ ... ] }           带包装
 *   { "data": [ ... ] }              带包装
 *   { "courses": [...] } 的字符串    粘贴的文本
 *
 * 字段名可以是项目内部名（name/teacher/room/weekday/startSection/...），
 * 也可以是中文（课程名称/教师/教室/星期/开始节次/结束节次/周次），
 * 具体映射在 course-model.normalizeCourse 与 csv-importer 的表头别名里统一处理。
 */

import { ImportError, defineImporter, looksLikeJSON, stripBOM } from './importer.js';

/** JSON 文本或对象 → 原始行数组 */
export function parseJSON(payload) {
  let data = payload;

  if (typeof payload === 'string') {
    const text = stripBOM(payload).trim();
    if (!text) {
      throw new ImportError('内容为空', {
        hint: '请粘贴 JSON 内容，或选择一个 .json 文件',
        source: 'json',
      });
    }
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new ImportError('无法识别该课表格式', {
        hint: '这段内容不是合法的 JSON，请确认复制完整（常见的还有末尾多了逗号、引号不匹配）',
        detail: error,
        source: 'json',
      });
    }
  }

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.courses)) return data.courses;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.list)) return data.list;

  throw new ImportError('无法识别该课表格式', {
    hint: 'JSON 需要是课程数组，或 { "courses": [ ... ] } 这种结构',
    detail: data,
    source: 'json',
  });
}

export const jsonImporter = defineImporter({
  id: 'json',
  label: '导入 JSON',
  accept: '.json,application/json',
  hint: '支持课程数组，或 { "courses": [ ... ] }；字段名中英文都可以',
  detect: looksLikeJSON,
  parse: (payload) => parseJSON(payload),
});
