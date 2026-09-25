/**
 * course-store —— 应用状态中心（极简可观测 store，零依赖）。
 *
 * 单向数据流：action → 更新 state → notify → 各组件 render(state)
 *
 * 时间概念严格分开（本次周次逻辑的核心）：
 *   A. 现实日期      todayDate()      —— 永远来自系统时间 new Date()，除非用 setToday() 模拟
 *   B. 现实所在周    state.currentWeek —— 由现实日期 + 学期 startDate 推出（钳制到学期内）
 *   C. 正在查看的周  state.viewingWeek —— 用户点 ‹ › 本周 决定的，跟现实日期无关
 *
 * 只有 A 与 B 会随系统时间变化；C 只在用户操作时变化。
 * "今天"高亮 = 正在查看的那一周里，日期字符串等于现实日期的那一天（见 week-utils.getWeekDates）。
 *
 * 已预留的扩展点：
 *   - importCourses()   Excel / CSV / JSON / 教务系统统一入口
 *   - updateCourse()    课程编辑、调课
 *   - setTerm()         切换学期、修正开学日期
 *   - setToday()        模拟现实日期（开发/测试用）
 *   - setTheme()        夜间模式
 *   - selectCourse()    课程详情面板
 */

import { DEFAULT_TERM, DEFAULT_TIME_SEASON, TIME_SEASON_LABELS, TIME_SEASONS, getSectionTimes } from '../config/term-config.js';
import { MOCK_COURSES } from '../data/course-data.js';
import { normalizeCourse, normalizeCourses } from '../data/course-model.js';
import { importPayload } from './importers/index.js';
import { createCoursePersistence } from './course-persistence.js';
import {
  clamp,
  currentWeekOf,
  describeToday,
  getWeekDates,
  isCourseInWeek,
  toDate,
  toISODate,
} from './week-utils.js';

const THEME_KEY = 'theme';
/** 夏令 / 冬令时间制的本地存储键 */
const TIME_SEASON_KEY = 'timeSeason';

/**
 * @param {object} [options]
 * @param {object} [options.term]     学期配置
 * @param {Array}  [options.courses]  初始课程（没有本地数据时使用；默认示例数据）
 * @param {string} [options.theme]    'light' | 'dark'
 * @param {object} [options.storage]  见 core/storage.js（主题等偏好）
 * @param {object} [options.courseStorage] 见 core/course-persistence.js（用户导入的课表）
 * @param {Date}   [options.today]    便于测试的时间注入
 */
export function createCourseStore({
  term = DEFAULT_TERM,
  courses = MOCK_COURSES,
  theme = 'light',
  storage = null,
  courseStorage = null,
  today = null,
} = {}) {
  const persistence = createCoursePersistence(courseStorage);

  // 优先使用用户导入并保存在本地的课表；没有才用示例（mock）数据
  const saved = persistence.load();

  let state = {
    term: { ...term, ...(saved?.term ?? {}) },
    courses: saved?.courses?.length ? saved.courses : normalizeCourses(courses).courses,
    theme,
    /** 夏令 / 冬令时间制：没有存过 → summer；存了非法值 → summer */
    timeSeason: TIME_SEASONS.includes(storage?.get(TIME_SEASON_KEY, null))
      ? storage.get(TIME_SEASON_KEY, null)
      : DEFAULT_TIME_SEASON,
    /** 'user' = 用户导入的课表（已存本地）| 'sample' = 内置示例课表 */
    dataSource: saved?.courses?.length ? 'user' : 'sample',
    savedAt: saved?.importedAt ?? null,
    /** C. 用户正在查看的周（唯一由用户操作改变的周次） */
    viewingWeek: 1,
    selectedCourseId: null,
    lastImport: null,
  };

  // 现实日期：默认实时读取系统时间；today 参数 / setToday() 只用于开发测试
  if (today) state.term.todayOverride = toISODate(toDate(today));
  let lastTodayISO = toISODate(todayDate());

  const listeners = new Set();

  /* ------------------------------------------------------------------ 派生值 */

  /** A. 现实日期（每次调用都重新读系统时间，"跨天"后自然跟着变） */
  function todayDate() {
    return state.term.todayOverride ? toDate(state.term.todayOverride) : new Date();
  }

  /** B. 现实所在周（钳制到 1 ~ totalWeeks） */
  function computeCurrentWeek() {
    return currentWeekOf(state.term, todayDate());
  }

  /** 现实日期的完整信息（含"是否在本学期内"） */
  function todayInfo() {
    return describeToday(state.term, todayDate());
  }

  /** C. 正在查看的周（永远合法：1 ~ totalWeeks） */
  function viewingWeek() {
    return clamp(Math.round(Number(state.viewingWeek) || 1), 1, state.term.totalWeeks);
  }

  function snapshot() {
    const currentWeek = computeCurrentWeek();
    const week = viewingWeek();
    const today = todayInfo();

    return {
      term: state.term,
      courses: state.courses,
      theme: state.theme,

      /* ---- 夏令 / 冬令时间制（只影响时间轴显示） ---- */
      timeSeason: state.timeSeason,
      timeSeasonLabel: TIME_SEASON_LABELS[state.timeSeason] ?? TIME_SEASON_LABELS[DEFAULT_TIME_SEASON],
      /** 当前作息对应的 12 个节次时间（节次栏渲染用） */
      timeSlots: getSectionTimes(state.timeSeason),

      /* ---- 周次：三个概念各自独立 ---- */
      viewingWeek: week, // C. 正在查看第几周
      currentWeek, // B. 现实是第几周
      totalWeeks: state.term.totalWeeks,
      isCurrentWeek: week === currentWeek,
      canGoPrev: week > 1,
      canGoNext: week < state.term.totalWeeks,
      week: week, // 兼容字段（等同 viewingWeek）

      /* ---- 日期：由 week-utils.getWeekDates 统一产出 ---- */
      weekDates: getWeekDates(state.term.startDate, week, today.date),
      todayISO: today.iso,
      todayWeekday: today.weekday,
      todayWeekdayLabel: today.weekdayLabel,
      todayInTerm: today.inTerm,
      /** 现实日期是否就落在正在查看的这一周里（顶部是否出现"今天"的唯一依据） */
      todayInViewingWeek: week === currentWeek && today.inTerm,

      selectedCourseId: state.selectedCourseId,
      lastImport: state.lastImport,
      courseCount: state.courses.length,

      /* ---- 数据来源：示例课表 / 用户导入的课表 ---- */
      dataSource: state.dataSource,
      isSampleData: state.dataSource === 'sample',
      savedAt: state.savedAt,
    };
  }

  /* -------------------------------------------------------------------- 通信 */

  function getState() {
    return snapshot();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit() {
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  }

  /* -------------------------------------------------------------------- 动作 */

  /**
   * 切换"正在查看的周"（viewingWeek）。永远钳制在 1 ~ totalWeeks，
   * 因此不可能出现第 0 周或第 17 周这种非法状态。
   */
  function goToWeek(week) {
    const next = clamp(Math.round(Number(week) || 1), 1, state.term.totalWeeks);
    if (next === state.viewingWeek) return false;
    state.viewingWeek = next;
    emit();
    return true;
  }

  const prevWeek = () => goToWeek(viewingWeek() - 1);
  const nextWeek = () => goToWeek(viewingWeek() + 1);
  const goToCurrentWeek = () => goToWeek(computeCurrentWeek());

  /**
   * 现实日期变了之后调用：如果用户本来就在"跟随现实周"，就一起跟过去；
   * 如果用户自己翻到了别的周，则尊重他的选择，不动 viewingWeek。
   */
  function followCurrentWeek(previousCurrentWeek) {
    if (state.viewingWeek !== previousCurrentWeek) return false;
    const nextCurrentWeek = computeCurrentWeek();
    if (nextCurrentWeek === previousCurrentWeek) return false;
    state.viewingWeek = nextCurrentWeek;
    return true;
  }

  /**
   * 开发 / 测试用：模拟现实日期。
   *   store.setToday('2026-09-26')  假装今天是 9-26
   *   store.setToday(null)          恢复使用系统时间
   */
  function setToday(value) {
    const previousCurrentWeek = computeCurrentWeek();
    state.term.todayOverride = value ? toISODate(toDate(value)) : null;
    lastTodayISO = toISODate(todayDate());
    followCurrentWeek(previousCurrentWeek);
    emit();
  }

  /**
   * 检查系统日期是否已经跨天（跨天则重新渲染"今天/本周"）。
   * 由 main.js 在窗口重新获得焦点、以及每分钟调用一次。
   * @returns {boolean} 是否发生了变化
   */
  function refreshToday() {
    if (state.term.todayOverride) return false; // 正在模拟日期，不跟随系统时间
    const iso = toISODate(todayDate());
    if (iso === lastTodayISO) return false;

    const previousCurrentWeek = currentWeekOf(state.term, toDate(lastTodayISO));
    lastTodayISO = iso;
    followCurrentWeek(previousCurrentWeek);
    emit();
    return true;
  }

  const getToday = () => todayDate();
  const getCurrentWeek = () => computeCurrentWeek();

  /** 正在查看的那一周的 7 天（weekday / date / isToday） */
  function getWeekDatesFor(week = viewingWeek()) {
    return getWeekDates(state.term.startDate, week, todayDate());
  }

  /** 整体替换课程（导入 / 切换学期） */
  function setCourses(list, { source = 'set', mode = 'replace' } = {}) {
    const { courses: incoming, issues, duplicates } = normalizeCourses(list);

    if (mode === 'merge') {
      const merged = [...state.courses];
      const keys = new Set(merged.map((c) => `${c.name}|${c.weekday}|${c.startSection}|${c.teacher}`));
      for (const course of incoming) {
        const key = `${course.name}|${course.weekday}|${course.startSection}|${course.teacher}`;
        if (keys.has(key)) continue;
        keys.add(key);
        merged.push(course);
      }
      state.courses = merged;
    } else {
      state.courses = incoming;
    }

    state.lastImport = {
      source,
      mode,
      count: incoming.length,
      duplicates,
      errors: issues.errors,
      warnings: issues.warnings,
      at: Date.now(),
    };

    // 导入的课表写入浏览器本地：刷新后仍然是用户自己的课表
    state.dataSource = 'user';
    state.savedAt = persistence.save({ courses: state.courses, term: state.term, source })
      ? Date.now()
      : null;

    emit();
    return state.lastImport;
  }

  /**
   * 通用导入入口（Excel / CSV / JSON / 教务系统都走这里）。
   * @param {string|object|Array} payload
   * @param {{source?:string, mode?:'replace'|'merge'}} [options]
   */
  function importCourses(payload, { source = 'auto', mode = 'replace' } = {}) {
    if (Array.isArray(payload)) return setCourses(payload, { source: source === 'auto' ? 'array' : source, mode });
    const result = importPayload(payload, source);
    return setCourses(result.courses, { source: result.source, mode });
  }

  /** 新增一门课 */
  function addCourse(raw) {
    const course = normalizeCourse(raw);
    state.courses = [...state.courses, course];
    emit();
    return course;
  }

  /** 编辑 / 调课：patch 里可以是 weekday、startSection、endSection、weeks、room、teacher... */
  function updateCourse(id, patch = {}) {
    let updated = null;
    state.courses = state.courses.map((course) => {
      if (course.id !== id) return course;
      updated = normalizeCourse({ ...course, ...patch }, { idPrefix: 'course' });
      updated.id = course.id; // id 不因编辑而改变
      return updated;
    });
    if (updated) emit();
    return updated;
  }

  function removeCourse(id) {
    const before = state.courses.length;
    state.courses = state.courses.filter((course) => course.id !== id);
    if (state.selectedCourseId === id) state.selectedCourseId = null;
    if (state.courses.length !== before) emit();
  }

  function setTerm(patch = {}) {
    state.term = { ...state.term, ...patch };
    state.viewingWeek = clamp(state.viewingWeek, 1, state.term.totalWeeks);
    emit();
  }

  /**
   * @param {'light'|'dark'} next
   * @param {{persist?:boolean}} [options] persist=false 用于跟随系统主题，不写入本地存储
   */
  function setTheme(next, { persist = true } = {}) {
    const theme = next === 'dark' ? 'dark' : 'light';
    if (theme === state.theme) return;
    state.theme = theme;
    if (persist) storage?.set(THEME_KEY, theme);
    emit();
  }

  const toggleTheme = () => setTheme(state.theme === 'dark' ? 'light' : 'dark');
  const hasStoredTheme = () => Boolean(storage?.get(THEME_KEY, null));

  /**
   * 切换夏令 / 冬令时间制。
   * 只改变"第几节 = 几点"，课程数据（星期 / 节次 / 周次 / 教师 / 教室）完全不动。
   * @param {'summer'|'winter'} next 非法值会被忽略并回退到默认
   */
  function setTimeSeason(next, { persist = true } = {}) {
    const season = TIME_SEASONS.includes(next) ? next : DEFAULT_TIME_SEASON;
    if (season === state.timeSeason) return season;
    state.timeSeason = season;
    if (persist) storage?.set(TIME_SEASON_KEY, season);
    emit();
    return season;
  }

  const toggleTimeSeason = () => setTimeSeason(state.timeSeason === 'winter' ? 'summer' : 'winter');
  const getTimeSeason = () => state.timeSeason;

  function selectCourse(id) {
    state.selectedCourseId = id ?? null;
    emit();
  }

  /** 恢复内置示例课表（同时清掉本地保存的用户课表）；用于测试 / 后悔药 */
  function resetToMock() {
    state.courses = normalizeCourses(MOCK_COURSES).courses;
    state.lastImport = null;
    state.dataSource = 'sample';
    state.savedAt = null;
    persistence.clear();
    emit();
  }

  /** 便于 UI 语义化调用：恢复示例课表 */
  const restoreSampleTimetable = () => resetToMock();

  /* ------------------------------------------------------------------ 选择器 */

  /** 指定周可见的课程（按 weekday / startSection 排序，供导出、列表视图复用） */
  function getCoursesForWeek(week = viewingWeek()) {
    return state.courses
      .filter((course) => isCourseInWeek(course, week))
      .sort((a, b) => a.weekday - b.weekday || a.startSection - b.startSection);
  }

  const getCourse = (id) => state.courses.find((course) => course.id === id) ?? null;

  /** 某天某节有哪些课（点击空白格新建课程时会用到） */
  function getCoursesAt(weekday, section, week = viewingWeek()) {
    return getCoursesForWeek(week).filter(
      (course) =>
        Number(course.weekday) === Number(weekday) &&
        section >= course.startSection &&
        section <= course.endSection,
    );
  }

  // 初始化：默认显示"现实所在周"
  state.viewingWeek = computeCurrentWeek();

  return {
    // 读
    getState,
    subscribe,
    getCoursesForWeek,
    getCourse,
    getCoursesAt,
    viewingWeek,
    getToday,
    getWeekDates: getWeekDatesFor,
    getCurrentWeek,
    // 写
    goToWeek,
    prevWeek,
    nextWeek,
    goToCurrentWeek,
    setToday,
    refreshToday,
    setCourses,
    importCourses,
    addCourse,
    updateCourse,
    removeCourse,
    setTerm,
    setTheme,
    toggleTheme,
    hasStoredTheme,
    setTimeSeason,
    toggleTimeSeason,
    getTimeSeason,
    selectCourse,
    resetToMock,
    restoreSampleTimetable,
    /** 清掉本地保存的用户课表（不改变当前内存中的课程） */
    clearSavedCourses: () => persistence.clear(),
  };
}
