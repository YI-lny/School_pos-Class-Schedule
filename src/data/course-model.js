/**
 * Course 数据模型：规范化 + 校验。
 *
 * 这是所有数据入口（mock / JSON / CSV / 未来的 Excel / 教务系统）
 * 的公共关卡：任何来源的数据都必须先过 normalizeCourse，
 * 保证 UI 层永远拿到结构一致的对象。
 *
 * Course {
 *   id, name, teacher, room, weekday, startSection, endSection, weeks, campus,
 *   color?, credits?, className?, note?
 * }
 */

import { SECTIONS_PER_DAY, WEEKDAY_LABELS } from '../config/term-config.js';

/** 稳定的字符串 id：同一门课反复导入不会产生重复项 */
export function courseKey(course) {
  const parts = [
    course?.name ?? '',
    course?.teacher ?? '',
    course?.weekday ?? '',
    course?.startSection ?? '',
    course?.endSection ?? '',
  ];
  return parts
    .join('|')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function shortHash(input) {
  let hash = 5381;
  const str = String(input);
  for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(36).slice(0, 6);
}

function toInt(value, fallback = null) {
  const n = Number.parseInt(String(value ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toText(value) {
  return String(value ?? '').trim();
}

/**
 * 规范化一门课。
 * @param {object} raw 任意来源的原始数据
 * @param {object} [options]
 * @param {string} [options.idPrefix='course']
 * @returns {object} Course
 */
export function normalizeCourse(raw = {}, { idPrefix = 'course' } = {}) {
  const name = toText(raw.name ?? raw.courseName ?? raw['课程名称'] ?? raw['课程'] ?? '未命名课程');
  const teacher = toText(raw.teacher ?? raw['教师'] ?? raw['任课教师'] ?? '');
  const room = toText(raw.room ?? raw['教室'] ?? raw['上课地点'] ?? '');
  const campus = toText(raw.campus ?? raw['校区'] ?? raw['上课校区'] ?? '');

  let weekday = toInt(raw.weekday ?? raw['星期'] ?? raw['weekDay'], 1) ?? 1;
  if (weekday === 0 || weekday === 7) weekday = 7; // 支持 0/7 都表示周日
  weekday = Math.min(Math.max(weekday, 1), 7);

  let startSection = toInt(raw.startSection ?? raw['开始节次'] ?? raw['start'], 1) ?? 1;
  let endSection = toInt(raw.endSection ?? raw['结束节次'] ?? raw['end'], startSection) ?? startSection;
  if (startSection > endSection) [startSection, endSection] = [endSection, startSection];
  startSection = Math.min(Math.max(startSection, 1), SECTIONS_PER_DAY);
  endSection = Math.min(Math.max(endSection, startSection), SECTIONS_PER_DAY);

  const weeks = toText(raw.weeks ?? raw['周次'] ?? raw['weeksLabel'] ?? '') || '*';

  const course = {
    id: toText(raw.id) || `${idPrefix}-${shortHash(courseKey({ name, teacher, weekday, startSection, endSection }))}`,
    name,
    teacher,
    room,
    campus,
    weekday,
    startSection,
    endSection,
    weeks,
  };

  // 可选字段：有值才带上，保持数据干净
  if (raw.color) course.color = toText(raw.color);
  if (raw.credits !== undefined) course.credits = Number(raw.credits) || undefined;
  if (raw.className) course.className = toText(raw.className);
  if (raw.note) course.note = toText(raw.note);

  return course;
}

/**
 * 校验（用于导入时给出友好提示，而不是直接崩）。
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateCourse(raw = {}) {
  const errors = [];
  const warnings = [];

  const name = toText(raw.name ?? raw.courseName ?? raw['课程名称']);
  if (!name) errors.push('缺少课程名称');

  const weekday = toInt(raw.weekday ?? raw['星期'], null);
  if (weekday === null) warnings.push(`缺少星期，已默认周一：${name || '(未命名)'}`);
  else if (weekday < 0 || weekday > 7) errors.push(`星期取值非法（${weekday}）：${name}`);

  const start = toInt(raw.startSection ?? raw['开始节次'], null);
  if (start === null) warnings.push(`缺少开始节次，已默认第 1 节：${name || '(未命名)'}`);
  else if (start < 1 || start > SECTIONS_PER_DAY) errors.push(`开始节次超出范围 1-${SECTIONS_PER_DAY}：${name}`);

  const end = toInt(raw.endSection ?? raw['结束节次'], null);
  if (end !== null && end > SECTIONS_PER_DAY) errors.push(`结束节次超出范围 1-${SECTIONS_PER_DAY}：${name}`);

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * 批量规范化 + 去重。
 * @returns {{courses:Array, issues:{errors:string[], warnings:string[]}, duplicates:number}}
 */
export function normalizeCourses(list = []) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const courses = [];
  let duplicates = 0;

  for (const raw of Array.isArray(list) ? list : []) {
    const check = validateCourse(raw);
    errors.push(...check.errors);
    warnings.push(...check.warnings);
    if (!check.ok) continue;

    const course = normalizeCourse(raw);
    const key = courseKey(course);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    courses.push(course);
  }

  return { courses, issues: { errors, warnings }, duplicates };
}

/** 人类可读的时间描述：'周三 第3-5节' */
export function describeCourse(course) {
  const day = WEEKDAY_LABELS[course.weekday - 1] ?? '';
  const span =
    course.startSection === course.endSection
      ? `第${course.startSection}节`
      : `第${course.startSection}-${course.endSection}节`;
  return `${day} ${span}`;
}
