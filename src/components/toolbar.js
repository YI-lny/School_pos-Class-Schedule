/**
 * toolbar —— 顶部区域。
 *
 * 布局（对齐需求里的"左边 / 中间 / 右侧"）：
 *   左：第 3 周（大字号，视觉主角）+ 学期与日期范围
 *   右：‹  本周  ›   以及夜间模式开关
 *
 * 刻意保持极简：不做下拉菜单、不做功能入口堆叠。
 */

import { h } from '../utils/dom.js';
import { formatWeekRange } from '../core/week-utils.js';

const ICON_PREV =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>';
const ICON_NEXT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z"/></svg>';
const ICON_SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></svg>';
const ICON_SUNNY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.4"/><path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/></svg>';
const ICON_SNOW =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.6v18.8M3.9 7.3l16.2 9.4M20.1 7.3 3.9 16.7M12 6.6 9.6 4.6M12 6.6l2.4-2M12 17.4l-2.4 2M12 17.4l2.4 2M6.6 9.2 3.9 9.9M17.4 14.8l2.7-.7M6.6 14.8l-2.7-.7M17.4 9.2l2.7.7"/></svg>';
const ICON_IMPORT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5v11M7.8 10.3 12 14.5l4.2-4.2M4.5 19.5h15"/></svg>';

function iconButton(html, label, onClick) {
  return h('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': label,
    title: label,
    html,
    onClick,
  });
}

/**
 * @param {object} options
 * @param {object} options.store course-store 实例
 * @param {() => void} [options.onOpenImport] 点击「导入课表」
 */
export function createToolbar({ store, onOpenImport = null }) {
  const weekNum = h('b', { class: 'topbar__num', text: '1' });
  const weekLabel = h(
    'span',
    { class: 'topbar__week', 'aria-live': 'polite' },
    [
      h('span', { class: 'topbar__week-affix', text: '第' }),
      weekNum,
      h('span', { class: 'topbar__week-affix', text: '周' }),
    ],
  );

  const meta = h('span', { class: 'topbar__meta' });
  const left = h('div', { class: 'topbar__left' }, [weekLabel, meta]);

  const prevBtn = iconButton(ICON_PREV, '上一周', () => store.prevWeek());
  const nextBtn = iconButton(ICON_NEXT, '下一周', () => store.nextWeek());
  const todayBtn = h('button', {
    class: 'text-btn',
    type: 'button',
    text: '本周',
    title: '回到本周',
    onClick: () => store.goToCurrentWeek(),
  });
  const themeBtn = iconButton(ICON_MOON, '切换到夜间模式', () => store.toggleTheme());

  /*
   * 夏令 / 冬令时间制切换：只改"第几节 = 几点"，不影响任何课程数据。
   * 放在工具栏右侧，与「导入课表」同一套样式，不改变原有布局。
   */
  const seasonLabel = h('span', { text: '夏令时间' });
  const seasonBtn = h('button', {
    class: 'text-btn text-btn--icon',
    type: 'button',
    title: '切换夏令 / 冬令时间',
    dataset: { action: 'toggle-season', season: 'summer' },
    onClick: () => store.toggleTimeSeason(),
  });
  seasonBtn.innerHTML = ICON_SUNNY;
  seasonBtn.appendChild(seasonLabel);

  // 「导入课表」入口：放在现有工具栏右侧，样式与「本周」一致，不改变原有布局
  const importBtn = h('button', {
    class: 'text-btn text-btn--icon',
    type: 'button',
    title: '导入课表',
    dataset: { action: 'open-import' },
    onClick: () => onOpenImport?.(),
  });
  importBtn.innerHTML = ICON_IMPORT;
  importBtn.appendChild(h('span', { text: '导入课表' }));

  const actions = h('div', { class: 'topbar__actions' }, [
    prevBtn,
    todayBtn,
    nextBtn,
    seasonBtn,
    importBtn,
    themeBtn,
  ]);
  const el = h('header', { class: 'topbar' }, [left, actions]);

  function render(state) {
    weekNum.textContent = String(state.viewingWeek);
    weekLabel.setAttribute(
      'aria-label',
      `当前显示第 ${state.viewingWeek} 周${state.isCurrentWeek ? '，也就是本周' : ''}`,
    );

    const range = formatWeekRange(state.weekDates);

    // 现实所在周才显示"本周"；查看其它周时只显示周次与日期范围
    meta.textContent = state.isCurrentWeek
      ? `${state.term.name} · ${range} · 本周`
      : `${state.term.name} · ${range}`;

    prevBtn.disabled = !state.canGoPrev;
    nextBtn.disabled = !state.canGoNext;
    todayBtn.disabled = state.isCurrentWeek;
    todayBtn.title = state.isCurrentWeek
      ? '当前就是本周'
      : `回到本周（第 ${state.currentWeek} 周）`;

    const isDark = state.theme === 'dark';
    themeBtn.innerHTML = isDark ? ICON_SUN : ICON_MOON;
    const label = isDark ? '切换到日间模式' : '切换到夜间模式';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;

    // 夏令 / 冬令：当前状态直接写在按钮上
    const isWinter = state.timeSeason === 'winter';
    seasonBtn.innerHTML = isWinter ? ICON_SNOW : ICON_SUNNY;
    seasonBtn.appendChild(seasonLabel);
    seasonLabel.textContent = isWinter ? '冬令时间' : '夏令时间';
    seasonBtn.dataset.season = isWinter ? 'winter' : 'summer';
    seasonBtn.setAttribute('aria-label', `当前${seasonLabel.textContent}，点击切换`);
    seasonBtn.title = isWinter ? '当前冬令时间，点击切换到夏令时间' : '当前夏令时间，点击切换到冬令时间';

    document.title = `我的课表 · 第 ${state.viewingWeek} 周`;
  }

  return { el, render };
}
