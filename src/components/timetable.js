/**
 * timetable —— 课表主体。
 *
 * 结构（横向可滚动的"冻结窗格"）：
 *   .board
 *     .tt-scroll            滚动容器（横 + 纵）
 *       .tt-canvas
 *         .tt-row.tt-head   第 N 周 + 7 天表头（sticky top，左侧角标 sticky left）
 *         .tt-row.tt-body
 *           .tt-rail        节次栏（sticky left）
 *           .tt-cols        7 个日列，课程卡片绝对定位（overlap 自动分栏）
 *
 * 几何全部由 core/layout-engine.js 计算，本文件只做渲染与滚动细节。
 */

import { h, clear, rafThrottle } from '../utils/dom.js';
import { buildLayout, computeColumnWidths, fitMetrics, readMetrics } from '../core/layout-engine.js';
import { createWeekSelector } from './week-selector.js';
import { createCourseCard } from './course-card.js';

/**
 * 预留横向滚动条高度：反推行高时留一点余量，
 * 避免"刚好等于可视高度"时又挤出一条纵向滚动条。
 */
const SCROLLBAR_ALLOWANCE = 10;

/**
 * @param {object} [options]
 * @param {(course:object)=>void} [options.onSelectCourse] 点击课程卡片
 */
export function createTimetable({ onSelectCourse = null } = {}) {
  const weekSelector = createWeekSelector();
  const rail = h('div', { class: 'tt-rail', role: 'presentation' });
  const cols = h('div', { class: 'tt-cols' });
  const bodyRow = h('div', { class: 'tt-row tt-body' }, [rail, cols]);
  const canvas = h('div', { class: 'tt-canvas' }, [weekSelector.el, bodyRow]);
  const scroll = h(
    'div',
    { class: 'tt-scroll', tabindex: '0', 'aria-label': '课程表，可左右滑动查看全部 7 天' },
    canvas,
  );

  const footCount = h('strong', { text: '0 门课程' });
  const foot = h('div', { class: 'board__foot' }, [
    h('span', {}, [footCount, document.createTextNode(' · 数据来源：本地课表数据')]),
    h('span', { class: 'board__foot__hint', text: '左右滑动查看周六 / 周日' }),
  ]);

  const el = h('section', { class: 'board' }, [scroll, foot]);

  let breakLine = null;
  let emptyHint = null;
  let lastRenderedWeek = null;

  /* 横向滚动时给节次栏加一层边界阴影，提示"左侧是冻结的" */
  const handleScroll = rafThrottle(() => {
    scroll.classList.toggle('is-pan-x', scroll.scrollLeft > 1);
  });
  scroll.addEventListener('scroll', handleScroll, { passive: true });

  function renderSlots(layout) {
    clear(rail);
    rail.style.height = `${layout.totalHeight}px`;
    for (const slot of layout.slots) {
      rail.appendChild(
        h(
          'div',
          {
            class: ['slot', slot.isBreak ? 'slot--divider' : ''],
            style: { top: `${slot.top}px`, height: `${slot.height}px` },
          },
          [
            h('span', { class: 'slot__no', text: String(slot.section) }),
            h('span', { class: 'slot__time', text: slot.start }),
            h('span', { class: 'slot__time', text: slot.end }),
          ],
        ),
      );
    }
  }

  function renderDays(layout, state) {
    clear(cols);
    cols.style.height = `${layout.totalHeight}px`;
    for (const day of layout.days) {
      const column = h('div', {
        class: ['tt-col', day.isToday ? 'is-today' : ''],
        dataset: { weekday: String(day.weekday) },
      });

      for (const item of day.items) {
        column.appendChild(
          createCourseCard(item, {
            theme: state.theme,
            gapX: layout.metrics.cardGapX,
            selected: state.selectedCourseId === item.course.id,
            onSelect: onSelectCourse,
          }),
        );
      }

      cols.appendChild(column);
    }
  }

  /**
   * 时间段分隔线：上午/下午（第 5 节后，☀️ 中午）、下午/晚上（第 9 节后，🌙 晚上）。
   *
   * 每条线都是"一条连续的整行横线"（left:0 → right:0），节次栏那一段天然属于
   * 同一条线 —— 不再像旧实现那样在节次栏用 CSS 公式另画一条近似线。
   * 图层盖在吸顶节次栏（z-index:2）之上，所以横向滚动时节次栏仍由自己的底色遮挡，
   * 不会被这条线划穿（见 timetable.css 的 .tt-break-layer）。
   *
   * 标签完全由语义化的 item.label 决定（label 为空就不渲染），
   * 两条线共用同一套 .tt-break__label 样式。
   */
  function renderBreaks(layout) {
    if (breakLine) {
      breakLine.remove();
      breakLine = null;
    }
    const breaks = layout.breaks ?? [];
    if (breaks.length === 0) return;

    breakLine = h(
      'div',
      { class: 'tt-break-layer' },
      breaks.map((item) =>
        h(
          'div',
          {
            class: ['tt-break', item.major ? 'tt-break--major' : ''],
            style: { top: `${item.top}px` },
            dataset: { afterSection: String(item.afterSection) },
          },
          item.label ? [h('span', { class: 'tt-break__label', text: item.label })] : [],
        ),
      ),
    );
    bodyRow.appendChild(breakLine);
  }

  function renderEmpty(layout, state) {
    if (emptyHint) {
      emptyHint.remove();
      emptyHint = null;
    }
    if (layout.courseCount > 0) return;
    emptyHint = h('div', { class: 'tt-empty' }, [
      h('div', {}, [
        `第 ${state.viewingWeek} 周暂无课程`,
        h('span', { text: '可以切换到其他周，或检查课程的周次设置' }),
      ]),
    ]);
    bodyRow.appendChild(emptyHint);
  }

  /** 把"今天"所在列滚动到可视区域中间（首次进入 / 切回本周时） */
  function scrollTodayIntoView(state, instant = false) {
    if (!state.todayInViewingWeek) return;
    if (scroll.scrollWidth <= scroll.clientWidth + 1) return; // 桌面端全部可见，无需滚动

    const column = cols.children[state.todayWeekday - 1];
    if (!column) return;

    const railWidth = rail.offsetWidth;
    const viewport = scroll.clientWidth - railWidth;
    const target = column.offsetLeft + column.offsetWidth / 2 - railWidth - viewport / 2;
    const max = scroll.scrollWidth - scroll.clientWidth;

    scroll.scrollTo({
      left: Math.min(Math.max(target, 0), max),
      behavior: instant ? 'auto' : 'smooth',
    });
  }

  /**
   * 表头与主体共用同一套列宽：
   * 只有"存在重叠课程"的那一天会被加宽，其余天保持基准宽度。
   */
  function applyColumnWidths(layout, metrics) {
    const available = Math.max(0, scroll.clientWidth - metrics.railWidth);
    const widths = computeColumnWidths(layout.days, available, metrics);
    if (!widths.length) return;

    const template = widths.map((w) => `${w}px`).join(' ');
    cols.style.gridTemplateColumns = template;
    weekSelector.setColumnTemplate(template);
  }

  /** @param {object} state course-store snapshot */
  function render(state) {
    const baseMetrics = readMetrics();

    /*
     * 行高自适应分两步：
     *   1) 先用基准尺寸算出 7 天信息，把表头渲染出来并量出它的真实高度；
     *   2) 再用 "滚动区可视高度 − 表头高度 − 横向滚动条余量" 反推每节课的行高。
     * 表头是吸顶的、占的是滚动区内部的高度，必须扣掉，
     * 否则 9 节课会超出可视区、桌面端平白多出一条纵向滚动条。
     */
    const headerProbe = buildLayout({
      courses: state.courses,
      week: state.viewingWeek,
      metrics: baseMetrics,
      weekDates: state.weekDates,
      sectionTimes: state.timeSlots,
    });
    weekSelector.render(state, headerProbe.days);

    const headerHeight = weekSelector.el.offsetHeight || 0;
    const available = Math.max(0, scroll.clientHeight - headerHeight - SCROLLBAR_ALLOWANCE);

    const metrics = fitMetrics(baseMetrics, available);
    const layout = buildLayout({
      courses: state.courses,
      week: state.viewingWeek,
      metrics,
      weekDates: state.weekDates,
      sectionTimes: state.timeSlots,
    });

    // 列宽交给 JS 精确计算（CSS 里的 --day-w / --lanes 是没有 JS 时的兜底）
    canvas.style.setProperty('--lanes', String(layout.maxLanes));
    applyColumnWidths(layout, baseMetrics);

    renderSlots(layout);
    renderDays(layout, state);
    renderBreaks(layout);
    renderEmpty(layout, state);

    footCount.textContent = `${layout.courseCount} 门课程`;
    handleScroll();

    if (state.viewingWeek !== lastRenderedWeek) {
      const firstPaint = lastRenderedWeek === null;
      lastRenderedWeek = state.viewingWeek;
      requestAnimationFrame(() => scrollTodayIntoView(state, firstPaint));
    }
  }

  function destroy() {
    scroll.removeEventListener('scroll', handleScroll);
  }

  return { el, render, destroy, scrollToTop: () => scroll.scrollTo({ top: 0, behavior: 'smooth' }) };
}
