/**
 * 无浏览器自检脚本：验证周次计算、布局几何、重叠分栏、导入解析。
 * 运行：npm run check   （或 node scripts/check-layout.mjs）
 *
 * 这些模块都是纯函数、不依赖 DOM，所以可以直接在 Node 里跑。
 */

import { DEFAULT_TERM, DEFAULT_TIME_SEASON, BREAK_AFTER_SECTIONS, BREAK_LABELS, MAJOR_BREAK_AFTER_SECTIONS, SECTIONS_PER_DAY, SECTION_TIMES, TIME_SLOT_CONFIG, getSectionTimes } from '../src/config/term-config.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
import { MOCK_COURSES, OVERLAP_DEMO_COURSES } from '../src/data/course-data.js';
import {
  buildLayout,
  computeColumnWidths,
  contentHeight,
  findConflictingCourseIds,
  fitMetrics,
  packLanes,
  readMetrics,
  sectionTop,
  MAX_SLOT_HEIGHT,
  MIN_SLOT_HEIGHT,
} from '../src/core/layout-engine.js';
import {
  createWeekMatcher,
  currentWeekOf,
  datesOfWeek,
  describeToday,
  formatMonthDay,
  formatWeekRange,
  getWeekDates,
  intersectWeeks,
  isCourseInWeek,
  normalizeWeeksSpec,
  toISODate,
  weekdayOf,
  weekOfDate,
  weeksOverlap,
} from '../src/core/week-utils.js';
import { normalizeCourse, validateCourse } from '../src/data/course-model.js';
import { createCourseStore } from '../src/core/course-store.js';
import { createMemoryStorage } from '../src/core/storage.js';
import { createCoursePersistence, STORAGE_KEYS } from '../src/core/course-persistence.js';
import {
  ALL_IMPORTERS,
  BROWSER_SECURITY_NOTES,
  CAPABILITY,
  CAPABILITY_ROWS,
  FLOW_STEPS,
  FLOW_STEP_LABELS,
  STEP_INDEX,
  IMPORTERS,
  ImportError,
  NOT_CONFIGURED_MESSAGE,
  assessCapabilities,
  createGenericFlow,
  csvImporter,
  detectFormats,
  formatWeeks,
  htmlImporter,
  importFile,
  importFromSchool,
  importPayload,
  importPdfFile,
  isSameOrigin,
  normalizeTargetUrl,
  parseCSV,
  parseHtmlTables,
  parsePdfWeeks,
  parseSchedulePages,
  parseSections,
  parseWeekday,
  pdfRowsToCourses,
  probeOpenedWindow,
  rowsFromPages,
  safeOrigin,
  clearSchoolAdapters,
  defineSchoolAdapter,
  hasSchoolAdapters,
  registerSchoolAdapter,
  runSchoolAdapter,
  toCourses,
} from '../src/core/importers/index.js';

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}\n      期望: ${e}\n      实际: ${a}`);
    console.log(`  ✗ ${label}\n      期望: ${e}\n      实际: ${a}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* --------------------------------------------------------- 1. 周次与日期 */
section('1. 周次 / 日期计算');

const termStart = DEFAULT_TERM.startDate; // 2026-09-07（第 1 周周一）
const week3 = datesOfWeek(termStart, 3);

check('第 3 周第一天 = 2026-09-21', formatMonthDay(week3[0]), '09-21');
check('第 3 周最后一天 = 2026-09-27', formatMonthDay(week3[6]), '09-27');
check('第 3 周范围文案', formatWeekRange(week3), '09-21 ~ 09-27');
check('2026-09-25 属于第 3 周', weekOfDate(termStart, '2026-09-25'), 3);
check('2026-09-25 是周五', weekdayOf(new Date(2026, 8, 25)), 5);
check('2026-09-25 的当前周 = 3', currentWeekOf(DEFAULT_TERM, new Date(2026, 8, 25)), 3);
check('学期开始前钳制到第 1 周', currentWeekOf(DEFAULT_TERM, new Date(2026, 7, 1)), 1);
check('学期结束后钳制到最后一周', currentWeekOf(DEFAULT_TERM, new Date(2027, 5, 1)), 20);

/* ------------------------------------------------- 1b. getWeekDates / 今天 */
section('1b. getWeekDates：现实日期 → 7 天（今天只可能有一天）');

const TODAY = new Date(2026, 8, 25); // 2026-09-25 周五

const w3 = getWeekDates(termStart, 3, TODAY);
check('第 3 周 7 天的日期', w3.map((d) => d.monthDay), [
  '09-21', '09-22', '09-23', '09-24', '09-25', '09-26', '09-27',
]);
check('weekday 依次为 1~7', w3.map((d) => d.weekday), [1, 2, 3, 4, 5, 6, 7]);
check('第 3 周只有周五是今天', w3.filter((d) => d.isToday).map((d) => d.weekday), [5]);
check('周六周日标记为周末', w3.filter((d) => d.isWeekend).map((d) => d.weekday), [6, 7]);

const w4 = getWeekDates(termStart, 4, TODAY);
check('第 4 周跨月日期正确（09-28 → 10-04）', w4.map((d) => d.monthDay), [
  '09-28', '09-29', '09-30', '10-01', '10-02', '10-03', '10-04',
]);
check('第 4 周没有任何一天是今天', w4.some((d) => d.isToday), false);

const w2 = getWeekDates(termStart, 2, TODAY);
check('第 2 周没有任何一天是今天', w2.some((d) => d.isToday), false);
check('第 2 周日期范围', formatWeekRange(w2), '09-14 ~ 09-20');

check('周六（09-26）为今天', getWeekDates(termStart, 3, new Date(2026, 8, 26)).filter((d) => d.isToday).map((d) => d.weekday), [6]);
check('09-28 落在第 4 周且是周一', getWeekDates(termStart, 4, new Date(2026, 8, 28)).filter((d) => d.isToday).map((d) => d.weekday), [1]);

// 跨年
const w18 = getWeekDates(termStart, 18, TODAY);
check('第 18 周跨年日期正确（01-04 → 01-10）', w18.map((d) => d.monthDay), [
  '01-04', '01-05', '01-06', '01-07', '01-08', '01-09', '01-10',
]);

const today = describeToday(DEFAULT_TERM, TODAY);
check('describeToday: 现实日期', today.iso, '2026-09-25');
check('describeToday: 周几', [today.weekday, today.weekdayLabel], [5, '周五']);
check('describeToday: 现实所在周', today.currentWeek, 3);
check('describeToday: 在本学期内', today.inTerm, true);
check(
  '学期结束后的日期 inTerm=false',
  describeToday(DEFAULT_TERM, new Date(2027, 2, 1)).inTerm,
  false,
);
check(
  '学期开始前的日期 inTerm=false',
  describeToday(DEFAULT_TERM, new Date(2026, 7, 1)).inTerm,
  false,
);

/* --------------------------------------------------------- 2. 周次表达式 */
section('2. 周次表达式解析');

check("'1-16' 含第 3 周", createWeekMatcher('1-16')(3), true);
check("'1-16' 不含第 17 周", createWeekMatcher('1-16')(17), false);
check("'1-16(单)' 含第 3 周", createWeekMatcher('1-16(单)')(3), true);
check("'1-16(单)' 不含第 4 周", createWeekMatcher('1-16(单)')(4), false);
check("'1-16(双)' 含第 4 周", createWeekMatcher('1-16(双)')(4), true);
check("'3,5,7-9' 含第 8 周", createWeekMatcher('3,5,7-9')(8), true);
check("'3,5,7-9' 不含第 6 周", createWeekMatcher('3,5,7-9')(6), false);
check("'*' 全周", createWeekMatcher('*')(19), true);

/* ------------------------------------------------------------- 3. 几何 */
section('3. 布局几何（默认尺寸 50 / 4 / 20）');

const metrics = readMetrics(); // Node 环境无 getComputedStyle → 返回默认值
check('默认节次高度', metrics.slotHeight, 50);
check('第 1 节顶部', sectionTop(1, metrics), 0);
check('第 2 节顶部', sectionTop(2, metrics), 54);
check('第 6 节顶部（含上下午间隔 20）', sectionTop(6, metrics), 290);
check('内容总高度 = 每天节次数 × 50 + 间隙 + 上下午留白', contentHeight(metrics), SECTION_TIMES.length * 50 + (SECTION_TIMES.length - 1) * 4 + 20);
check('总高度与"下一节"推算一致', sectionTop(SECTIONS_PER_DAY + 1, metrics) - metrics.slotGap, contentHeight(metrics));

/* --------------------------------------------------------- 4. 自适应行高 */
section('4. 自适应行高（一屏放下一天所有节次）');

const fitted = fitMetrics(metrics, 726);
const expectedSlot = (available) =>
  Math.max(MIN_SLOT_HEIGHT, Math.min(Math.floor((available - (20 + 4 * (SECTION_TIMES.length - 1))) / SECTION_TIMES.length), MAX_SLOT_HEIGHT));
check('可视 726px → 行高自适应', fitted.slotHeight, expectedSlot(726));
check('自适应后总高度不超过可视高度', contentHeight(fitted) <= 726, true);
check('可视 900px → 行高随可视高度变大', fitMetrics(metrics, 900).slotHeight, expectedSlot(900));
check('可视高度过小 → 缩到最小行高', fitMetrics(metrics, 300).slotHeight, MIN_SLOT_HEIGHT);
check('可视高度很大 → 行高封顶', fitMetrics(metrics, 5000).slotHeight, MAX_SLOT_HEIGHT);
check('未测量到高度（0）→ 用 CSS 基准行高', fitMetrics(metrics, 0).slotHeight, 50);

/* ------------------------------------------------------- 5. 课表布局 */
section('5. 课表布局（mock 数据 / 第 3 周）');

const layout = buildLayout({
  courses: MOCK_COURSES,
  week: 3,
  metrics,
  weekDates: w3,
});
const perDay = layout.days.map((d) => d.items.length);
check('周一~周日课程数 = [3,3,2,1,0,0,0]', perDay, [3, 3, 2, 1, 0, 0, 0]);
check('第 3 周共有 9 门课', layout.courseCount, 9);
check('周五列被标记为今天', layout.days[4].isToday, true);
check('周四列不是今天', layout.days[3].isToday, false);
check('周六 / 周日被标记为周末', [layout.days[5].isWeekend, layout.days[6].isWeekend], [true, true]);
check('节次栏行数 = 每天节次数', layout.slots.length, SECTION_TIMES.length);
check('上下午分隔线存在', typeof layout.breakTop, 'number');

const java = layout.days[2].items.find((i) => i.course.name === 'Java高级编程');
check('Java 课在第 3 天（周三）', java.course.weekday, 3);
check('Java 课 top = 第 3 节顶部 + 3', java.top, sectionTop(3, metrics) + 3);
check('Java 课跨 3 节，高度 = 3×50 + 2×4 - 6', java.height, 3 * 50 + 2 * 4 - 6);
check('Java 课独占整列（无重叠）', [java.laneCount, java.leftPct, java.widthPct], [1, 0, 100]);
check('Java 课信息完整（非 compact / tight）', [java.compact, java.tight], [false, false]);

const english = layout.days[1].items.find((i) => i.course.name === '理工英语');
check('理工英语跨第 8-9 节，高度正确', english.height, 2 * 50 + 4 - 6);

const week4 = buildLayout({
  courses: MOCK_COURSES,
  week: 4,
  metrics,
  weekDates: getWeekDates(termStart, 4, TODAY),
});
check("第 4 周仍显示 '1-16' 的课程", week4.courseCount, 9);

const week18Layout = buildLayout({
  courses: [...MOCK_COURSES, { ...MOCK_COURSES[0], id: 'x', weeks: '17-20' }],
  week: 18,
  metrics,
  weekDates: getWeekDates(termStart, 18, TODAY),
});
check('第 18 周只显示 17-20 周的课', week18Layout.courseCount, 1);

/* --------------------------------------------------------- 6. 列宽计算 */
section('6. 列宽计算（重叠时才加宽，且不溢出容器）');

const flatDays = Array.from({ length: 7 }, () => ({ maxLane: 1 }));
const deskWidths = computeColumnWidths(flatDays, 900, metrics);
check('无重叠 + 900px 容器 → 正好铺满（不多不少）', deskWidths.reduce((a, b) => a + b, 0), 900);
check('无重叠时各列宽度差 ≤ 1px', Math.max(...deskWidths) - Math.min(...deskWidths) <= 1, true);

const overlapDays = flatDays.map((d, i) => (i === 4 ? { maxLane: 3 } : d));
const mixedWidths = computeColumnWidths(overlapDays, 900, metrics);
check('只有周五（第 5 天）被加宽到 3 栏宽', mixedWidths[4] >= 3 * metrics.laneMinWidth, true);
check('其它天仍然更窄（没被一起撑开）', mixedWidths[0] < mixedWidths[4], true);
check('加宽后总宽仍正好等于容器宽', mixedWidths.reduce((a, b) => a + b, 0), 900);

const phoneWidths = computeColumnWidths(flatDays, 337, metrics);
check('手机窄屏（337px）→ 保持最小列宽，交给横向滚动', phoneWidths, [90, 90, 90, 90, 90, 90, 90]);

/* --------------------------------------------------- 7. 重叠自动分栏 */
section('7. 同一时间多门课 → 自动分栏');

const overlapping = OVERLAP_DEMO_COURSES.filter((c) => c.weekday === 5);
const packed = packLanes(overlapping);
check('周五 3 门互相重叠的课 → 3 栏', new Set(packed.map((p) => p.laneCount)), new Set([3]));
check('每门课占用不同轨道', packed.map((p) => p.lane).sort(), [0, 1, 2]);

const soloPacked = packLanes(MOCK_COURSES.filter((c) => c.weekday === 1));
check('周一 3 门不重叠的课 → 各自占满整列', soloPacked.every((p) => p.laneCount === 1), true);

const partial = packLanes([
  { id: 'a', name: 'A', weekday: 1, startSection: 1, endSection: 2 },
  { id: 'b', name: 'B', weekday: 1, startSection: 2, endSection: 3 },
  { id: 'c', name: 'C', weekday: 1, startSection: 6, endSection: 7 },
]);
check('重叠的 A/B 分 2 栏，不重叠的 C 独占整列', partial.map((p) => [p.course.id, p.lane, p.laneCount]), [
  ['a', 0, 2],
  ['b', 1, 2],
  ['c', 0, 1],
]);

/* --------------------------------------------------------- 8. 导入解析 */
section('8. 导入解析（JSON / CSV）');

const csv = [
  '课程名称,教师,教室,星期,开始节次,结束节次,周次,校区',
  '"数据结构,进阶",刘老师,7-201,周三,1,2,1-16,椒江校区',
  '计算机网络,赵老师,7-305,5,3,4,1-8,椒江校区',
].join('\n');

const csvRows = parseCSV(csv);
check('CSV 行数（含表头）', csvRows.length, 3);
check('CSV 引号内逗号不被拆分', csvRows[1][0], '数据结构,进阶');

const csvImport = importPayload(csv, 'csv');
check('CSV 导入 2 门课', csvImport.courses.length, 2);
check('中文表头"周三" → weekday 3', csvImport.courses[0].weekday, 3);
check('数字星期 "5" → weekday 5', csvImport.courses[1].weekday, 5);
check('节次被解析为数字', [csvImport.courses[1].startSection, csvImport.courses[1].endSection], [3, 4]);

const jsonImport = importPayload(
  JSON.stringify({ courses: [{ name: '体育', teacher: '钱老师', weekday: 6, startSection: 3, endSection: 4 }] }),
  'json',
);
check('JSON 导入 1 门课', jsonImport.courses.length, 1);
check('缺省周次 → 全周', jsonImport.courses[0].weeks, '*');

/* ----------------------------------------------------------- 9. store */
section('9. course-store：viewingWeek / currentWeek / 今天');

const store = createCourseStore({
  term: DEFAULT_TERM,
  courses: MOCK_COURSES,
  storage: createMemoryStorage(),
  today: new Date(2026, 8, 25), // 模拟现实日期 2026-09-25（周五）
});

const s0 = store.getState();
check('测试1 · 默认打开就是现实所在周（第 3 周）', s0.viewingWeek, 3);
check('测试1 · 现实所在周 = 3', s0.currentWeek, 3);
check('测试1 · 周五是今天', s0.weekDates.filter((d) => d.isToday).map((d) => d.weekday), [5]);
check('测试1 · 今天是 2026-09-25', s0.todayISO, '2026-09-25');

store.nextWeek();
const s1 = store.getState();
check('测试2 · 下一周 → 第 4 周', s1.viewingWeek, 4);
check('测试2 · 第 4 周日期 09-28 ~ 10-04', formatWeekRange(s1.weekDates), '09-28 ~ 10-04');
check('测试2 · 第 4 周没有任何"今天"', s1.weekDates.some((d) => d.isToday), false);
check('测试2 · 现实周仍然是第 3 周（没有被改掉）', s1.currentWeek, 3);
check('测试2 · 此时不是本周', s1.isCurrentWeek, false);

store.prevWeek();
check('测试3 · 上一周 → 回到第 3 周', store.getState().viewingWeek, 3);
check('测试3 · "今天"回到周五', store.getState().weekDates.filter((d) => d.isToday).map((d) => d.weekday), [5]);

store.prevWeek();
check('测试4 · 上一周 → 第 2 周', store.getState().viewingWeek, 2);
store.prevWeek();
check('测试4 · 再上一周 → 第 1 周', store.getState().viewingWeek, 1);
check('测试4 · 第 1 周时"上一周"不可用', store.getState().canGoPrev, false);
store.prevWeek();
check('测试4 · 第 1 周再点上一周 → 不会出现第 0 周', store.getState().viewingWeek, 1);

store.goToWeek(20);
check('学期最后一周 = 20', store.getState().viewingWeek, 20);
check('第 20 周时"下一周"不可用', store.getState().canGoNext, false);
store.nextWeek();
check('第 20 周再点下一周 → 不会超过总周数', store.getState().viewingWeek, DEFAULT_TERM.totalWeeks);

store.goToWeek(8);
check('测试5 · 先翻到第 8 周', store.getState().viewingWeek, 8);
store.goToCurrentWeek();
check('测试5 · 点"本周" → 回到第 3 周', store.getState().viewingWeek, 3);

/* ---- 现实日期变化（跨天 / 跨周） ---- */
store.setToday('2026-09-26');
const s26 = store.getState();
check('测试6 · 模拟 2026-09-26 → 周几变周六', s26.todayWeekday, 6);
check('测试6 · 周六是今天', s26.weekDates.filter((d) => d.isToday).map((d) => d.weekday), [6]);
check('测试6 · 仍在第 3 周', [s26.viewingWeek, s26.currentWeek], [3, 3]);

store.setToday('2026-09-28');
const s28 = store.getState();
check('测试7 · 模拟 2026-09-28 → 现实周变第 4 周', s28.currentWeek, 4);
check('测试7 · 跟随到第 4 周', s28.viewingWeek, 4);
check('测试7 · 周一 09-28 是今天', s28.weekDates.filter((d) => d.isToday).map((d) => d.weekday), [1]);
check('测试7 · 第 4 周日期正确', formatWeekRange(s28.weekDates), '09-28 ~ 10-04');

// 用户已经自己翻到别的周时，现实日期变化不应该把用户拽走
store.goToWeek(9);
store.setToday('2026-10-05'); // 现实 → 第 5 周
check('用户手动翻到第 9 周后，现实周变化不打断他', store.getState().viewingWeek, 9);
check('但现实周已经更新为第 5 周', store.getState().currentWeek, 5);
store.setToday(null); // 恢复系统时间
check('setToday(null) 恢复真实系统日期', store.getState().todayISO, toISODate(new Date()));
check('恢复后现实周跟随系统时间', store.getState().currentWeek, currentWeekOf(DEFAULT_TERM, new Date()));

/* ---- 订阅 / 导入 / 调课 ---- */
store.goToWeek(3);
let notified = 0;
const unsubscribe = store.subscribe(() => {
  notified += 1;
});
store.nextWeek();
store.prevWeek();
unsubscribe();
store.nextWeek();
check('订阅 / 取消订阅生效', notified, 2);
store.goToCurrentWeek();

store.importCourses(JSON.stringify([{ name: '编译原理', weekday: 5, startSection: 1, endSection: 2 }]), {
  source: 'json',
  mode: 'replace',
});
check('导入后课程数 = 1', store.getState().courses.length, 1);
check('导入元信息记录来源', store.getState().lastImport.source, 'json');

store.resetToMock();
check('重置回 mock 数据', store.getState().courses.length, 9);

store.updateCourse('course-007', { startSection: 1, endSection: 2, weekday: 5 });
const moved = store.getCourse('course-007');
check('调课：Java 改到周五 1-2 节', [moved.weekday, moved.startSection, moved.endSection], [5, 1, 2]);
check('调课后 id 不变', moved.id, 'course-007');
check('本周（第 3 周）仍包含该课', isCourseInWeek(moved, 3), true);

/* ------------------------------------------------- 10. 导入体系 / 持久化 */
section('10. 导入体系（JSON / CSV / 教务系统 Adapter / 持久化）');

// 字段解析
check('parseWeekday: 周三 → 3', parseWeekday('周三'), 3);
check('parseWeekday: 星期三 → 3', parseWeekday('星期三'), 3);
check('parseWeekday: "5" → 5', parseWeekday('5'), 5);
check('parseWeekday: 周日/7/0 → 7', [parseWeekday('周日'), parseWeekday(7), parseWeekday(0)], [7, 7, 7]);
check('parseWeekday: 无法识别 → null', parseWeekday('第一节'), null);

check('parseSections: 合并写法 "3-5"', parseSections('3-5', undefined), { startSection: 3, endSection: 5 });
check('parseSections: "第3节" 单节', parseSections('第3节', ''), { startSection: 3, endSection: 3 });
check('parseSections: 起止分列', parseSections('3', '5'), { startSection: 3, endSection: 5 });

// 制表符 / 分号分隔（不同教务系统导出习惯）
const tsvImport = importPayload('课程名称\t教师\t星期\t开始节次\t结束节次\n高等数学\t王老师\t周一\t1\t2', 'csv');
check('CSV 支持制表符分隔', [tsvImport.courses[0].name, tsvImport.courses[0].weekday], ['高等数学', 1]);

// 合并节次单元格
const mergedSection = importPayload('课程名称,教师,星期,节次,周次\n大学英语,李老师,周二,3-5,1-16', 'csv');
check(
  'CSV 支持 "3-5" 合并节次列',
  [mergedSection.courses[0].startSection, mergedSection.courses[0].endSection],
  [3, 5],
);

// auto 识别
check('importPayload auto 识别 JSON', importPayload('[{"name":"体育","weekday":1,"startSection":1,"endSection":2}]').courses.length, 1);
check('importPayload auto 识别 CSV', importPayload('课程名称,星期\n体育,周一', 'auto').courses.length, 1);
check('csvImporter 是合法的 Importer', [csvImporter.id, typeof csvImporter.parse], ['csv', 'function']);

// 错误处理：全部抛 ImportError，且不会把异常抛给 UI 之外
const expectImportError = (fn, label, expectedMessage) => {
  try {
    fn();
    check(label, 'no-throw', 'ImportError');
  } catch (error) {
    check(label, [error instanceof ImportError, error.message], [true, expectedMessage]);
  }
};

expectImportError(() => importPayload('', 'json'), '空 JSON 内容 → ImportError', '内容为空');
expectImportError(() => importPayload('{ 这不是 json }', 'json'), '非法 JSON → 无法识别', '无法识别该课表格式');
expectImportError(
  () => importPayload('随便写点什么\n没有表头也没有逗号', 'csv'),
  '无法识别的 CSV → 无法识别',
  '无法识别该课表格式',
);
expectImportError(
  () => importPayload('[{"teacher":"只有老师"}]', 'json'),
  '没有任何有效课程 → 无法识别',
  '无法识别该课表格式',
);

// 教务系统适配器框架：没有配置时必须如实报错
clearSchoolAdapters();
check('默认没有任何学校适配器', hasSchoolAdapters(), false);
await (async () => {
  try {
    await importFromSchool('not-exist');
    check('未配置适配器 → 明确报错', 'no-throw', NOT_CONFIGURED_MESSAGE);
  } catch (error) {
    check('未配置适配器 → 明确报错', [error instanceof ImportError, error.message], [true, NOT_CONFIGURED_MESSAGE]);
  }
})();

// 用一个测试用适配器验证框架本身能跑通（不会注册到生产环境，见 adapters/index.js）
registerSchoolAdapter(
  defineSchoolAdapter({
    id: 'unit-test-school',
    label: '测试学校',
    needs: ['学号'],
    async login() {
      return { cookie: 'ok' };
    },
    async fetchCourses({ session }) {
      return { session, rows: [{ kcmc: '编译原理', jsxm: '陈老师', jasmc: '3-201', xqj: '周四', jcs: 1, jce: 2, zcd: '1-16' }] };
    },
    parseCourses({ data }) {
      return data.rows.map((row) => ({
        name: row.kcmc,
        teacher: row.jsxm,
        room: row.jasmc,
        weekday: parseWeekday(row.xqj),
        startSection: row.jcs,
        endSection: row.jce,
        weeks: row.zcd,
      }));
    },
  }),
);
check('注册适配器后 hasSchoolAdapters() = true', hasSchoolAdapters(), true);
await (async () => {
  const result = await importFromSchool('unit-test-school', { credentials: { 学号: '123' } });
  const course = result.courses[0];
  check(
    '适配器 → 统一 Course[]',
    [result.source, course.name, course.teacher, course.room, course.weekday, course.startSection, course.endSection, course.weeks],
    ['school:unit-test-school', '编译原理', '陈老师', '3-201', 4, 1, 2, '1-16'],
  );
  check('适配器产出的课程能被 layout-engine 使用', buildLayout({ courses: result.courses, week: 3, metrics, weekDates: w3 }).courseCount, 1);
})();
clearSchoolAdapters();

// 冲突检测（导入预览用）
check('示例数据里周三不冲突（3-5 与 6-8）', findConflictingCourseIds(MOCK_COURSES.filter((c) => c.weekday === 3)).size, 0);
check(
  '重叠演示数据 3 门课全部标记为冲突',
  findConflictingCourseIds(OVERLAP_DEMO_COURSES.filter((c) => c.weekday === 5)).size,
  3,
);

// 持久化
const memory = createMemoryStorage();
const persistence = createCoursePersistence(memory);

check('没有数据时 load() = null', persistence.load(), null);
persistence.save({ courses: MOCK_COURSES.slice(0, 2), term: DEFAULT_TERM, source: 'json' });
const reloaded = persistence.load();
check('保存后能读回课程', reloaded.courses.length, 2);
check('保存的键名符合约定', [memory.get(STORAGE_KEYS.courses) !== null, memory.get(STORAGE_KEYS.term) !== null], [true, true]);

memory.set(STORAGE_KEYS.courses, '{坏掉的 JSON');
const warnSilenced = console.warn;
console.warn = () => {}; // 这条 warn 是预期行为（坏数据被忽略），测试时静音
const broken = persistence.load();
console.warn = warnSilenced;
check('本地数据损坏 → 当作没有数据（不白屏）', broken, null);
memory.remove(STORAGE_KEYS.courses);
persistence.save({ courses: MOCK_COURSES.slice(0, 3), term: DEFAULT_TERM, source: 'csv' });
persistence.clear();
check('clear() 之后没有用户数据', persistence.load(), null);

// store 与持久化联动：导入 → 重新建 store（等价刷新页面）→ 仍是用户课表
const sharedStorage = createMemoryStorage();
const storeA = createCourseStore({ term: DEFAULT_TERM, storage: createMemoryStorage(), courseStorage: sharedStorage, today: new Date(2026, 8, 25) });
check('首次打开用的是示例课表', [storeA.getState().dataSource, storeA.getState().courseCount], ['sample', 9]);

storeA.importCourses('[{"name":"编译原理","teacher":"陈老师","weekday":4,"startSection":1,"endSection":2,"weeks":"1-16"}]', {
  source: 'json',
  mode: 'replace',
});
check('导入后 dataSource = user', storeA.getState().dataSource, 'user');
check('导入后课程数 = 1', storeA.getState().courseCount, 1);

const storeB = createCourseStore({ term: DEFAULT_TERM, storage: createMemoryStorage(), courseStorage: sharedStorage, today: new Date(2026, 8, 25) });
check('刷新（重建 store）后仍然是用户导入的课表', [storeB.getState().dataSource, storeB.getState().courseCount], ['user', 1]);
check('刷新后课程内容正确', storeB.getState().courses[0].name, '编译原理');
check('刷新后周次逻辑仍然正常（第 3 周）', storeB.getState().viewingWeek, 3);

// 恢复示例课表
storeB.restoreSampleTimetable();
check('恢复示例课表 → 9 门示例课程', [storeB.getState().dataSource, storeB.getState().courseCount], ['sample', 9]);
check('恢复后本地保存也被清掉', createCoursePersistence(sharedStorage).load(), null);
const storeC = createCourseStore({ term: DEFAULT_TERM, storage: createMemoryStorage(), courseStorage: sharedStorage, today: new Date(2026, 8, 25) });
check('恢复后刷新仍是示例课表', [storeC.getState().dataSource, storeC.getState().courseCount], ['sample', 9]);
check('恢复后"今天"高亮仍然正常', storeC.getState().weekDates.filter((d) => d.isToday).map((d) => d.weekday), [5]);

// 导入的课程按原 layout-engine 正常排布
const importedLayout = buildLayout({
  courses: toCourses(
    [
      { name: '编译原理', teacher: '陈老师', room: '3-201', weekday: 4, startSection: 3, endSection: 5, weeks: '1-16' },
    ],
    { source: 'json' },
  ).courses,
  week: 3,
  metrics,
  weekDates: w3,
});
check('导入的课程按 weekday/节次正常排布', [importedLayout.courseCount, importedLayout.days[3].items[0].top, importedLayout.days[3].items[0].height], [1, sectionTop(3, metrics) + 3, 3 * 50 + 2 * 4 - 6]);

/* ------------------------------------- 11. 周次感知的冲突判定 + 文件导入 */
section('11. 周次感知的冲突判定（T1~T8）');

const mk = (name, weekday, startSection, endSection, weeks) =>
  normalizeCourse({ name, teacher: 'X', room: 'R', weekday, startSection, endSection, weeks });

// weeksOverlap 本身
check('weeksOverlap: 1-8 与 9-16 不相交', weeksOverlap('1-8', '9-16'), false);
check('weeksOverlap: 1-8 与 5-12 相交', weeksOverlap('1-8', '5-12'), true);
check('weeksOverlap: 单周与双周错开', weeksOverlap('1-16(单)', '1-16(双)'), false);
check('weeksOverlap: 1,3,5,7,9 与 2,4,6,8,10 错开', weeksOverlap('1,3,5,7,9', '2,4,6,8,10'), false);
check('weeksOverlap: 1,3,5 与 3-7 相交于第 3 周', weeksOverlap('1,3,5', '3-7'), true);
check('weeksOverlap: * 与任何周次都相交', weeksOverlap('*', '20-30'), true);
check('weeksOverlap: 兼容数组 [1,2,3] 与 3-5', weeksOverlap([1, 2, 3], '3-5'), true);
check('weeksOverlap: 兼容 [{start,end}] 与 9-16', weeksOverlap([{ start: 1, end: 8 }], '9-16'), false);
check('intersectWeeks: 1-8 ∩ 5-12 = 5,6,7,8', intersectWeeks('1-8', '5-12'), [5, 6, 7, 8]);
check('normalizeWeeksSpec: 空值 → 全周', normalizeWeeksSpec(''), '*');

// T1~T4：冲突判定
check(
  'T1 周三 3-5（1-8 周）vs 周三 3-5（9-16 周）→ 不冲突',
  findConflictingCourseIds([mk('A', 3, 3, 5, '1-8'), mk('B', 3, 3, 5, '9-16')]).size,
  0,
);
check(
  'T2 周三 3-5（1-8 周）vs 周三 3-5（5-12 周）→ 冲突（第 5-8 周相交）',
  findConflictingCourseIds([mk('A', 3, 3, 5, '1-8'), mk('B', 3, 3, 5, '5-12')]).size,
  2,
);
check(
  'T3 周三 3-5（1-8 周）vs 周四 3-5（1-16 周）→ 不冲突',
  findConflictingCourseIds([mk('A', 3, 3, 5, '1-8'), mk('B', 4, 3, 5, '1-16')]).size,
  0,
);
check(
  'T4 周三 3-5（1-16 周）vs 周三 4-6（1-16 周）→ 冲突',
  findConflictingCourseIds([mk('A', 3, 3, 5, '1-16'), mk('B', 3, 4, 6, '1-16')]).size,
  2,
);
check(
  '单双周错开的两门课 → 不冲突',
  findConflictingCourseIds([mk('A', 3, 3, 5, '1-16(单)'), mk('B', 3, 3, 5, '1-16(双)')]).size,
  0,
);

// T5~T8：当前查看周的显示与并排布局
const splitByWeek = [mk('A', 3, 3, 5, '1-8'), mk('B', 3, 3, 5, '9-16')];
const layoutW3 = buildLayout({ courses: splitByWeek, week: 3, metrics, weekDates: getWeekDates(termStart, 3, TODAY) });
const layoutW10 = buildLayout({ courses: splitByWeek, week: 10, metrics, weekDates: getWeekDates(termStart, 10, TODAY) });

check(
  'T5 查看第 3 周：只出现第 3 周有效的课程 A',
  [layoutW3.courseCount, layoutW3.days[2].items.map((i) => i.course.name)],
  [1, ['A']],
);
check(
  'T6 查看第 10 周：只出现第 10 周有效的课程 B',
  [layoutW10.courseCount, layoutW10.days[2].items.map((i) => i.course.name)],
  [1, ['B']],
);
check(
  'T7 周次错开的课不会并排（各自占满整列、不预留冲突空间）',
  [
    [layoutW3.days[2].items[0].laneCount, layoutW3.days[2].items[0].widthPct, layoutW3.days[2].maxLane],
    [layoutW10.days[2].items[0].laneCount, layoutW10.days[2].items[0].widthPct, layoutW10.days[2].maxLane],
  ],
  [
    [1, 100, 1],
    [1, 100, 1],
  ],
);

const realConflict = [mk('A', 3, 3, 5, '1-16'), mk('B', 3, 4, 6, '1-16')];
const layoutW5 = buildLayout({ courses: realConflict, week: 5, metrics, weekDates: getWeekDates(termStart, 5, TODAY) });
check(
  'T8 真正冲突的两门课：仍然并排显示（各占 1/2 宽）',
  [
    layoutW5.days[2].items.length,
    layoutW5.days[2].items.map((i) => [i.laneCount, i.widthPct, i.lane]),
  ],
  [
    2,
    [
      [2, 50, 0],
      [2, 50, 1],
    ],
  ],
);

// 部分重叠的周次（第 5-8 周冲突）：查看第 6 周应并排，查看第 10 周应只有一个
const partialOverlap = [mk('A', 3, 3, 5, '1-8'), mk('B', 3, 3, 5, '5-12')];
const layoutW6 = buildLayout({ courses: partialOverlap, week: 6, metrics, weekDates: getWeekDates(termStart, 6, TODAY) });
const layoutW11 = buildLayout({ courses: partialOverlap, week: 11, metrics, weekDates: getWeekDates(termStart, 11, TODAY) });
check(
  '周次部分重叠：第 6 周并排（2 栏），第 11 周只有 B 独占整列',
  [
    [layoutW6.days[2].items.length, layoutW6.days[2].maxLane],
    [layoutW11.days[2].items.length, layoutW11.days[2].maxLane],
  ],
  [
    [2, 2],
    [1, 1],
  ],
);

// 示例数据不受影响
check(
  '示例课表（全部 1-16 周）的冲突判定与以前一致：周三不冲突、周五演示数据 3 门冲突',
  [
    findConflictingCourseIds(MOCK_COURSES).size,
    findConflictingCourseIds(OVERLAP_DEMO_COURSES.filter((c) => c.weekday === 5)).size,
  ],
  [0, 3],
);

section('11b. 文件导入（importFile：JSON / CSV / TXT / 错误处理）');

const fileOf = (name, type, content) => ({ name, type, text: async () => content });

await (async () => {
  const jsonResult = await importFile(
    fileOf('我的课表.json', 'application/json', JSON.stringify([{ name: '编译原理', weekday: 4, startSection: 3, endSection: 5, weeks: '1-8', teacher: '陈老师', room: '3-201' }])),
  );
  check(
    'importFile: .json 文件被正确解析',
    [jsonResult.source, jsonResult.courses.length, jsonResult.courses[0].name, jsonResult.courses[0].weeks],
    ['json', 1, '编译原理', '1-8'],
  );

  const csvResult = await importFile(fileOf('课表.csv', 'text/csv', '课程名称,教师,星期,节次,周次\n大学英语,李老师,周二,3-5,1-16'));
  check(
    'importFile: .csv 文件被正确解析（含合并节次列）',
    [csvResult.source, csvResult.courses.length, csvResult.courses[0].startSection, csvResult.courses[0].endSection],
    ['csv', 1, 3, 5],
  );

  const txtJson = await importFile(fileOf('导出.txt', 'text/plain', '[{"name":"体育","weekday":1,"startSection":1,"endSection":2}]'));
  check('importFile: .txt 但内容是 JSON → 自动识别为 JSON', txtJson.source, 'json');

  const txtCsv = await importFile(fileOf('导出.txt', 'text/plain', '课程名称,星期\n体育,周一'));
  check('importFile: .txt 但内容是 CSV → 自动识别为 CSV', [txtCsv.source, txtCsv.courses.length], ['csv', 1]);

  const mimeOnly = await importFile(fileOf('无扩展名', 'application/json', '[{"name":"体育","weekday":1,"startSection":1,"endSection":2}]'));
  check('importFile: 靠 MIME 类型识别 JSON', mimeOnly.source, 'json');

  const expectAsyncImportError = async (factory, label, expectedMessage) => {
    try {
      await factory();
      check(label, 'no-throw', expectedMessage);
    } catch (error) {
      check(label, [error instanceof ImportError, error.message], [true, expectedMessage]);
    }
  };
  await expectAsyncImportError(
    () => importFile(fileOf('乱码.csv', 'text/csv', '这不是课表，也没有表头')),
    'importFile: 无法识别的内容 → ImportError',
    '无法识别该课表格式',
  );
  await expectAsyncImportError(
    () =>
      importFile({
        name: '读不到.json',
        type: 'application/json',
        text: async () => {
          throw new Error('权限不足');
        },
      }),
    'importFile: 文件读取失败 → ImportError（不会静默失败）',
    '文件读取失败',
  );
  await expectAsyncImportError(() => importFile(fileOf('空.json', 'application/json', '')), 'importFile: 空文件 → ImportError', '内容为空');
  await expectAsyncImportError(() => importFile(null), 'importFile: 没有文件 → ImportError', '没有选择文件');

  // 粘贴导入不受影响
  check(
    '粘贴导入（字符串）没有被破坏',
    importPayload('[{"name":"体育","weekday":1,"startSection":1,"endSection":2}]', 'json').courses.length,
    1,
  );
  check('auto 粘贴导入仍然可用', importPayload('课程名称,星期\n体育,周一').courses.length, 1);
})();

/* --------------------------------- 12. 通用教务系统导入（第一阶段架构） */
section('12. 通用教务系统导入：状态机 / 格式识别 / HTML 表格 / 能力探测');

check('IMPORTERS 仍然只有 JSON / CSV（文件导入行为不变）', IMPORTERS.map((i) => i.id), ['json', 'csv']);
check('ALL_IMPORTERS 额外包含 HTML 表格与 PDF', ALL_IMPORTERS.map((i) => i.id), ['json', 'csv', 'html', 'pdf']);

// URL 校验
check('URL: 缺协议自动补 https', normalizeTargetUrl('jw.example.edu.cn').url, 'https://jw.example.edu.cn/');
check('URL: 允许 http', normalizeTargetUrl('http://jw.example.edu.cn/kb').ok, true);
check('URL: 拒绝 javascript: 伪协议', normalizeTargetUrl('javascript:alert(1)').ok, false);
check('URL: 空输入被拒绝', normalizeTargetUrl('   ').ok, false);

// 格式识别
check('detectFormats: JSON', detectFormats('[{"name":"A"}]').map((f) => f.format), ['json']);
check('detectFormats: HTML 表格', detectFormats('<table><tr><td>A</td></tr></table>').map((f) => f.format), ['html']);
check('detectFormats: CSV', detectFormats('课程名称,星期\n体育,周一').map((f) => f.format), ['csv']);
check('detectFormats: 空白内容 → 没有候选', detectFormats('   ').length, 0);

// 状态机：完整流程（面向 VPN / 统一身份认证的 10 步）
const flow = createGenericFlow();
check('状态机：初始 idle', flow.getState().step, 'idle');
flow.setUrl('vpn.example.edu.cn');
check('状态机：输入学校访问入口 → url-entered', [flow.getState().step, flow.getState().canOpen], ['url-entered', true]);
check('状态机：解析出 origin（协议+主机+端口）', flow.getState().origin, 'https://vpn.example.edu.cn');
flow.markOpened();
check('状态机：打开入口 → opened', [flow.getState().step, flow.getState().canMarkAuthDone], ['opened', true]);
flow.markAuthDone();
check('状态机：自行完成认证 → auth-done', [flow.getState().step, flow.getState().canMarkInJwxt], ['auth-done', true]);
flow.markInJwxt();
check('状态机：进入教务系统 → in-jwxt', [flow.getState().step, flow.getState().canMarkCoursePageReady], ['in-jwxt', true]);
flow.markCoursePageReady();
check('状态机：打开课表页 → course-page-ready', [flow.getState().step, flow.getState().canExtract], ['course-page-ready', true]);
flow.markBackToSchoolPos();
check('状态机：回到 School_pos → back-to-school-pos', [flow.getState().step, flow.getState().canExtract], ['back-to-school-pos', true]);
flow.markExtracting();
check('状态机：开始提取 → extracting', flow.getState().step, 'extracting');
flow.finishExtract({ readable: false, capabilities: {} });
check('状态机：读不到数据 → blocked（不伪造成功）', flow.getState().step, 'blocked');
check('状态机：blocked 时仍允许手工带回数据', flow.getState().canManualInput, true);
flow.receiveData(JSON.stringify([{ name: 'A', weekday: 1, startSection: 1, endSection: 2 }]));
check(
  '状态机：带回 JSON → discovered-data 并自动选中 json',
  [flow.getState().step, flow.getState().selectedFormat],
  ['discovered-data', 'json'],
);
flow.markPreview();
flow.markConfirm();
flow.markImported();
check('状态机：preview → confirm → imported', flow.getState().step, 'imported');
check(
  '状态机：10 步流程所需的全部状态都在',
  ['idle', 'url-entered', 'opened', 'auth-done', 'in-jwxt', 'course-page-ready', 'back-to-school-pos', 'extracting', 'discovered-data', 'select-format', 'preview', 'confirm', 'imported'].every((s) => FLOW_STEPS.includes(s)),
  true,
);
check('状态机：步骤条共 10 步且顺序符合最终流程', FLOW_STEP_LABELS.map((s) => s.text), [
  '输入学校访问入口',
  '打开学校访问入口',
  '自行完成学校认证',
  '进入教务系统',
  '进入课表页面',
  '回到 School_pos',
  '获取课表数据',
  '带回数据',
  '选择格式',
  '预览导入',
]);
check('状态机：步骤编号唯一（1~10，无重复）', FLOW_STEP_LABELS.length, new Set(FLOW_STEP_LABELS.map((s) => s.text)).size);
check('状态机：不再使用容易误解的「提取」字样', FLOW_STEP_LABELS.some((s) => s.text.includes('提取')), false);
check(
  '状态机：选择带回方式后进入「获取课表数据」这一步',
  (() => {
    const f = createGenericFlow();
    f.setUrl('https://vpn.example.edu.cn/');
    f.markOpened();
    f.markAuthDone();
    f.markInJwxt();
    f.markCoursePageReady();
    f.markFetchingData();
    return [f.getState().step, STEP_INDEX[f.getState().step]];
  })(),
  ['fetching-data', 6],
);
check('状态机：中途切回 School_pos 不会把已完成的步骤拉回去', (() => {
  const f = createGenericFlow();
  f.setUrl('https://vpn.example.edu.cn/');
  f.markOpened();
  f.markAuthDone();
  f.markBackToSchoolPos();
  const afterBack = f.getState().step;
  f.markInJwxt();
  f.markBackToSchoolPos(); // 再次触发（例如窗口又获得焦点）
  return [afterBack, f.getState().step];
})(), ['back-to-school-pos', 'in-jwxt']);

// 状态机：多候选 → select-format
const flow2 = createGenericFlow();
flow2.setUrl('https://jw.example.edu.cn/');
flow2.receiveData('课程名称,星期\n体育,周一\n<table><tr><th>课程名称</th></tr></table>');
check('状态机：同时像 HTML 与 CSV → select-format', [flow2.getState().step, flow2.getState().formats.length], ['select-format', 2]);
flow2.chooseFormat('html');
check('状态机：chooseFormat 生效', flow2.getState().selectedFormat, 'html');
flow2.reset();
check('状态机：reset 回到 idle 且不保留网址', [flow2.getState().step, flow2.getState().url], ['idle', '']);

// HTML 表格导入（真实可用路径）
const htmlDoc = `<html><body><table>
  <tr><th>课程名称</th><th>教师</th><th>教室</th><th>星期</th><th>开始节次</th><th>结束节次</th><th>周次</th></tr>
  <tr><td>Java高级编程</td><td>邓军</td><td>K-408</td><td>周三</td><td>3</td><td>5</td><td>1-8</td></tr>
  <tr><td>离散数学</td><td>张海良</td><td>2-404</td><td>周四</td><td>3</td><td>5</td><td>9-16</td></tr>
</table></body></html>`;

check('HTML：能抽出表格', parseHtmlTables(htmlDoc).length, 1);
const htmlResult = importPayload(htmlDoc, 'html');
check('HTML 表格 → 统一 Course[]（2 门课）', htmlResult.courses.length, 2);
check(
  'HTML 表格字段映射正确',
  [
    htmlResult.courses[0].name,
    htmlResult.courses[0].teacher,
    htmlResult.courses[0].room,
    htmlResult.courses[0].weekday,
    [htmlResult.courses[0].startSection, htmlResult.courses[0].endSection],
    htmlResult.courses[0].weeks,
  ],
  ['Java高级编程', '邓军', 'K-408', 3, [3, 5], '1-8'],
);
check('HTML 导入的课程同样按周次过滤（第 10 周只剩离散数学）',
  buildLayout({ courses: htmlResult.courses, week: 10, metrics, weekDates: getWeekDates(termStart, 10, TODAY) }).courseCount,
  1,
);
check('HTML 导入的课程在第 3 周只显示 Java',
  buildLayout({ courses: htmlResult.courses, week: 3, metrics, weekDates: getWeekDates(termStart, 3, TODAY) }).courseCount,
  1,
);
check('HTML 导入的课程仍然参与周次感知的冲突判定（两门不同天 → 不冲突）',
  findConflictingCourseIds(htmlResult.courses).size,
  0,
);

expectImportError(
  () => importPayload('<table><tr><td rowspan="2">第1节</td><td>高等数学</td></tr></table>', 'html'),
  'HTML：网格课表（含合并单元格）→ 明确报错，不瞎猜',
  '无法识别该课表格式',
);
expectImportError(() => importPayload('<div>没有表格</div>', 'html'), 'HTML：没有表格 → 明确报错', '没有找到 HTML 表格');

// 能力检测（非浏览器环境 + origin 正确判断）
await (async () => {
  const probe = await assessCapabilities('https://jw.example.edu.cn/');
  check('探测：非浏览器环境如实标注', [probe.environment, probe.verdict], ['non-browser', 'unsupported']);
  check('探测：报告里带浏览器安全机制说明', probe.notes.length >= 5, true);
  check(
    '探测：说明覆盖了关键限制（同源 / CORS / iframe / 凭据 / 跨标签页）',
    ['sop', 'cors', 'framing', 'cookie', 'network'].every((id) => BROWSER_SECURITY_NOTES.some((n) => n.id === id)),
    true,
  );
  const serialized = JSON.stringify(probe);
  check(
    '探测：报告里没有保存任何凭据字段（cookie / token / password / session）',
    ['cookie', 'token', 'password', 'authorization', 'session'].every(
      (key) => !new RegExp(`"${key}"\\s*:`, 'i').test(serialized),
    ),
    true,
  );
  check('探测：读不到内容时不会带回任何响应体', probe.text, null);
  check('探测：能力项覆盖需求里的四项', CAPABILITY_ROWS.map((r) => r.key), [
    'pageDom',
    'crossTabDom',
    'crossTabNetwork',
    'crossOriginFetch',
  ]);
  check('探测：三种状态常量齐全（可用 / 不可用 / 无法确定）', Object.values(CAPABILITY), [
    'available',
    'unavailable',
    'unknown',
  ]);
})();

check('同源判断：origin 不同 → 不同源', isSameOrigin('http://localhost:5173/', 'http://127.0.0.1:5173/'), false);
check('同源判断：端口不同 → 不同源', isSameOrigin('http://127.0.0.1:5173/', 'http://127.0.0.1:8080/'), false);
check('同源判断：协议不同 → 不同源', isSameOrigin('https://a.edu.cn/', 'http://a.edu.cn/'), false);
check('同源判断：完全相同 → 同源', isSameOrigin('https://a.edu.cn/x', 'https://a.edu.cn/y'), true);
check('safeOrigin 取协议+主机+端口', safeOrigin('https://vpn.tzc.edu.cn/a/b?c=1'), 'https://vpn.tzc.edu.cn');

check('窗口检测：没有句柄（被弹窗拦截）→ 无法确定', probeOpenedWindow(null).status, CAPABILITY.UNKNOWN);
check(
  '窗口检测：读 location 抛 SecurityError（跨源）→ 不可用',
  probeOpenedWindow({
    get location() {
      throw new Error('SecurityError: cross-origin');
    },
  }).status,
  CAPABILITY.UNAVAILABLE,
);
check(
  '窗口检测：窗口还停在 about:blank → 无法确定（不能因为"打开了"就说"可读"）',
  probeOpenedWindow({ location: { href: 'about:blank' } }).status,
  CAPABILITY.UNKNOWN,
);

// 模拟浏览器全局，验证"同源才可读"这一条分支
await (async () => {
  const hadWindow = 'window' in globalThis;
  const hadDocument = 'document' in globalThis;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.document = { title: 'test', documentElement: {} };
  globalThis.window = { location: { origin: 'http://127.0.0.1:5173', href: 'http://127.0.0.1:5173/' } };
  check(
    '窗口检测：同源窗口 → 可用',
    probeOpenedWindow({ location: { href: 'http://127.0.0.1:5173/kb' } }).status,
    CAPABILITY.AVAILABLE,
  );
  globalThis.window = { location: { origin: 'http://127.0.0.1:5173', href: 'http://127.0.0.1:5173/' } };
  const cross = await assessCapabilities('https://vpn.tzc.edu.cn/', { checkNetwork: false });
  check('能力检测：跨源目标 + 未开窗口 → 跨标签页 DOM 判定为不可用', cross.capabilities.crossTabDom.status, CAPABILITY.UNAVAILABLE);
  check('能力检测：未检测网络时跨源 fetch 记为"无法确定"而不是"不可用"', cross.capabilities.crossOriginFetch.status, CAPABILITY.UNKNOWN);
  check('能力检测：页面 DOM 记为本页可读', cross.capabilities.pageDom.status, CAPABILITY.AVAILABLE);

  if (hadWindow) globalThis.window = originalWindow; else delete globalThis.window;
  if (hadDocument) globalThis.document = originalDocument; else delete globalThis.document;
})();

/* --------------------------------------------- 13. PDF 课表导入（纯解析） */
section('13. PDF 课表导入：周次 / 节次 / 字段 / 星期 / 多安排');

// 周次表达式（要求六的每一种写法）
const weekCases = [
  ['1-18周', '1-18'],
  ['1-4周,6-18周', '1-4,6-18'],
  ['2-18周(双)', '2-18(双)'],
  ['9-11周(单)', '9-11(单)'],
  ['3周,7周', '3,7'],
  ['1-4周,6-14周,17-18周', '1-4,6-14,17-18'],
  ['1-4周,6-18周(双)', '1-4,6,8,10,12,14,16,18'],
  ['15周', '15'],
  ['（双）全角写法 2-18周（双）', '2-18(双)'],
];
for (const [input, expected] of weekCases) {
  check(`周次解析：${input}`, formatWeeks(parsePdfWeeks(input)), expected);
}
check('周次解析：2-18周(双) 的实际周次', parsePdfWeeks('2-18周(双)'), [2, 4, 6, 8, 10, 12, 14, 16, 18]);
check('周次解析：9-11周(单) 的实际周次', parsePdfWeeks('9-11周(单)'), [9, 11]);
check('周次结果能被现有 week-utils 直接使用', isCourseInWeek({ weeks: '2-18(双)' }, 10), true);
check('周次结果：双周课程在单周不出现', isCourseInWeek({ weeks: '2-18(双)' }, 11), false);

// 合成"课表页"：星期表头（y 轴）+ 单元格（x 轴），与真实 PDF 结构一致
const WEEKDAY_Y = [133, 237, 341, 445, 549, 653, 757];
function fakePage(cells) {
  const items = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'].map((text, i) => ({
    str: text,
    x: 74,
    y: WEEKDAY_Y[i],
  }));
  // 同一天的多个单元格沿 x 轴排开（与真实 PDF 的"节次 = x 轴"一致）
  const perDayCount = new Map();
  for (const cell of cells) {
    const y = WEEKDAY_Y[cell.weekday - 1];
    const order = perDayCount.get(cell.weekday) ?? 0;
    perDayCount.set(cell.weekday, order + 1);
    const x = 90 + order * 140;
    items.push({ str: cell.name, x, y });
    items.push({
      str: `(${cell.sections}节)${cell.weeks}/校区:${cell.campus ?? '椒江校区'}/场地:${cell.room ?? '1-101'}/教师:${cell.teacher ?? '张老师'}`,
      x: x + 12,
      y,
    });
  }
  return { items };
}

const parseOne = (cell) => {
  const { rows } = parseSchedulePages([fakePage([cell])]);
  return rows[0];
};

check('节次：1-2节', [parseOne({ name: 'A', sections: '1-2', weeks: '1-18', weekday: 1 }).startSection, parseOne({ name: 'A', sections: '1-2', weeks: '1-18', weekday: 1 }).endSection], [1, 2]);
check('节次：3-5节', [parseOne({ name: 'A', sections: '3-5', weeks: '1-18', weekday: 1 }).startSection, parseOne({ name: 'A', sections: '3-5', weeks: '1-18', weekday: 1 }).endSection], [3, 5]);
check('节次：10-12节', [parseOne({ name: 'A', sections: '10-12', weeks: '1-18', weekday: 1 }).startSection, parseOne({ name: 'A', sections: '10-12', weeks: '1-18', weekday: 1 }).endSection], [10, 12]);
check('节次：10-10节 原样保留（不会变成 10-11）', [parseOne({ name: 'A', sections: '10-10', weeks: '2周', weekday: 1 }).startSection, parseOne({ name: 'A', sections: '10-10', weeks: '2周', weekday: 1 }).endSection], [10, 10]);

const richCell = parseOne({
  name: '电工电子技术★',
  sections: '1-2',
  weeks: '1-18周',
  weekday: 1,
  teacher: '吴高标',
  room: '5-409',
  campus: '椒江校区',
});
check('课程名解析（去掉类型标记）', richCell.name, '电工电子技术');
check('课程类型标记 ★ → 理论', richCell.note, '理论');
check('教师解析', richCell.teacher, '吴高标');
check('教室解析', richCell.room, '5-409');
check('校区解析', richCell.campus, '椒江校区');
check('星期解析（坐标 → weekday）', richCell.weekday, 1);
check('类型标记 ○ → 实验', parseOne({ name: 'B○', sections: '3-5', weeks: '2周', weekday: 2 }).note, '实验');
check('类型标记 ● → 实践', parseOne({ name: 'C●', sections: '3-5', weeks: '2周', weekday: 3 }).note, '实践');
check('星期解析：第 5 列 → 周五', parseOne({ name: 'D', sections: '1-2', weeks: '1周', weekday: 5 }).weekday, 5);

// 多教学安排：同一天同一课程、不同节次 → 不能合并
const multi = parseSchedulePages([
  fakePage([
    { name: 'Java高级编程★', sections: '2-3', weeks: '1-4周,6-18周', weekday: 3, teacher: '邓军' },
    { name: 'Java高级编程○', sections: '4-5', weeks: '1-4周,6-18周', weekday: 3, teacher: '邓军' },
    { name: 'Java高级编程★', sections: '10-12', weeks: '6-18周(双)', weekday: 3, teacher: '邓军' },
  ]),
]).rows;
check('多教学安排不错误合并（不同节次 → 3 条安排）', multi.length, 3);
check('三条安排的节次各自正确', multi.map((r) => `${r.startSection}-${r.endSection}`).sort(), ['10-12', '2-3', '4-5']);

// 同一天同一节次、只有周次不同 → 合并周次而不是丢弃
const sameSlot = parseSchedulePages([
  fakePage([
    { name: '大学物理及实验B2○', sections: '6-8', weeks: '3周,7周', weekday: 1, room: '航-N903' },
    { name: '大学物理及实验B2○', sections: '6-8', weeks: '9-11周(单)', weekday: 1, room: '航-N915' },
    { name: '大学物理及实验B2○', sections: '6-8', weeks: '13周,17周', weekday: 1, room: 'N901' },
  ]),
]).rows;
check('同节次不同周次：合并为 1 条且周次取并集', [sameSlot.length, sameSlot[0].weeks], [1, '3,7,9,11,13,17']);

// 无课程 / 无法识别
const emptyPdf = parseSchedulePages([{ items: [{ str: '这是一份普通的 PDF', x: 10, y: 100 }] }]);
check('没有星期表头 → 明确报告无法识别', [emptyPdf.rows.length, emptyPdf.warnings.length > 0], [0, true]);
(() => {
  try {
    rowsFromPages([{ items: [{ str: '无关内容', x: 10, y: 100 }] }]);
    check('无课程 PDF → ImportError', 'no-throw', 'ImportError');
  } catch (error) {
    check('无课程 PDF → ImportError', [error instanceof ImportError, error.message], [true, '暂时无法识别此学校的课表 PDF 格式。']);
  }
})();

// 统一 ImportResult（要求十二）
const pdfResult = pdfRowsToCourses(
  parseSchedulePages([
    fakePage([
      { name: '离散数学★', sections: '3-5', weeks: '1-3周,5-7周', weekday: 4, teacher: '张海良', room: '2-404' },
    ]),
  ]).rows,
);
check('PDF → 统一 ImportResult（source=pdf）', [pdfResult.source, pdfResult.courses.length], ['pdf', 1]);
check(
  'PDF 导入的课程字段符合现有 Course 模型',
  [pdfResult.courses[0].id !== undefined, pdfResult.courses[0].name, pdfResult.courses[0].teacher, pdfResult.courses[0].room, pdfResult.courses[0].weekday, pdfResult.courses[0].weeks],
  [true, '离散数学', '张海良', '2-404', 4, '1-3,5-7'],
);
check(
  'PDF 导入的课程能直接进入现有 layout-engine',
  buildLayout({ courses: pdfResult.courses, week: 3, metrics, weekDates: getWeekDates(termStart, 3, TODAY) }).courseCount,
  1,
);
check(
  'PDF 导入的课程能被现有 week-utils 过滤（第 4 周不上课）',
  isCourseInWeek(pdfResult.courses[0], 4),
  false,
);

// 损坏 / 非 PDF 文件（走真实 importPdfFile）
await (async () => {
  try {
    await importPdfFile({ name: 'a.csv', type: 'text/csv', arrayBuffer: async () => new ArrayBuffer(8) });
    check('非 PDF 文件 → 友好提示', 'no-throw', 'ImportError');
  } catch (error) {
    check('非 PDF 文件 → 友好提示', [error instanceof ImportError, error.message], [true, '请选择 PDF 文件']);
  }
  try {
    await importPdfFile({
      name: 'broken.pdf',
      type: 'application/pdf',
      arrayBuffer: async () => new TextEncoder().encode('this is not a pdf at all').buffer,
    });
    check('损坏 PDF → 友好提示（不白屏）', 'no-throw', 'ImportError');
  } catch (error) {
    check('损坏 PDF → 友好提示（不白屏）', [error instanceof ImportError, error.message], [true, '无法读取此 PDF，请确认文件未损坏。']);
  }
})();

/* --------------------------------------------- 14. 晚课节次（10~12）回归 */
section('14. 晚课节次 10~12：真实 PDF 缺失问题的回归测试');

check('每日节次数已扩到 12', SECTIONS_PER_DAY, 12);
check('第 10/11/12 节已纳入配置', SECTION_TIMES.filter((s) => s.section >= 10).map((s) => s.section), [10, 11, 12]);
check(
  '晚课时间与真实课表一致',
  SECTION_TIMES.filter((s) => s.section >= 10).map((s) => `${s.start}-${s.end}`),
  ['19:00-19:40', '19:45-20:25', '20:30-21:10'],
);
check('第 1~9 节时间未被改动（无回归）', SECTION_TIMES.slice(0, 9).map((s) => `${s.start}-${s.end}`), [
  '08:00-08:40', '08:45-09:25', '09:45-10:25', '10:30-11:10', '11:15-11:55',
  '14:00-14:40', '14:45-15:25', '15:45-16:25', '16:30-17:10',
]);

// 10-10 / 10-12 / 9-12 都必须被 course-model 接受
const late1010 = normalizeCourse({ name: '晚课A', weekday: 1, startSection: 10, endSection: 10, weeks: '2周' });
const late1012 = normalizeCourse({ name: '晚课B', weekday: 5, startSection: 10, endSection: 12, weeks: '6-18周(双)' });
const late912 = normalizeCourse({ name: '晚课C', weekday: 1, startSection: 9, endSection: 12, weeks: '1-18周' });
check('10-10 节被接受且不被改写', [late1010.startSection, late1010.endSection], [10, 10]);
check('10-12 节被接受', [late1012.startSection, late1012.endSection], [10, 12]);
check('9-12 节被接受', [late912.startSection, late912.endSection], [9, 12]);
check('校验没有被放得太宽（第 13 节仍非法）', validateCourse({ name: 'X', weekday: 1, startSection: 13, endSection: 13 }).ok, false);

// PDF 行 → Course[] → layout：晚课必须真的落进第 10~12 行
const lateRows = [
  { name: '大学物理及实验B2', teacher: '周英', room: '学习通（超星）', weekday: 7, startSection: 10, endSection: 10, weeks: '2周', campus: '椒江校区' },
  { name: '电工电子技术', teacher: '吴高标', room: 'K-507数字电路实验室', weekday: 1, startSection: 10, endSection: 12, weeks: formatWeeks(parsePdfWeeks('6-18周(双)')), campus: '椒江校区' },
  { name: '习近平新时代中国特色社会主义思想概论', teacher: '胡晓鹤', room: '5-302', weekday: 5, startSection: 10, endSection: 12, weeks: '18周', campus: '椒江校区' },
];
const lateResult = pdfRowsToCourses(lateRows);
check('PDF 晚课行 → Course[]（3 条全部通过校验）', lateResult.courses.length, 3);
check('晚课周次解析正确（6-18双）', lateResult.courses.find((c) => c.name === '电工电子技术').weeks, '6-18(双)');

const lateLayout = buildLayout({
  courses: lateResult.courses,
  week: 18,
  metrics,
  weekDates: getWeekDates(termStart, 18, TODAY),
});
const eveningCard = lateLayout.days[0].items.find((i) => i.course.startSection === 10);
check('晚课卡片落在第 10 行（不是被挤到第 9 行）', eveningCard.top, sectionTop(10, metrics) + 3);
check('晚课卡片跨 10-12 节高度正确', eveningCard.height, 3 * 50 + 2 * 4 - 6);
check('晚课与白天课程不冲突（不同节次）', findConflictingCourseIds(lateResult.courses).size, 0);
check(
  '第 18 周能看到晚课（周日 10-10 节 + 周一/周五 10-12 节）',
  lateLayout.days.map((d) => d.items.length),
  [1, 0, 0, 0, 1, 0, 1],
);

/* ------------------------------------------- 15. 夏令 / 冬令时间制切换 */
section('15. 夏令 / 冬令时间制：配置 / 持久化 / 布局');

const slotsOf = (season) => getSectionTimes(season).map((s) => `${s.start}-${s.end}`);

check('summer 有 12 节', TIME_SLOT_CONFIG.summer.length, 12);
check('winter 有 12 节', TIME_SLOT_CONFIG.winter.length, 12);
check('SECTIONS_PER_DAY 由配置派生', SECTIONS_PER_DAY, TIME_SLOT_CONFIG.summer.length);

check('summer 第 1~5 节', slotsOf('summer').slice(0, 5), [
  '08:00-08:40', '08:45-09:25', '09:45-10:25', '10:30-11:10', '11:15-11:55',
]);
check('winter 第 1~5 节（与夏季相同）', slotsOf('winter').slice(0, 5), slotsOf('summer').slice(0, 5));
check('summer 第 6~9 节', slotsOf('summer').slice(5, 9), ['14:00-14:40', '14:45-15:25', '15:45-16:25', '16:30-17:10']);
check('winter 第 6~9 节（与夏季不同）', slotsOf('winter').slice(5, 9), ['13:30-14:10', '14:15-14:55', '15:15-15:55', '16:00-16:40']);
check('summer 第 10~12 节', slotsOf('summer').slice(9), ['19:00-19:40', '19:45-20:25', '20:30-21:10']);
check('winter 第 10~12 节', slotsOf('winter').slice(9), ['18:30-19:10', '19:15-19:55', '20:00-20:40']);

// 逐节精确断言（需求八 第 5~18 条）
const summerSlots = getSectionTimes('summer');
const winterSlots = getSectionTimes('winter');
for (const [index, expected] of [
  [6, '14:00-14:40'], [7, '14:45-15:25'], [8, '15:45-16:25'], [9, '16:30-17:10'],
  [10, '19:00-19:40'], [11, '19:45-20:25'], [12, '20:30-21:10'],
]) {
  const slot = summerSlots.find((s) => s.section === index);
  check(`summer 第 ${index} 节 = ${expected}`, `${slot.start}-${slot.end}`, expected);
}
for (const [index, expected] of [
  [6, '13:30-14:10'], [7, '14:15-14:55'], [8, '15:15-15:55'], [9, '16:00-16:40'],
  [10, '18:30-19:10'], [11, '19:15-19:55'], [12, '20:00-20:40'],
]) {
  const slot = winterSlots.find((s) => s.section === index);
  check(`winter 第 ${index} 节 = ${expected}`, `${slot.start}-${slot.end}`, expected);
}

check('section 1~12 都合法', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].every((n) => validateCourse({ name: 'X', weekday: 1, startSection: n, endSection: n }).ok), true);
check('section 13 仍然非法', validateCourse({ name: 'X', weekday: 1, startSection: 13, endSection: 13 }).ok, false);
check('非法时间制回退到默认（summer）', getSectionTimes('autumn').map((s) => s.start), summerSlots.map((s) => s.start));
check('默认时间制是 summer', DEFAULT_TIME_SEASON, 'summer');

// Course 语义数据不随时间制变化
const seasonCourse = normalizeCourse({ name: '电工电子技术', weekday: 1, startSection: 6, endSection: 9, weeks: '1-18', teacher: '吴高标', room: '5-409' });
const beforeSwitch = JSON.stringify(seasonCourse);
getSectionTimes('winter');
check('切换时间制不会改变 Course（startSection/endSection 等）', JSON.stringify(seasonCourse), beforeSwitch);
check('Course 里没有 startTime / endTime 字段', ['startTime', 'endTime', 'start_time'].some((k) => k in seasonCourse), false);

// layout 在两种时间制下使用对应时间，但几何完全一致
const seasonLayoutSummer = buildLayout({ courses: [seasonCourse], week: 3, metrics, weekDates: w3, sectionTimes: getSectionTimes('summer') });
const seasonLayoutWinter = buildLayout({ courses: [seasonCourse], week: 3, metrics, weekDates: w3, sectionTimes: getSectionTimes('winter') });
const summerRail = seasonLayoutSummer.slots.map((s) => `${s.section}:${s.start}-${s.end}`);
const winterRail = seasonLayoutWinter.slots.map((s) => `${s.section}:${s.start}-${s.end}`);
check('layout(summer) 的节次栏用夏令时间', [summerRail[5], summerRail[9], summerRail[11]], ['6:14:00-14:40', '10:19:00-19:40', '12:20:30-21:10']);
check('layout(winter) 的节次栏用冬令时间', [winterRail[5], winterRail[9], winterRail[11]], ['6:13:30-14:10', '10:18:30-19:10', '12:20:00-20:40']);
check('两种时间制的卡片几何完全一致（只换时间，不动布局）',
  seasonLayoutSummer.days[0].items.map((i) => [i.top, i.height]),
  seasonLayoutWinter.days[0].items.map((i) => [i.top, i.height]),
);
check('夏令：第 6-9 节显示 14:00 → 17:10', `${summerSlots[5].start}-${summerSlots[8].end}`, '14:00-17:10');
check('冬令：第 6-9 节显示 13:30 → 16:40', `${winterSlots[5].start}-${winterSlots[8].end}`, '13:30-16:40');
check('夏令：第 10-12 节显示 19:00 → 21:10', `${summerSlots[9].start}-${summerSlots[11].end}`, '19:00-21:10');
check('冬令：第 10-12 节显示 18:30 → 20:40', `${winterSlots[9].start}-${winterSlots[11].end}`, '18:30-20:40');

// store：默认 / 切换 / 持久化 / 非法值回退
const seasonStorage = createMemoryStorage();
const seasonStore = createCourseStore({ term: DEFAULT_TERM, storage: seasonStorage, courseStorage: createMemoryStorage(), today: new Date(2026, 8, 26) });
check('store 默认 timeSeason = summer', seasonStore.getState().timeSeason, 'summer');
check('store 的 timeSlots 是夏令 12 节', seasonStore.getState().timeSlots.length, 12);
check('store 的 timeSeasonLabel 清晰可显示', seasonStore.getState().timeSeasonLabel, '夏令时间');

seasonStore.setTimeSeason('winter');
check('切到 winter 后状态变化', [seasonStore.getState().timeSeason, seasonStore.getState().timeSeasonLabel], ['winter', '冬令时间']);
check('切到 winter 后第 6 节时间变化', seasonStore.getState().timeSlots[5].start, '13:30');
check('切换时间制不影响课程数据', seasonStore.getState().courses.length, 9);
check('winter 已写入 localStorage', seasonStorage.get('timeSeason'), 'winter');

const restoredStore = createCourseStore({ term: DEFAULT_TERM, storage: seasonStorage, courseStorage: createMemoryStorage(), today: new Date(2026, 8, 26) });
check('重新初始化（等价刷新页面）后恢复 winter', restoredStore.getState().timeSeason, 'winter');

seasonStore.setTimeSeason('summer');
check('可以切回 summer 并保存', [seasonStore.getState().timeSeason, seasonStorage.get('timeSeason')], ['summer', 'summer']);

const badStorage = createMemoryStorage();
badStorage.set('timeSeason', 'spring');
const badStore = createCourseStore({ term: DEFAULT_TERM, storage: badStorage, courseStorage: createMemoryStorage(), today: new Date(2026, 8, 26) });
check('localStorage 非法值 → 回退 summer', badStore.getState().timeSeason, 'summer');

const emptyStorage = createMemoryStorage();
const emptyStore = createCourseStore({ term: DEFAULT_TERM, storage: emptyStorage, courseStorage: createMemoryStorage(), today: new Date(2026, 8, 26) });
check('localStorage 没有值 → 默认 summer', emptyStore.getState().timeSeason, 'summer');
check('setTimeSeason(非法值) 不会破坏状态', (() => { emptyStore.setTimeSeason('nonsense'); return emptyStore.getState().timeSeason; })(), 'summer');
check('toggleTimeSeason 在夏令冬令间来回切', (() => {
  const s = createCourseStore({ term: DEFAULT_TERM, storage: createMemoryStorage(), courseStorage: createMemoryStorage(), today: new Date(2026, 8, 26) });
  s.toggleTimeSeason();
  const a = s.getState().timeSeason;
  s.toggleTimeSeason();
  return [a, s.getState().timeSeason];
})(), ['winter', 'summer']);
check('localStorage 里没有保存任何敏感信息', !/cookie|token|password|session/i.test(JSON.stringify(seasonStorage.get('timeSeason'))), true);

/* ------------------------------- 16. 季节主题 / 晚上分界线 / start.bat */
section('16. 季节主题（夏令/冬令）· 晚上分界线 · start.bat 依赖检测');

// A. 季节主题状态
const themeStorage = createMemoryStorage();
const themeStore = createCourseStore({ term: DEFAULT_TERM, storage: themeStorage, courseStorage: createMemoryStorage(), today: new Date(2026, 8, 26) });
check('季节主题：默认 summer 且时间制一致', [themeStore.getState().timeSeason, DEFAULT_TIME_SEASON], ['summer', 'summer']);
themeStore.setTimeSeason('winter');
check('季节主题：切到 winter', themeStore.getState().timeSeason, 'winter');
check('季节主题：toggle 往返', (() => { themeStore.toggleTimeSeason(); const back = themeStore.getState().timeSeason; themeStore.toggleTimeSeason(); return [back, themeStore.getState().timeSeason]; })(), ['summer', 'winter']);

// CSS：变量与过渡规则（静态检查，确保实现符合要求）
const tokensCss = readFileSync(join(projectRoot, 'src', 'styles', 'tokens.css'), 'utf8');
const baseCss = readFileSync(join(projectRoot, 'src', 'styles', 'base.css'), 'utf8');
check('CSS：summer / winter 两套变量都存在', [tokensCss.includes(':root[data-season="summer"]'), tokensCss.includes(':root[data-season="winter"]')], [true, true]);
check('CSS：使用 var(--season-*) 变量表达季节色', (tokensCss.match(/var\(--season-/g) ?? []).length >= 6, true);
check('CSS：过渡时长在 250~400ms', /transition:\s*background-color 0\.3s/.test(tokensCss), true);
check('CSS：没有 transition: all', /transition:\s*all/.test(tokensCss), false);
check('CSS：支持 prefers-reduced-motion（季节过渡可关闭）', /prefers-reduced-motion[\s\S]{0,400}transition: none/.test(tokensCss), true);
check('CSS：base.css 全局 reduced-motion 规则仍然在', baseCss.includes('prefers-reduced-motion'), true);
check('CSS：季节色不影响课程卡片变量', /--card-bg|--card-ink|--card-sub/.test(tokensCss.split('季节主题')[1] ?? ''), false);

// B. 晚上分界线
check('分界线配置：5（上午/下午）+ 9（下午/晚上）', BREAK_AFTER_SECTIONS, [5, 9]);
const timetableCss = readFileSync(join(projectRoot, 'src', 'styles', 'timetable.css'), 'utf8');
const railSummer = buildLayout({ courses: [], week: 3, metrics, weekDates: w3, sectionTimes: getSectionTimes('summer') });
const railWinter = buildLayout({ courses: [], week: 3, metrics, weekDates: w3, sectionTimes: getSectionTimes('winter') });
/** 只到第 9 节结束的课（原来的"理工英语"场景）：卡片底边会直接压在晚上分界线附近 */
const MONDAY_TO_NINE = [{
  id: 'probe-to-9', name: '理工英语', weekday: 1,
  startSection: 1, endSection: 9, weeks: '1-16', room: 'A101', teacher: '张老师', type: '必修',
}];
/** 真正跨晚上分界线的课（8~12 节）：本就要跨线，几何不能被修复波及 */
const CROSS_EVENING_COURSE = [{
  id: 'probe-cross-9-10', name: '晚课实训', weekday: 1,
  startSection: 8, endSection: 12, weeks: '1-16', room: 'A101', teacher: '张老师', type: '必修',
}];
check('分界线数量 = 2（不重复插入）', railSummer.breaks.length, 2);
check('分界线位于第 5 节之后与第 9 节之后', railSummer.breaks.map((b) => b.afterSection), [5, 9]);
check('两条主线各自带语义标签（中午 / 晚上，由 afterSection 决定，不靠 DOM 顺序）',
  railSummer.breaks.map((b) => [b.afterSection, b.label]), [[5, '☀️ 中午'], [9, '🌙 晚上']]);
check('标签文案与 BREAK_LABELS 配置一致', [railSummer.breaks[0].label, railSummer.breaks[1].label],
  [BREAK_LABELS[5], BREAK_LABELS[9]]);
/*
 * 分界线定位（任务 A 修复点）：
 *   第 5 节后（上午/下午）有 breakExtra 留白 → 落在留白正中 = 第 6 节顶部 − breakExtra/2
 *   第 9 节后（下午/晚上）没有留白 → 落在节间缝隙正中 = 第 10 节顶部 − slotGap/2
 * 旧实现两条线一律减 breakExtra/2，把晚上那条抬高 13px 扎进第 9 节内部。
 */
check('第 5 节后分界线 = 第 6 节顶部上移半个留白',
  railSummer.breaks[0].top, sectionTop(6, metrics) - metrics.breakExtra / 2);
check('第 9 节后分界线 = 第 10 节顶部上移半个节间隙',
  railSummer.breaks[1].top, sectionTop(10, metrics) - metrics.slotGap / 2);
check('第 9 节后的分界线不再被抬高半个 breakExtra',
  railSummer.breaks[1].top === sectionTop(10, metrics) - metrics.breakExtra / 2, false);
/*
 * 关键：节次栏那一段**不是另一条线**。.tt-break 的 left:0 → right:0 本身就横跨节次栏，
 * 两条线共用同一个 top，从结构上就不可能错位（旧实现用 CSS 公式在节次栏另画一条，
 * 实测差 23.5px，改成 2px 后是明显断线）。
 */
check('节次栏与课程区共用同一条线（无独立的节次栏分界线元素）',
  [timetableCss.includes('.rail-break'), /\.slot--divider::after/.test(timetableCss)], [false, false]);
check('分界线图层盖在吸顶节次栏之上（横向滚动时节次栏那段线才不会被遮掉）',
  /\.tt-break-layer\s*\{[^}]*z-index:\s*3/.test(timetableCss), true);
check('分界线横跨整行（left:0 → right:0），左端自然落在节次栏里',
  /\.tt-break\s*\{[^}]*left:\s*0[^}]*right:\s*0/.test(timetableCss), true);
check('晚上分界线落在第 9 节盒底与第 10 节顶部之间',
  [sectionTop(9, metrics) + metrics.slotHeight < railSummer.breaks[1].top, railSummer.breaks[1].top < sectionTop(10, metrics)],
  [true, true]);
check('中午分界线落在第 5 节盒底与第 6 节顶部之间',
  [sectionTop(5, metrics) + metrics.slotHeight < railSummer.breaks[0].top, railSummer.breaks[0].top < sectionTop(6, metrics)],
  [true, true]);
check('endSection = 9 的课程卡片底不越过晚上分界线（含真实 fitMetrics 自适应行高）', (() => {
  const m2 = fitMetrics(metrics, 700);
  const layout2 = buildLayout({ courses: MONDAY_TO_NINE, week: 3, metrics: m2, weekDates: w3 });
  const card = layout2.days[0].items[0];
  const evening = layout2.breaks.find((b) => b.afterSection === 9);
  return [card.top, card.height, card.top + card.height - evening.top];
})(), [
  sectionTop(1, fitMetrics(metrics, 700)) + 3,
  9 * fitMetrics(metrics, 700).slotHeight + 8 * fitMetrics(metrics, 700).slotGap
    + fitMetrics(metrics, 700).breakExtra - fitMetrics(metrics, 700).cardGapY,
  -5,
]);
check('跨 9→10 节的课程几何不受修复影响（top / height 逐字段比对）', (() => {
  const layout2 = buildLayout({ courses: CROSS_EVENING_COURSE, week: 3, metrics, weekDates: w3 });
  const item = layout2.days[0].items[0];
  return [item.top, item.height, item.top === sectionTop(8, metrics) + 3, item.top + item.height === sectionTop(12, metrics) + metrics.slotHeight - 3];
})(), [
  sectionTop(8, metrics) + 3,
  sectionTop(12, metrics) + metrics.slotHeight - metrics.cardGapY / 2 - (sectionTop(8, metrics) + 3),
  true,
  true,
]);
check('两个季节的分界线几何完全一致（只换时刻，不换位置）',
  [railSummer.breaks.map((b) => b.top), railSummer.totalHeight, railWinter.totalHeight],
  [railWinter.breaks.map((b) => b.top), railSummer.totalHeight, railSummer.totalHeight]);

// B2. 主线语义（任务 B：5 / 9 两条线加粗，其它保持 hairline）
check('主线配置：5（上午/下午）+ 9（下午/晚上）', MAJOR_BREAK_AFTER_SECTIONS, [5, 9]);
check('两条分界线都标记为主线（不靠 DOM 顺序判断）', railSummer.breaks.map((b) => b.major), [true, true]);
check('主线集合是分界线集合的子集', MAJOR_BREAK_AFTER_SECTIONS.every((s) => BREAK_AFTER_SECTIONS.includes(s)), true);
check('分界线语义字段齐全（afterSection / top / label / major）',
  railSummer.breaks.map((b) => [typeof b.afterSection, typeof b.top, typeof b.label, typeof b.major]),
  [['number', 'number', 'string', 'boolean'], ['number', 'number', 'string', 'boolean']]);
check('CSS：存在主线样式 .tt-break--major', /\.tt-break--major\s*\{/.test(timetableCss), true);
check('CSS：主线高度为 2px', /\.tt-break--major\s*\{[^}]*height:\s*2px/.test(timetableCss), true);
check('CSS：普通分隔线仍是 1px hairline（没有被一起加粗）', /\.tt-break\s*\{[^}]*height:\s*1px/.test(timetableCss), true);
check('CSS：主线使用独立颜色变量（不是 --line，跟随季节/主题过渡）', /--break-major-line/.test(timetableCss) && /--break-major-line/.test(tokensCss), true);
check('CSS：主线用 margin-top:-1px 把 2px 带整体压进节间缝隙（上边缘对齐原 1px 线位置，且避开 transform 亚像素栅格化）',
  /\.tt-break--major\s*\{[^}]*margin-top:\s*-1px/.test(timetableCss), true);
check('CSS：主线不使用 transform 定位（避免亚像素栅格化带来的位置漂移）',
  /\.tt-break--major\s*\{[^}]*transform:/.test(timetableCss), false);
check('CSS：节次栏那条线改用 .tt-break 的整行横线（不再单独推算定位）',
  [timetableCss.includes('.tt-break-layer'), /\.slot--divider::after/.test(timetableCss)], [true, false]);
check('CSS：四个主题各有一份主线颜色（亮/暗 × 夏令/冬令）',
  (tokensCss.match(/--break-major-line:/g) ?? []).length, 4);
check('CSS：主线颜色参与季节平滑过渡', /transition:[^;]*background-color 0\.3s/.test(tokensCss) && /\.tt-break,/.test(tokensCss), true);

// B3. 🌙 晚上 标签：贴在线右端、与线垂直居中、不参与布局流
check('🌙 晚上 标签贴在分界线**右端**（right 锚定，不占用节次栏 / 时间节点内部空间）',
  /\.tt-break__label\s*\{[^}]*right:\s*6px/.test(tokensCss) && !/\.tt-break__label\s*\{[^}]*left:/.test(tokensCss), true);
check('🌙 晚上 标签与分界线垂直居中（上下对称外扩 + flex 居中，不依赖具体高度）',
  /\.tt-break__label\s*\{[^}]*top:\s*-8px[^}]*bottom:\s*-8px[^}]*align-items:\s*center/.test(tokensCss), true);
check('🌙 晚上 标签绝对定位（不参与布局流，不增加课表高度）',
  /\.tt-break__label\s*\{[^}]*position:\s*absolute/.test(tokensCss), true);
check('🌙 晚上 文案未改动', BREAK_LABELS[9], '🌙 晚上');
check('☀️ 中午 文案（新增在 5→6 分界线）', BREAK_LABELS[5], '☀️ 中午');
check('两条分界线都有标签（标签数量 = 2）', railSummer.breaks.filter((b) => b.label).length, 2);
check('标签只渲染在带 label 的那条线上（timetable.js 以 item.label 为条件）',
  /item\.label\s*\?\s*\[/.test(readFileSync(join(projectRoot, 'src', 'components', 'timetable.js'), 'utf8')), true);
check('标签用 right 锚定，因此必然位于线中点右侧（不会落回节次栏里）',
  /\.tt-break__label\s*\{[^}]*right:/.test(tokensCss) && metrics.railWidth * 2 < 300, true);
check('两条线共用同一套标签样式（只有一个 .tt-break__label 规则块）',
  (tokensCss.match(/\.tt-break__label\s*\{/g) ?? []).length, 1);
check('标签背景取自 season/theme token（不是写死的白色 / 新颜色体系）',
  /\.tt-break__label\s*\{[^}]*background:\s*var\(--season-/.test(tokensCss) &&
    /\.tt-break__label\s*\{[^}]*background:\s*var\(--season-btn-bg,\s*var\(--surface-muted\)\)/.test(tokensCss) &&
    !/\.tt-break__label\s*\{[^}]*background:\s*(#|rgb|white)/.test(tokensCss), true);
check('标签背景不透明（season 底色是不带 alpha 的 #hex → 能完全遮住穿过它的 2px 线；夜间回落到不透明的 --surface-muted）',
  (tokensCss.match(/--season-btn-bg:\s*#[0-9a-f]{6}\s*;/g) ?? []).length, 2);
check('标签上下各外扩 8px，比 2px 线更高（线不会从标签框上下露出）',
  /\.tt-break__label\s*\{[^}]*top:\s*-8px[^}]*bottom:\s*-8px/.test(tokensCss) &&
    /\.tt-break--major\s*\{[^}]*height:\s*2px/.test(timetableCss), true);
check('第 1~9 节不会被错误插入分界线', railSummer.slots.filter((s) => s.isBreak).map((s) => s.section), [5, 9]);
check('只有第 5 / 9 节之后有标签（10~12 节不重复）', railSummer.slots.filter((s) => s.breakLabel).map((s) => s.section), [5, 9]);
check('夏令与冬令的分界线位置完全一致（按节次判断，不看时间）',
  railSummer.breaks.map((b) => b.top),
  railWinter.breaks.map((b) => b.top),
);
check('夏令第 10 节 19:00 / 冬令 18:30，但分界位置相同', [railSummer.slots[9].start, railWinter.slots[9].start, railSummer.breaks[1].top === railWinter.breaks[1].top], ['19:00', '18:30', true]);
check('兼容字段 breakTop 仍指向第一条分界线', railSummer.breakTop, railSummer.breaks[0].top);
check('分界线不影响课程卡片几何', (() => {
  const withBreak = buildLayout({ courses: MOCK_COURSES, week: 3, metrics, weekDates: w3 });
  const java = withBreak.days[2].items.find((i) => i.course.name === 'Java高级编程');
  return [java.top, java.height];
})(), [sectionTop(3, metrics) + 3, 3 * 50 + 2 * 4 - 6]);

// C. start.bat 依赖检测（静态检查；行为验证见 npm run check:start）
const startBat = readFileSync(join(projectRoot, 'start.bat'), 'utf8');
check('start.bat：检查 Node.js', /where node/.test(startBat), true);
check('start.bat：检查 npm', /where npm/.test(startBat), true);
check('start.bat：缺少 Node.js 时明确提示并退出', /没有找到 Node\.js[\s\S]{0,200}exit \/b 1/.test(startBat), true);
check('start.bat：真的检查 pdfjs-dist（不只检查 node_modules）', startBat.includes('node_modules\\pdfjs-dist\\package.json'), true);
check('start.bat：依赖缺失才 npm install（有条件分支）', /if defined NEED_INSTALL[\s\S]{0,400}call npm install/.test(startBat), true);
check('start.bat：npm install 失败不继续启动', /npm install 失败[\s\S]{0,200}exit \/b 1/.test(startBat), true);
check('start.bat：安装后二次确认，防"假成功"', /仍找不到 node_modules\\pdfjs-dist/.test(startBat), true);
check('start.bat：cd 到脚本所在目录（支持路径含空格）', /cd \/d "%~dp0"/.test(startBat), true);
check('start.bat：启动命令保持不变（dev-server）', /node scripts\\dev-server\.mjs/.test(startBat), true);

/* ---------------------------------------------------------- 结果汇总 */
console.log('');
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项检查 ✅`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项 ❌\n`);
  for (const f of failures) console.log(`  • ${f}\n`);
  process.exit(1);
}
