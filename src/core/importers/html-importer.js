/**
 * html-importer.js —— HTML 表格导入器。
 *
 * 为什么需要它：绝大多数教务系统的课表页面就是一张 HTML 表格。
 * 普通网页无法读取别的域名的响应（CORS / SOP），但**用户可以自己把课表表格复制过来**，
 * 这条路径在纯浏览器环境里是真实可行的，所以通用导入把它作为落地方式。
 *
 * 实现刻意不依赖 DOMParser：用最小 HTML 词法分析抽取 <table>/<tr>/<td>，
 * 这样同一份代码在浏览器和 Node 测试里都能跑（也便于 npm run check 覆盖）。
 *
 * 支持：标准"表头 + 每行一门课"的表格 → 复用 csv-importer 的表头别名映射。
 * 不支持（会如实报告，不猜）：以"节次 × 星期"为网格、大量 rowspan/colspan 的课表。
 */

import { ImportError, defineImporter, stripBOM } from './importer.js';
import { fromRows } from './csv-importer.js';

/** 常见 HTML 实体解码 */
function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/** 去掉单元格里的标签与多余空白 */
function cellText(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function attrOf(tagHtml, name) {
  const match = String(tagHtml).match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[2] ?? match[3] ?? match[4] ?? '') : '';
}

/**
 * 从 HTML 文本中抽取所有表格 → [{ rows: string[][], hasSpans: boolean }]
 * @param {string} html
 */
export function parseHtmlTables(html = '') {
  const text = stripBOM(String(html));
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;

  while ((tableMatch = tableRe.exec(text)) !== null) {
    const body = tableMatch[1];
    const rows = [];
    let hasSpans = false;

    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(body)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = [];
      const cellRe = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        const attrs = cellMatch[2] ?? '';
        if (/rowspan|colspan/i.test(attrs)) hasSpans = true;
        const value = cellText(cellMatch[3]);
        const colspan = Number(attrOf(attrs, 'colspan')) || 1;
        cells.push(value);
        // colspan 用空串占位，保证列数与表头对齐（不做语义猜测）
        for (let i = 1; i < colspan; i += 1) cells.push('');
      }
      if (cells.length) rows.push(cells);
    }

    if (rows.length) tables.push({ rows, hasSpans });
  }

  return tables;
}

/** 文本里是否含 HTML 表格 */
export function hasHtmlTable(text) {
  return /<table\b[^>]*>/i.test(String(text ?? ''));
}

/**
 * 把表格数组转成"原始课程行"。
 * 逐个表格套用 csv-importer 的表头别名映射，选出能识别出最多课程的那张表。
 */
export function htmlTablesToRows(tables = []) {
  let best = null;

  for (const table of tables) {
    let rows = [];
    try {
      rows = fromRows(table.rows);
    } catch {
      rows = [];
    }
    const usable = rows.filter((row) => row && row.name);

    if (!best || usable.length > best.rows.length) {
      best = { rows: usable, hasSpans: table.hasSpans, tableRows: table.rows.length };
    }
  }

  if (!best || best.rows.length === 0) return { rows: [], hasSpans: Boolean(best?.hasSpans) };
  return best;
}

export const htmlImporter = defineImporter({
  id: 'html',
  label: '粘贴课表表格',
  accept: '.html,.htm,text/html',
  hint: '在教务系统的课表页面全选表格内容（或复制网页源码）后粘贴到下面',
  detect: hasHtmlTable,
  parse: (text) => {
    const tables = parseHtmlTables(text);
    if (tables.length === 0) {
      throw new ImportError('没有找到 HTML 表格', {
        hint: '请确认粘贴的内容包含 <table> 课表；如果教务系统能导出 JSON / CSV，用那种更省事',
        source: 'html',
      });
    }

    const { rows, hasSpans } = htmlTablesToRows(tables);
    if (rows.length === 0) {
      throw new ImportError('无法识别该课表格式', {
        hint: hasSpans
          ? '识别到的是"星期 × 节次"网格课表（含合并单元格），当前版本还不会自动解析。可以改用 JSON / CSV 导出，或稍后使用学校专用适配器'
          : '表格里没有找到「课程名称」这类列，请确认复制的是完整课表表格',
        source: 'html',
      });
    }

    return rows;
  },
});
