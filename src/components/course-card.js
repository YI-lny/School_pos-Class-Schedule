/**
 * course-card —— 单门课程卡片。
 *
 * 只负责"把一条布局结果渲染成 DOM"，所有几何计算来自 layout-engine，
 * 颜色来自 utils/colors，因此卡片本身可以独立替换（周视图 / 列表视图 / 详情弹层复用）。
 */

import { h } from '../utils/dom.js';
import { courseColorVars } from '../utils/colors.js';
import { describeCourse } from '../data/course-model.js';

/**
 * @param {object} item   layout-engine 输出的 item（含 course / top / height / lane ...）
 * @param {object} [options]
 * @param {'light'|'dark'} [options.theme]
 * @param {number} [options.gapX] 同一时间多门课时的左右留白
 * @param {boolean} [options.selected] 是否为当前选中的课程
 * @param {(course:object)=>void} [options.onSelect]
 * @returns {HTMLElement}
 */
export function createCourseCard(item, { theme = 'light', gapX = 3, selected = false, onSelect = null } = {}) {
  const { course, top, height, leftPct, widthPct, laneCount, compact, tight } = item;

  const el = h(
    'article',
    {
      class: [
        'course',
        compact ? 'is-compact' : '',
        tight ? 'is-tight' : '',
        laneCount > 1 ? 'is-split' : '',
        laneCount >= 3 ? 'is-dense' : '',
        selected ? 'is-selected' : '',
      ],
      style: {
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${leftPct}% + ${gapX}px)`,
        width: `calc(${widthPct}% - ${gapX * 2}px)`,
        ...courseColorVars(course, theme),
      },
      dataset: { courseId: course.id },
      tabindex: '0',
      role: 'button',
      'aria-label': [
        course.name,
        describeCourse(course),
        course.teacher,
        course.room,
        course.campus,
        `第 ${course.weeks} 周`,
      ]
        .filter(Boolean)
        .join('，'),
    },
    [
      h('h3', { class: 'course__name', text: course.name }),
      course.teacher ? h('p', { class: 'course__teacher', text: course.teacher, title: course.teacher }) : null,
      course.room ? h('p', { class: 'course__room', text: course.room, title: course.room }) : null,
    ],
  );

  const select = (event) => {
    event?.stopPropagation?.();
    onSelect?.(course);
  };

  el.addEventListener('click', select);
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(event);
    }
  });

  return el;
}
