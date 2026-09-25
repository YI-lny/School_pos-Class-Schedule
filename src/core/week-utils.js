/**
 * 周次 / 日期工具。
 *
 * 约定：
 *   - weekday：1 = 周一 ... 7 = 周日（与 Course.weekday 一致）
 *   - week：1 起算的教学周
 *   - 所有日期都以"本地时区当天 00:00"为准，避免 UTC 偏移导致的差一天
 */

import { WEEKDAY_LABELS, WEEKDAY_FULL_LABELS } from '../config/term-config.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' 或 Date → 本地当天 00:00 的 Date */
export function toDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 本地日期 → 'YYYY-MM-DD' */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** weekday：1(周一) ~ 7(周日) */
export function weekdayOf(date) {
  const js = date.getDay(); // 0 = 周日
  return js === 0 ? 7 : js;
}

/** 该日期所在周的周一 */
export function startOfWeek(date) {
  return addDays(date, -(weekdayOf(date) - 1));
}

/** 相差天数（b - a） */
export function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** 'MM-DD' */
export function formatMonthDay(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}-${d}`;
}

/** 'M月D日' */
export function formatChineseDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function weekdayLabel(weekday) {
  return WEEKDAY_LABELS[weekday - 1] ?? '';
}

export function weekdayFullLabel(weekday) {
  return WEEKDAY_FULL_LABELS[weekday - 1] ?? '';
}

/**
 * 计算某天属于第几教学周（可能 < 1 或 > totalWeeks）。
 * @param {string|Date} termStart 第 1 周周一
 */
export function weekOfDate(termStart, date) {
  const start = startOfWeek(toDate(termStart));
  return Math.floor(diffDays(start, toDate(date)) / 7) + 1;
}

/**
 * 当前教学周（自动获取当前周的核心逻辑）。
 * 学期开始前钳制到第 1 周；学期结束后钳制到最后一周。
 */
export function currentWeekOf(term, today = new Date()) {
  const raw = weekOfDate(term.startDate, today);
  return clamp(raw, 1, term.totalWeeks);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** 第 week 周的 7 个日期（周一 → 周日） */
export function datesOfWeek(termStart, week) {
  const monday = addDays(startOfWeek(toDate(termStart)), (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * 现实日期信息（"今天"到底是什么日子）。
 *
 * 三个概念必须分清楚，不要让它们互相污染：
 *   - date / weekday        : 现实日期本身（来自系统时间，不写死）
 *   - week (rawWeek)        : 现实日期落在第几周，可能越界（<1 或 >总周数）
 *   - currentWeek           : 把 rawWeek 钳制到学期范围内，即"现实所在周"
 *
 * @param {{startDate:string,totalWeeks:number}} term
 * @param {Date|string} [today]
 */
export function describeToday(term, today = new Date()) {
  const date = toDate(today);
  const weekday = weekdayOf(date);
  const rawWeek = weekOfDate(term.startDate, date);

  return {
    date,
    iso: toISODate(date),
    monthDay: formatMonthDay(date),
    weekday,
    weekdayLabel: weekdayLabel(weekday),
    rawWeek,
    /** 现实日期是否落在本学期内（不在的话顶部不应该有任何"今天"） */
    inTerm: rawWeek >= 1 && rawWeek <= term.totalWeeks,
    currentWeek: clamp(rawWeek, 1, term.totalWeeks),
  };
}

/**
 * getWeekDates(viewingWeek) —— 某一周的完整日期信息（本次周次逻辑的唯一出口）。
 *
 * 返回 7 项，weekday 从 1(周一) 到 7(周日)：
 *   [{ weekday, date, iso, monthDay, isToday, isWeekend }, ...]
 *
 * isToday 用"日期字符串相等"判断，因此：
 *   - 正在看现实所在周  → 恰好有一天 isToday = true
 *   - 看其它任何周      → 七天全部 isToday = false（不会出现两个"今天"）
 * 跨月、跨年都由 addDays（本地时间构造 Date）处理，不依赖"日期 + 7 天"这种硬算。
 *
 * @param {string|Date} termStart 第 1 周周一
 * @param {number} viewingWeek    用户当前正在查看的周
 * @param {Date|string} [today]   现实日期（默认取系统时间）
 */
export function getWeekDates(termStart, viewingWeek, today = new Date()) {
  const todayIso = toISODate(toDate(today));

  return datesOfWeek(termStart, viewingWeek).map((date, index) => ({
    weekday: index + 1,
    date,
    iso: toISODate(date),
    monthDay: formatMonthDay(date),
    isToday: toISODate(date) === todayIso,
    isWeekend: index + 1 >= 6,
  }));
}

/** 第 week 周的日期范围文案：'09-21 ~ 09-27'（兼容 Date[] 与 getWeekDates() 的返回值） */
export function formatWeekRange(weekDates) {
  if (!weekDates?.length) return '';
  const first = weekDates[0]?.date ?? weekDates[0];
  const last = weekDates[weekDates.length - 1]?.date ?? weekDates[weekDates.length - 1];
  return `${formatMonthDay(first)} ~ ${formatMonthDay(last)}`;
}

const matcherCache = new Map();

/**
 * 解析周次表达式，返回 (week) => boolean。
 *
 * 支持：
 *   '1-16'          连续范围
 *   '1-16(单)'      单周
 *   '1-16(双)'      双周
 *   '3,5,7-9'       混合
 *   '*' / 'all' / '全部' / 空   全周
 */
export function createWeekMatcher(spec) {
  const key = spec === null || spec === undefined ? '__all__' : String(spec).trim();
  if (matcherCache.has(key)) return matcherCache.get(key);

  const asAll = () => true;
  let matcher = asAll;

  if (key !== '' && !['*', 'all', 'ALL', '全部', '每周'].includes(key)) {
    const parity = /单/.test(key) ? 'odd' : /双/.test(key) ? 'even' : null;
    const body = key.replace(/[（(][^)）]*[)）]/g, '');
    const weeks = new Set();

    for (const part of body.split(/[,，、;；\s]+/)) {
      if (!part) continue;
      const range = part.match(/^(\d+)\s*[-~—至]\s*(\d+)$/);
      if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        for (let w = Math.min(from, to); w <= Math.max(from, to); w += 1) weeks.add(w);
      } else if (/^\d+$/.test(part)) {
        weeks.add(Number(part));
      }
    }

    if (weeks.size > 0) {
      matcher = (week) => {
        if (!weeks.has(week)) return false;
        if (parity === 'odd' && week % 2 === 0) return false;
        if (parity === 'even' && week % 2 === 1) return false;
        return true;
      };
    } else if (parity) {
      matcher = (week) => (parity === 'odd' ? week % 2 === 1 : week % 2 === 0);
    }
  }

  matcherCache.set(key, matcher);
  return matcher;
}

/** 某门课在第 week 周是否上课 */
export function isCourseInWeek(course, week) {
  return createWeekMatcher(course?.weeks)(week);
}

/** 周次表达式的比较上限（一学期不会超过这么多周，循环比较足够快） */
const MAX_WEEKS_TO_COMPARE = 60;

/**
 * 把各种 weeks 写法归一到项目**现有**的字符串表达式（不引入新的数据结构）。
 *
 * 现有格式就是 Course.weeks 字符串：'1-16' / '1-16(单)' / '1-16(双)' / '3,5,7-9' / '*'
 * 这里额外容忍外部数据可能给出的数组写法（导入别的学校数据时会遇到）：
 *   [1,2,3]            → '1,2,3'
 *   [{start:1,end:8}]  → '1-8'
 *   {start:1,end:8}    → '1-8'
 *   8                  → '8'
 */
export function normalizeWeeksSpec(spec) {
  if (spec === null || spec === undefined || spec === '') return '*';

  if (Array.isArray(spec)) {
    const parts = spec
      .map((item) => {
        if (item === null || item === undefined) return '';
        if (typeof item === 'object') {
          const start = Number(item.start ?? item.from ?? item.begin);
          const end = Number(item.end ?? item.to ?? item.finish);
          if (Number.isFinite(start) && Number.isFinite(end)) return `${start}-${end}`;
          if (Number.isFinite(start)) return String(start);
          return '';
        }
        return String(item).trim();
      })
      .filter(Boolean);
    return parts.length ? parts.join(',') : '*';
  }

  if (typeof spec === 'object') {
    const start = Number(spec.start ?? spec.from ?? spec.begin);
    const end = Number(spec.end ?? spec.to ?? spec.finish);
    if (Number.isFinite(start) && Number.isFinite(end)) return `${start}-${end}`;
    if (Number.isFinite(start)) return String(start);
    return '*';
  }

  if (typeof spec === 'number') return String(spec);
  return String(spec).trim() || '*';
}

/**
 * 两个周次表达式是否存在交集。
 *
 * ⚠️ 这是全项目**唯一**的"周次是否重叠"判断入口：
 *    课程冲突判断、导入预览标记、以后任何跟周次有关的比较都必须调用它，
 *    不要在别的文件里再写一套解析。
 *
 * @param {string|Array|object|number} a
 * @param {string|Array|object|number} b
 * @returns {boolean} 至少有一周同时上课 → true
 */
export function weeksOverlap(a, b) {
  const specA = normalizeWeeksSpec(a);
  const specB = normalizeWeeksSpec(b);

  // 全周与任何周次都有交集
  if (specA === '*' || specB === '*') return true;
  if (specA === specB) return true;

  const matchA = createWeekMatcher(specA);
  const matchB = createWeekMatcher(specB);

  for (let week = 1; week <= MAX_WEEKS_TO_COMPARE; week += 1) {
    if (matchA(week) && matchB(week)) return true;
  }
  return false;
}

/**
 * 两个周次表达式的交集周次列表（例如用来提示"冲突发生在第 5-8 周"）。
 * @returns {number[]}
 */
export function intersectWeeks(a, b) {
  const matchA = createWeekMatcher(normalizeWeeksSpec(a));
  const matchB = createWeekMatcher(normalizeWeeksSpec(b));
  const weeks = [];
  for (let week = 1; week <= MAX_WEEKS_TO_COMPARE; week += 1) {
    if (matchA(week) && matchB(week)) weeks.push(week);
  }
  return weeks;
}

/**
 * 两门课是否"真的"时间冲突 —— 必须同时满足三个条件：
 *   1. 同一天（weekday 相同）
 *   2. 节次区间有交集
 *   3. 周次有交集（weeksOverlap）
 *
 * 只判断 weekday + 节次是不够的：一周上一次的课与另一周上一次的课
 * 虽然节次相同，但现实中永远不会同时出现，不应算冲突。
 */
export function coursesConflict(a, b) {
  if (!a || !b) return false;
  if (Number(a.weekday) !== Number(b.weekday)) return false;
  if (!(a.startSection <= b.endSection && b.startSection <= a.endSection)) return false;
  return weeksOverlap(a.weeks, b.weeks);
}

/** 把周次表达式展开成周次数组（导出 / 导出 ICS 时用） */
export function expandWeeks(spec, totalWeeks = 20) {
  const matcher = createWeekMatcher(spec);
  const out = [];
  for (let w = 1; w <= totalWeeks; w += 1) if (matcher(w)) out.push(w);
  return out;
}
