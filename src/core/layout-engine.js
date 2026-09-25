/**
 * 布局引擎：把「课程数据 + 当前周」换算成绝对定位所需的几何信息。
 *
 * 完全无副作用、不碰 DOM（除了读一次 CSS 变量），因此可以被单元测试
 * （见 scripts/check-layout.mjs）也可以被未来的打印 / 导出 / 周视图复用。
 *
 * 坐标模型：
 *   sectionTop(s) = 第 s 节顶部 y 坐标
 *   每节占 slotHeight，节与节之间 slotGap，
 *   第 breakAfterSection 节之后额外留出 breakExtra（上午 / 下午分隔）
 */

import {
  BREAK_AFTER_SECTIONS,
  BREAK_LABELS,
  MAJOR_BREAK_AFTER_SECTIONS,
  SECTIONS_PER_DAY,
  SECTION_TIMES,
  DEFAULT_TERM,
} from '../config/term-config.js';
import { isCourseInWeek, coursesConflict, weekdayLabel } from './week-utils.js';

const DEFAULT_METRICS = {
  slotHeight: 50,
  slotGap: 4,
  breakExtra: 20,
  cardGapY: 6,
  cardGapX: 3,
  breakAfter: DEFAULT_TERM.breakAfterSection,
  totalSections: SECTIONS_PER_DAY,
  railWidth: 56,
  dayMinWidth: 90,
  laneMinWidth: 86,
};

/** 1 节课以下的卡片只显示课程名；2 节以内隐藏教室 */
const COMPACT_MAX_HEIGHT = 62;
const TIGHT_MAX_HEIGHT = 86;

/** 自适应行高的上下限：屏幕再高也不拉长，屏幕再矮也不挤成一条 */
export const MIN_SLOT_HEIGHT = 44;
export const MAX_SLOT_HEIGHT = 96;

/**
 * 让 9 节课刚好铺满可视高度（手机竖屏 / 桌面都能"一屏看完"）。
 *
 * 注意：这里会以"可视高度"为准上下浮动行高，CSS 里的 --slot-h 只是
 * 拿不到可视高度时（首屏测量失败 / Node 环境）的兜底值。
 *
 * @param {object} base             readMetrics() 的结果
 * @param {number} availableHeight  课表滚动区的可视高度
 */
export function fitMetrics(base = DEFAULT_METRICS, availableHeight = 0) {
  const m = { ...DEFAULT_METRICS, ...base };
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return m;

  const fixed = m.breakExtra + m.slotGap * (m.totalSections - 1);
  const ideal = Math.floor((availableHeight - fixed) / m.totalSections);
  const slotHeight = Math.min(Math.max(ideal, MIN_SLOT_HEIGHT), MAX_SLOT_HEIGHT);

  return { ...m, slotHeight };
}

/**
 * 从 CSS 变量读取几何尺寸（保持 CSS 与 JS 单一事实来源：
 * 断点写在 CSS 里，JS 只负责读）。
 */
export function readMetrics(root = null) {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target || typeof getComputedStyle !== 'function') return { ...DEFAULT_METRICS };
  const cs = getComputedStyle(target);
  const read = (name, fallback) => {
    const value = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    ...DEFAULT_METRICS,
    slotHeight: read('--slot-h', DEFAULT_METRICS.slotHeight),
    slotGap: read('--slot-gap', DEFAULT_METRICS.slotGap),
    breakExtra: read('--break-extra', DEFAULT_METRICS.breakExtra),
    cardGapY: read('--card-gap-y', DEFAULT_METRICS.cardGapY),
    cardGapX: read('--card-gap-x', DEFAULT_METRICS.cardGapX),
    railWidth: read('--rail-w', DEFAULT_METRICS.railWidth),
    dayMinWidth: read('--day-min-w', DEFAULT_METRICS.dayMinWidth),
    laneMinWidth: read('--lane-min-w', DEFAULT_METRICS.laneMinWidth),
  };
}

/**
 * 计算 7 天的列宽（px）。
 *
 * 规则：
 *   1. 每一天的列宽至少是 dayMinWidth；
 *   2. 如果这一天有 N 门时间重叠的课，则至少 N × laneMinWidth（否则分栏后窄到读不了）；
 *   3. 还有富余空间就平均分给 7 天，保证桌面端铺满容器而不是留一条空白。
 *
 * 只有"真的有重叠课"的那一天会变宽，其它天保持原宽度（避免整块画布被撑开）。
 *
 * @returns {number[]} 长度为 7 的列宽数组
 */
export function computeColumnWidths(days = [], availableWidth = 0, metrics = DEFAULT_METRICS) {
  const m = { ...DEFAULT_METRICS, ...metrics };
  const minWidths = days.map((day) =>
    Math.max(m.dayMinWidth, (day.maxLane ?? 1) * m.laneMinWidth),
  );
  if (minWidths.length === 0) return [];

  const sum = (list) => list.reduce((total, w) => total + w, 0);
  const minTotal = sum(minWidths);

  // 容器装不下最小宽度：保持最小宽度，把剩余部分交给横向滚动（手机就是这个分支）
  if (availableWidth <= minTotal) return minWidths;

  // 富余空间按列平均分配；取整产生的余数按小数部分从大到小补齐，
  // 这样总宽正好等于容器宽（既不会溢出多出滚动条，也不会留白），各列最多差 1px。
  const extra = (availableWidth - minTotal) / minWidths.length;
  const exact = minWidths.map((w) => w + extra);
  const widths = exact.map(Math.floor);
  let remainder = availableWidth - sum(widths);

  const order = exact
    .map((w, index) => ({ frac: w - Math.floor(w), index }))
    .sort((a, b) => b.frac - a.frac);

  for (const { index } of order) {
    if (remainder <= 0) break;
    widths[index] += 1;
    remainder -= 1;
  }

  return widths;
}

/** 第 section 节的顶部 y 坐标（section 从 1 开始；越界自动钳制） */
export function sectionTop(section, metrics = DEFAULT_METRICS) {
  const m = { ...DEFAULT_METRICS, ...metrics };
  const target = Math.max(1, Math.min(section, m.totalSections + 1));
  let y = 0;
  for (let s = 1; s < target; s += 1) {
    y += m.slotHeight + m.slotGap;
    if (s === m.breakAfter) y += m.breakExtra;
  }
  return y;
}

/** 整个网格的内容高度（最后一行不留 gap） */
export function contentHeight(metrics = DEFAULT_METRICS) {
  const m = { ...DEFAULT_METRICS, ...metrics };
  return sectionTop(m.totalSections + 1, m) - m.slotGap;
}

/**
 * 分隔线的中心线 y 坐标（**节次栏与课程区共用的唯一定位公式**）。
 *
 * 关键：只有第 breakAfter 节（上午 / 下午）之后有 breakExtra 留白，
 * 下午 / 晚上那条没有。因此偏移必须分开取：
 *   - 有留白的分界线：落在留白的正中 → breakExtra / 2
 *   - 没有留白的分界线：落在节与节之间那道缝隙的正中 → slotGap / 2
 *
 * 旧实现对所有分界线一律减 breakExtra / 2，导致晚上那条线被抬高
 * 半个留白（桌面 13px）扎进第 9 节内部，压住 8~9 节课程的卡片底边。
 */
export function breakLineTop(afterSection, metrics = DEFAULT_METRICS) {
  const m = { ...DEFAULT_METRICS, ...metrics };
  const offset = afterSection === m.breakAfter ? m.breakExtra / 2 : m.slotGap / 2;
  return sectionTop(afterSection + 1, m) - offset;
}

/**
 * 左侧节次栏的每一行几何（时间来自当前作息：夏令 / 冬令）。
 */
export function buildSlots(metrics = DEFAULT_METRICS, sectionTimes = SECTION_TIMES) {
  const m = { ...DEFAULT_METRICS, ...metrics };
  return sectionTimes.map(({ section, start, end }) => ({
    section,
    start,
    end,
    top: sectionTop(section, m) + m.cardGapY / 2,
    height: m.slotHeight - m.cardGapY,
    /** 本节之后是否有分隔线（上午/下午、下午/晚上） */
    isBreak: BREAK_AFTER_SECTIONS.includes(section) && section < m.totalSections,
    breakLabel: BREAK_LABELS[section] ?? '',
  }));
}

/**
 * 所有分隔线的位置（按节次编号判断，与时间制无关）。
 * @returns {Array<{afterSection:number, top:number, label:string, major:boolean}>}
 */
export function buildBreaks(metrics = DEFAULT_METRICS) {
  const m = { ...DEFAULT_METRICS, ...metrics };
  return BREAK_AFTER_SECTIONS.filter((section) => section < m.totalSections).map((section) => ({
    afterSection: section,
    top: breakLineTop(section, m),
    label: BREAK_LABELS[section] ?? '',
    /** 主线（上午/下午、下午/晚上）：渲染成 2px 高对比，普通分隔线仍是 1px hairline */
    major: MAJOR_BREAK_AFTER_SECTIONS.includes(section),
  }));
}

/**
 * 同一时间段内的多门课 → 横向分栏（lane）。
 *
 * 注意：传进来的 courses 必须**已经按查看周过滤好**（buildLayout 里先做 visible 过滤）。
 * 因此这里的"节次相交"就等于"这一周里真的冲突"，不存在把别的周的课拿来并排的问题。
 *
 * 算法：
 *   1. 先按开始节次把课程切成"互相连通的簇"（簇内任意课程直接/间接重叠）；
 *   2. 簇内贪心装箱：每门课放进第一条已经结束的轨道，否则新开一条；
 *   3. 簇内的轨道数即该簇所有课程的列数，宽度 = 1 / laneCount。
 * 这样不重叠的课永远占满整列，重叠的课自动平分列宽，且不会互相遮挡。
 */
export function packLanes(courses) {
  const sorted = [...courses].sort(
    (a, b) =>
      a.startSection - b.startSection ||
      b.endSection - a.endSection ||
      String(a.id).localeCompare(String(b.id)),
  );

  const result = [];
  let cluster = [];
  let clusterEnd = 0;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    const placed = [];

    for (const course of cluster) {
      let lane = laneEnds.findIndex((end) => end < course.startSection);
      if (lane === -1) {
        laneEnds.push(course.endSection);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = course.endSection;
      }
      placed.push({ course, lane });
    }

    const laneCount = laneEnds.length;
    for (const item of placed) result.push({ ...item, laneCount });

    cluster = [];
    clusterEnd = 0;
  };

  for (const course of sorted) {
    if (cluster.length && course.startSection > clusterEnd) flush();
    cluster.push(course);
    clusterEnd = Math.max(clusterEnd, course.endSection);
  }
  flush();

  return result;
}

/**
 * 找出"真的时间冲突"的课程。
 *
 * 冲突 = 同一天 && 节次区间相交 && **周次有交集**（week-utils.weeksOverlap）
 * 三个条件缺一不可：只在第 1-8 周上的课与只在第 9-16 周上的课，
 * 即使同一天同一节次也永远不会同时出现，不算冲突。
 *
 * 周次判断统一走 week-utils（全项目唯一入口），这里不重复实现。
 *
 * @param {Array} courses
 * @returns {Set<string>} 冲突课程的 id 集合
 */
export function findConflictingCourseIds(courses = []) {
  const conflicting = new Set();
  const list = courses.filter(Boolean);

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!coursesConflict(a, b)) continue;
      if (a.id) conflicting.add(a.id);
      if (b.id) conflicting.add(b.id);
    }
  }

  return conflicting;
}

/**
 * 生成整个课表的布局。
 *
 * @param {object} options
 * @param {Array}  options.courses   全部课程（会自动按周次过滤）
 * @param {number} options.week      当前查看的教学周（viewingWeek）
 * @param {object} options.metrics   readMetrics() 的返回值
 * @param {Array}  options.weekDates week-utils.getWeekDates() 的结果（7 天，含 isToday）
 * @returns {{totalHeight:number, slots:Array, breakTop:number|null, breaks:Array, days:Array, courseCount:number}}
 */
export function buildLayout({
  courses = [],
  week = 1,
  metrics = DEFAULT_METRICS,
  weekDates = [],
  /** 当前作息（夏令 / 冬令）：只影响节次栏显示的时间，不影响课程与布局几何 */
  sectionTimes = SECTION_TIMES,
} = {}) {
  const m = { ...DEFAULT_METRICS, ...metrics };
  const totalHeight = contentHeight(m);
  const slots = buildSlots(m, sectionTimes);
  const breaks = buildBreaks(m);
  /** 兼容既有字段：第一条分隔线（上午 / 下午） */
  const breakTop = breaks.length ? breaks[0].top : null;

  const visible = courses.filter((course) => isCourseInWeek(course, week));

  const days = Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    // 日期 / 是否今天 / 是否周末 全部来自 week-utils，这里不再重复计算
    const meta = weekDates[index] ?? {};
    const dayCourses = visible.filter((course) => Number(course.weekday) === weekday);
    const packed = packLanes(dayCourses);

    const items = packed.map(({ course, lane, laneCount }) => {
      // 卡片上下各留 cardGapY/2 的呼吸空间；
      // 底部按"最后一节的底边"计算，这样跨上下午的课不会把中间的间隔也算进高度
      const top = sectionTop(course.startSection, m) + m.cardGapY / 2;
      const bottom = sectionTop(course.endSection, m) + m.slotHeight - m.cardGapY / 2;
      const height = Math.max(m.slotHeight - m.cardGapY, bottom - top);
      const widthPct = 100 / laneCount;

      return {
        course,
        top,
        height,
        lane,
        laneCount,
        leftPct: lane * widthPct,
        widthPct,
        compact: height < COMPACT_MAX_HEIGHT,
        tight: height >= COMPACT_MAX_HEIGHT && height < TIGHT_MAX_HEIGHT,
      };
    });

    return {
      weekday,
      label: weekdayLabel(weekday),
      date: meta.date ?? null,
      iso: meta.iso ?? null,
      monthDay: meta.monthDay ?? null,
      isToday: Boolean(meta.isToday),
      isWeekend: meta.isWeekend ?? weekday >= 6,
      items,
      /** 这一天最多分了几栏（用于计算列宽） */
      maxLane: items.reduce((max, item) => Math.max(max, item.laneCount), 1),
    };
  });

  return {
    metrics: m,
    totalHeight,
    slots,
    breakTop,
    /** 全部时间段分隔线（上午/下午、下午/晚上） */
    breaks,
    days,
    courseCount: visible.length,
    /** 同一天里最多分了几栏（>1 时列宽需要相应加宽，否则卡片窄到读不了） */
    maxLanes: days.reduce((max, day) => Math.max(max, day.items.reduce((n, i) => Math.max(n, i.laneCount), 1)), 1),
  };
}
