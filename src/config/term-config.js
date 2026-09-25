/**
 * 学期级配置：节次时间、学期起止、默认周次范围。
 *
 * 这里是整个应用唯一的"学校作息"事实来源：
 *   - SECTIONS           第 N 节的上课时间（左侧节次栏渲染用）
 *   - DEFAULT_TERM       默认学期（起止日期 + 总周数 + 当前周兜底）
 * 后续接入教务系统时，只需要替换这个文件的内容 / 或由 store.setTerm() 覆盖。
 */

/**
 * 作息时间：夏令 / 冬令两套（每套 12 节，节次编号与课程数据共用）。
 *
 * ⚠️ 具体时刻属于"时间配置"，**不属于 Course**：
 *    Course 只表达 weekday / startSection / endSection 等语义数据，
 *    切换夏令冬令只改变"第几节对应几点"，课程数据本身不变。
 *
 * 夏令与冬令：第 1~5 节相同；第 6~9 节、第 10~12 节不同。
 */
export const TIME_SLOT_CONFIG = {
  summer: [
    { section: 1, start: '08:00', end: '08:40' },
    { section: 2, start: '08:45', end: '09:25' },
    { section: 3, start: '09:45', end: '10:25' },
    { section: 4, start: '10:30', end: '11:10' },
    { section: 5, start: '11:15', end: '11:55' },
    { section: 6, start: '14:00', end: '14:40' },
    { section: 7, start: '14:45', end: '15:25' },
    { section: 8, start: '15:45', end: '16:25' },
    { section: 9, start: '16:30', end: '17:10' },
    { section: 10, start: '19:00', end: '19:40' },
    { section: 11, start: '19:45', end: '20:25' },
    { section: 12, start: '20:30', end: '21:10' },
  ],
  winter: [
    { section: 1, start: '08:00', end: '08:40' },
    { section: 2, start: '08:45', end: '09:25' },
    { section: 3, start: '09:45', end: '10:25' },
    { section: 4, start: '10:30', end: '11:10' },
    { section: 5, start: '11:15', end: '11:55' },
    { section: 6, start: '13:30', end: '14:10' },
    { section: 7, start: '14:15', end: '14:55' },
    { section: 8, start: '15:15', end: '15:55' },
    { section: 9, start: '16:00', end: '16:40' },
    { section: 10, start: '18:30', end: '19:10' },
    { section: 11, start: '19:15', end: '19:55' },
    { section: 12, start: '20:00', end: '20:40' },
  ],
};

/** 可选的时间制 */
export const TIME_SEASONS = ['summer', 'winter'];
export const DEFAULT_TIME_SEASON = 'summer';
export const TIME_SEASON_LABELS = { summer: '夏令时间', winter: '冬令时间' };

/**
 * 取某套作息；任何非法 / 缺失的值都安全回退到默认（夏令）。
 * @param {'summer'|'winter'} [season]
 */
export function getSectionTimes(season = DEFAULT_TIME_SEASON) {
  return TIME_SLOT_CONFIG[season] ?? TIME_SLOT_CONFIG[DEFAULT_TIME_SEASON];
}

/** 每天最多几节：由配置派生，不写死数字 */
export const SECTIONS_PER_DAY = TIME_SLOT_CONFIG[DEFAULT_TIME_SEASON].length;

/**
 * 兼容既有引用：默认作息（夏令）的节次时间。
 * 需要按当前选择取时间的地方请用 getSectionTimes(season)。
 */
export const SECTION_TIMES = TIME_SLOT_CONFIG[DEFAULT_TIME_SEASON];

/**
 * 时间段分隔：在这些节次之后画一条分隔线。
 *   [5] 上午 / 下午；[9] 下午 / 晚上
 * 只按"节次编号"判断，与具体时刻无关 —— 因此夏令(第10节 19:00)与
 * 冬令(第10节 18:30)的分界线位置完全一致。
 */
export const BREAK_AFTER_SECTIONS = [5, 9];

/**
 * 「主线」分隔线：需要更强的视觉重量（2px + 独立颜色）的时间段边界。
 *   5 上午 / 下午；9 下午 / 晚上
 * 与 BREAK_AFTER_SECTIONS 一样只按节次编号判断，与夏令 / 冬令的具体时刻无关。
 */
export const MAJOR_BREAK_AFTER_SECTIONS = [5, 9];

/**
 * 分隔线的可读标签：**两条主线各有一个**，统一贴在各自分界线的右端。
 *   [5] ☀️ 中午（上午 / 下午）；[9] 🌙 晚上（下午 / 晚上）
 * 以 afterSection 为键，因此渲染层只认语义 label 字段，
 * 不需要（也不允许）靠"第几条线 / 第几个 DOM 元素"判断。
 */
export const BREAK_LABELS = { 5: '☀️ 中午', 9: '🌙 晚上' };

/**
 * 默认学期。
 * startDate 必须是第 1 周的周一（ISO 格式，本地时区解析）。
 * 参考截图：第 3 周 = 09-21 ~ 09-27，故第 1 周周一为 2026-09-07。
 */
export const DEFAULT_TERM = {
  id: '2026-fall',
  name: '2026 秋季学期',
  startDate: '2026-09-07',
  totalWeeks: 20,
  /** 允许教师/学校临时调整：把"今天"固定在某一天（null = 使用真实系统时间） */
  todayOverride: null,
  /** 上下午分界：第 5 节之后留出更宽的视觉间隔 */
  breakAfterSection: 5,
};

/** 星期标签（索引 0 = 周一） */
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 星期全称（无障碍朗读 / 详情页用） */
export const WEEKDAY_FULL_LABELS = [
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
  '星期日',
];

export const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
