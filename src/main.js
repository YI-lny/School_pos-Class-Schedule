/**
 * main.js —— 应用入口：装配 store + 组件，把状态变化映射到 DOM。
 *
 * 这里只做"接线"，不含任何业务与样式细节：
 *   course-data(数据) → course-store(状态) → components(视图)
 */

import { DEFAULT_TERM } from './config/term-config.js';
import { MOCK_COURSES, OVERLAP_DEMO_COURSES } from './data/course-data.js';
import { createCourseStore } from './core/course-store.js';
import { createStorage } from './core/storage.js';
import { createToolbar } from './components/toolbar.js';
import { createTimetable } from './components/timetable.js';
import { createImportDialog } from './components/import-dialog.js';
import * as importers from './core/importers/index.js';
import { debounce } from './utils/dom.js';

/* ------------------------------------------------------------------ 主题初始值 */
const storage = createStorage();
/** 用户导入的课表用原始键名保存：school_pos_courses / school_pos_term */
const courseStorage = createStorage('');
const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null;
const storedTheme = storage.get('theme', null);
const initialTheme = storedTheme ?? (media?.matches ? 'dark' : 'light');

const THEME_COLORS = { light: '#eef0ec', dark: '#14171a' };

/* ---------------------------------------------------------------------- 状态 */
const store = createCourseStore({
  term: DEFAULT_TERM,
  courses: MOCK_COURSES,
  theme: initialTheme,
  storage,
  courseStorage,
});

/* ---------------------------------------------------------------------- 视图 */
const importDialog = createImportDialog({ store });

const toolbar = createToolbar({
  store,
  onOpenImport: () => importDialog.open(),
});

const timetable = createTimetable({
  onSelectCourse: (course) => {
    // 点击卡片：先给出即时反馈（选中描边），详情面板在后续版本接入这里
    store.selectCourse(store.getState().selectedCourseId === course.id ? null : course.id);
    document.dispatchEvent(new CustomEvent('course-select', { detail: { course } }));
  },
});

const root = document.getElementById('app');
root.append(toolbar.el, timetable.el);
document.body.appendChild(importDialog.el);

/* ------------------------------------------------------------------ 渲染循环 */
/** 主题 = 明暗（data-theme） + 时间制色调（data-season） */
function applyAppearance(state) {
  const isDark = state.theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  document.documentElement.dataset.season = state.timeSeason === 'winter' ? 'winter' : 'summer';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[state.theme] ?? THEME_COLORS.light);
}

function render(state) {
  applyAppearance(state);
  toolbar.render(state);
  timetable.render(state);
}

store.subscribe(render);
render(store.getState());

// 课表已经渲染出来：撤掉 index.html 里的启动失败提示（见 index.html 内联脚本）
window.__bootOk?.();

/* ------------------------------------------------------------------ 全局事件 */

// 视口变化：CSS 变量（节次高度 / 列宽）可能变了，需要按新尺寸重新排版
const handleResize = debounce(() => timetable.render(store.getState()), 120);
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);

// 跟随系统主题（用户手动切换过之后就不再自动跟随）
media?.addEventListener?.('change', (event) => {
  if (store.hasStoredTheme()) return;
  store.setTheme(event.matches ? 'dark' : 'light', { persist: false });
});

/*
 * 现实日期可能在使用过程中跨天（甚至跨周）：重新获得焦点时、以及每分钟检查一次，
 * 一旦系统日期变了就刷新"今天/本周"。store 内部会判断是否真的变化，没变不会重渲染。
 */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) store.refreshToday();
});
window.addEventListener('focus', () => store.refreshToday());
setInterval(() => store.refreshToday(), 60 * 1000);

// 键盘：← → 切换周次（桌面端快捷操作）
window.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  if (event.key === 'ArrowLeft') store.prevWeek();
  else if (event.key === 'ArrowRight') store.nextWeek();
});

/* ------------------------------------------------------- 开发/扩展用的全局句柄 */
// 例：courseApp.store.importCourses(courseApp.demo.overlapDemoCourses, { mode: 'merge' })
if (typeof window !== 'undefined') {
  window.courseApp = {
    store,
    timetable,
    toolbar,
    importDialog,
    importers,
    config: { DEFAULT_TERM },
    demo: { overlapDemoCourses: OVERLAP_DEMO_COURSES },

    /** 打开「导入课表」面板 */
    openImport: () => importDialog.open(),
    /** 不用界面直接导入（脚本/测试用）：courseApp.importText(csvText, 'csv') */
    importText: (text, source = 'auto') => store.importCourses(importers.importPayload(text, source).courses, {
      source,
      mode: 'replace',
    }),
    /** 恢复示例课表 */
    restoreSample: () => store.restoreSampleTimetable(),

    /* ---- 周次 / 日期：开发测试用的便捷方法 ---- */
    /** 模拟现实日期：courseApp.setToday('2026-09-26')；传 null 恢复系统时间 */
    setToday: (value) => store.setToday(value),
    /** 当前现实日期（ISO） */
    today: () => store.getState().todayISO,
    /** 正在查看第几周 */
    viewingWeek: () => store.getState().viewingWeek,
    /** 现实所在第几周 */
    currentWeek: () => store.getState().currentWeek,
    /** 正在查看那一周的 7 天：[{weekday, date, isToday}, ...] */
    weekDates: () => store.getState().weekDates,
  };
}
