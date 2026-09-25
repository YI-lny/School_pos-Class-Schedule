/**
 * csv-importer.js —— CSV 导入器（教务系统导出 / Excel 另存为 CSV 都走这里）。
 *
 * 负责：读取文本 → 解析 CSV → 表头别名映射 → 星期/节次/周次 解析 → 原始行数组
 * 最终由 course-model.normalizeCourses 转成统一 Course[]。
 *
 * 表头别名（大小写、空格、括号都会被忽略）：
 *   课程名称 | 课程 | name | course
 *   教师 | 老师 | teacher
 *   教室 | 上课地点 | room | classroom
 *   星期 | 周几 | weekday（支持 "周三" / "星期三" / "3" / "wed"）
 *   开始节次 | 起始节 | startSection（支持 "3" / "第3节" / "3-5"）
 *   结束节次 | 结束节 | endSection
 *   周次 | weeks（支持 "1-16" / "1-16(单)" / "3,5,7-9"）
 *   校区 | campus
 */

import { ImportError, defineImporter, stripBOM } from './importer.js';

/** 表头别名 → Course 字段 */
const HEADER_ALIASES = {
  name: ['name', 'course', 'coursename', '课程', '课程名称', '课程名', '教学班'],
  teacher: ['teacher', '教师', '老师', '任课教师', '任课老师'],
  room: ['room', 'classroom', '教室', '上课地点', '地点', '教学地点'],
  campus: ['campus', '校区', '上课校区'],
  weekday: ['weekday', 'day', '星期', '周几', '星期几', '上课星期'],
  startSection: [
    'startsection',
    'start',
    '开始节次',
    '起始节',
    '开始节',
    '节次起',
    '开始节数',
    // 只有一列"节次"时也接受：单元格可以是 "3"，也可以是 "3-5"
    '节次',
    '上课节次',
    '节次起止',
  ],
  endSection: ['endsection', 'end', '结束节次', '结束节', '节次止', '结束节数'],
  weeks: ['weeks', '周次', '上课周次', '起止周'],
  color: ['color', '颜色', '配色'],
};

const CN_WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

/** '周三' / '星期三' / '3' / 'wednesday' → 1~7（无法识别返回 null） */
export function parseWeekday(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();

  // "第一节" / "3-5节" 这类是节次，不是星期（没有"周/星期"字样时直接判为无法识别）
  if (/节/.test(text) && !/周|星期/.test(text)) return null;

  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (n === 0 || n === 7) return 7; // 0 和 7 都表示周日
    return n >= 1 && n <= 6 ? n : null;
  }

  const cn = text.match(/[一二三四五六日天]/);
  if (cn) return CN_WEEKDAYS[cn[0]] ?? null;

  const en = text.toLowerCase().match(/mon|tue|wed|thu|fri|sat|sun/);
  if (en) return { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }[en[0]] ?? null;

  return null;
}

/**
 * '3' / '第3节' / '3-5' / '3~5' → { startSection, endSection }
 * 如果单元格是 "3-5" 这种合并写法，一次拿到起止节次。
 */
export function parseSections(value, endValue) {
  const single = (input) => {
    const m = String(input ?? '').match(/\d+/);
    return m ? Number(m[0]) : null;
  };

  const text = String(value ?? '').trim();
  const range = text.match(/^(\d+)\s*[-~—至]\s*(\d+)$/);
  if (range) {
    return { startSection: Number(range[1]), endSection: Number(range[2]) };
  }

  const startSection = single(value);
  const endSection = single(endValue);
  return {
    startSection,
    endSection: endSection ?? startSection,
  };
}

function headerField(header) {
  const key = String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()（）]/g, '');
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  return null;
}

/** CSV 文本 → 二维数组（RFC4180 的实用子集：支持引号包裹、转义双引号、CRLF） */
export function parseCSV(text = '') {
  const content = stripBOM(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (quoted) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === '\t' || char === ';') {
      // 逗号 / 制表符 / 分号都当作分隔符（不同教务系统导出习惯不同）
      row.push(field);
      field = '';
    } else if (char === '\r') {
      /* 等 \n */
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

/**
 * 二维数组 → 原始行数组。
 * @param {Array<Array>} rows 第一行为表头
 */
export function fromRows(rows = [], { hasHeader = true } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const body = hasHeader ? rows.slice(1) : rows;
  const header = hasHeader ? rows[0].map((cell) => headerField(cell)) : null;

  // 没有可识别的表头 → 交给上层报"无法识别"
  if (hasHeader && header && header.every((f) => f === null)) return [];

  return body
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      if (!header) return row;
      const raw = {};
      header.forEach((field, index) => {
        if (!field) return;
        raw[field] = row[index];
      });
      const sections = parseSections(raw.startSection, raw.endSection);
      return {
        ...raw,
        weekday: raw.weekday === undefined ? undefined : parseWeekday(raw.weekday),
        startSection: sections.startSection,
        endSection: sections.endSection,
      };
    });
}

export const csvImporter = defineImporter({
  id: 'csv',
  label: '导入 CSV',
  accept: '.csv,.txt,text/csv',
  hint: '首行为表头，支持 课程名称 / 教师 / 教室 / 星期 / 开始节次 / 结束节次 / 周次',
  detect: (text) => /[,\t;]/.test(String(text).split('\n')[0] ?? ''),
  parse: (text) => {
    const rows = parseCSV(text);
    if (rows.length === 0) {
      throw new ImportError('无法识别该课表格式', {
        hint: 'CSV 内容为空，或者没有解析出任何一行',
        source: 'csv',
      });
    }

    const raw = fromRows(rows);
    if (raw.length === 0) {
      throw new ImportError('无法识别该课表格式', {
        hint:
          '第一行需要是表头，且至少包含「课程名称」；可用的列名：课程名称 / 教师 / 教室 / 星期 / 开始节次 / 结束节次 / 周次',
        detail: { header: rows[0] },
        source: 'csv',
      });
    }

    return raw;
  },
});
