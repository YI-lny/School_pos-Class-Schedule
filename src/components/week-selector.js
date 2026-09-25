/**
 * week-selector —— 顶部日期栏（周一 ~ 周日 7 列 + 具体日期）。
 *
 * - 与课表列共用同一套列宽，因此表头永远和下方课程卡片对齐；
 * - 表头 position: sticky，纵向滚动时吸顶；左上角空格吸左；
 * - "今天"由 course-store 依据系统时间计算（isToday），这里只负责显示：
 *   星期 + 日期 + 「今天」标记，三者同时显示并整体高亮。
 */

import { h, clear } from '../utils/dom.js';

export function createWeekSelector() {
  // 左上角（节次栏上方）留白：周次已经在顶部区域显示，这里保持干净
  const corner = h('div', { class: 'wk-corner', 'aria-hidden': 'true' });

  const days = h('div', { class: 'tt-days' });
  const el = h('div', { class: 'tt-row tt-head' }, [corner, days]);

  /**
   * @param {object} state    course-store 的 snapshot（未直接使用，保持签名一致）
   * @param {Array}  [dayMeta] layout-engine 输出的 7 天信息（date/isToday 来自 week-utils.getWeekDates）
   */
  function render(_state, dayMeta = []) {
    clear(days);
    for (const day of dayMeta) {
      days.appendChild(createDayHead(day));
    }
  }

  function createDayHead(day) {
    const isToday = Boolean(day.isToday);
    // 日期文案来自 week-utils.getWeekDates（monthDay），这里不再自己格式化
    const dateText = day.monthDay ?? '--';

    return h(
      'div',
      {
        class: ['dh', isToday ? 'is-today' : '', day.isWeekend ? 'is-weekend' : ''],
        dataset: { weekday: day.weekday },
        ...(isToday ? { 'aria-current': 'date' } : {}),
      },
      [
        h('span', { class: 'dh__week', text: day.label }),
        h('span', { class: 'dh__date', text: dateText }),
        isToday ? h('span', { class: 'dh__flag', text: '今天' }) : null,
      ],
    );
  }

  return {
    el,
    render,
    /** 与课表主体共用同一套列宽（见 layout-engine.computeColumnWidths） */
    setColumnTemplate(template) {
      days.style.gridTemplateColumns = template;
    },
  };
}
