/**
 * 临时验证脚本：对真实课表 PDF 跑完整 PDF → Course[] 流程，打印结果。
 * 用法：node scripts/pdf-verify.mjs "C:\\path\\to\\课表.pdf"
 */
import { readFileSync } from 'node:fs';
import { extractPdfTextItems } from '../src/core/importers/pdf/pdf-text.js';
import { rowsFromPages, pdfRowsToCourses } from '../src/core/importers/pdf-importer.js';
import { isCourseInWeek } from '../src/core/week-utils.js';
import { buildLayout } from '../src/core/layout-engine.js';
import { getWeekDates } from '../src/core/week-utils.js';

const file = process.argv[2];
const data = new Uint8Array(readFileSync(file));

const { pages, numPages } = await extractPdfTextItems(data);
console.log(`页数: ${numPages}，文本项: ${pages.map((p) => p.items.length).join(' / ')}`);

const { rows, warnings, stats } = rowsFromPages(pages);
console.log('统计:', JSON.stringify(stats));
console.log(`原始行: ${rows.length}，警告: ${warnings.length}`);

const result = pdfRowsToCourses(rows, { warnings, stats });
console.log(`\n===== 统一 Course[]（${result.courses.length} 门安排）=====`);
for (const c of result.courses) {
  console.log(
    `  ${String(c.weekday)}|${String(c.startSection).padStart(2)}-${String(c.endSection).padStart(2)}节  ` +
      `${c.weeks.padEnd(24)} ${c.name}  ${c.teacher}  ${c.room}  ${c.campus}  [${c.note ?? ''}]`,
  );
}

console.log('\n===== 每周抽样（看周次过滤是否正确）=====');
for (const week of [3, 10, 15, 18]) {
  const visible = result.courses.filter((c) => isCourseInWeek(c, week));
  const layout = buildLayout({ courses: result.courses, week, metrics: undefined, weekDates: getWeekDates('2026-09-07', week, new Date(2026, 8, 26)) });
  console.log(
    `  第 ${String(week).padStart(2)} 周: ${String(visible.length).padStart(2)} 门 / 布局 ${layout.days.map((d) => d.items.length).join('')}  ` +
      visible.map((c) => c.name.slice(0, 6)).join('、'),
  );
}

if (warnings.length) {
  console.log('\n===== 警告 =====');
  warnings.forEach((w) => console.log('  - ' + w));
}
if (result.issues?.warnings?.length) {
  console.log('\n===== 字段提醒 =====');
  result.issues.warnings.slice(0, 5).forEach((w) => console.log('  - ' + w));
}
