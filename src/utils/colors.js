/**
 * 课程配色。
 *
 * 设计目标：低饱和、柔和的莫兰迪色系（参考截图），
 * 同时提供夜间模式变体（同色相的深色版本），保证两种主题下文字都清晰。
 *
 * 数据侧可以显式指定 course.color = 'taupe' 来固定颜色；
 * 未指定时按课程名做稳定哈希，保证同一门课每次渲染颜色一致。
 */

export const COURSE_PALETTE = {
  slate: {
    light: { bg: '#a7a6c2', ink: '#2a2a42', sub: '#454364' },
    dark: { bg: '#3a3950', ink: '#dcdbf0', sub: '#b0aecd' },
  },
  mint: {
    light: { bg: '#dce8e0', ink: '#2c4438', sub: '#4c6755' },
    dark: { bg: '#27362f', ink: '#d6e6dc', sub: '#a5bfb0' },
  },
  blush: {
    light: { bg: '#f0dcd3', ink: '#6b3f33', sub: '#8b5c4c' },
    dark: { bg: '#3f2e29', ink: '#f0dcd3', sub: '#c9a99b' },
  },
  taupe: {
    light: { bg: '#ab948b', ink: '#2f231f', sub: '#4d3a33' },
    dark: { bg: '#3a2d28', ink: '#ecdfd9', sub: '#c3a79d' },
  },
  sage: {
    light: { bg: '#8fa899', ink: '#1f3128', sub: '#384a3f' },
    dark: { bg: '#2c3d34', ink: '#d2e4d9', sub: '#a3bcae' },
  },
  forest: {
    light: { bg: '#5f7f72', ink: '#eef4f0', sub: '#cfdfd6' },
    dark: { bg: '#254037', ink: '#dceee5', sub: '#a8c8ba' },
  },
  lavender: {
    light: { bg: '#e2e0f0', ink: '#3a3760', sub: '#575283' },
    dark: { bg: '#302f47', ink: '#dcdaf0', sub: '#aeabcc' },
  },
  mist: {
    light: { bg: '#e5eae2', ink: '#38443a', sub: '#57615a' },
    dark: { bg: '#2b332d', ink: '#d9e3da', sub: '#a7b3a9' },
  },
};

export const PALETTE_KEYS = Object.keys(COURSE_PALETTE);

const FALLBACK_KEY = 'mist';

/** 字符串 → 稳定哈希（用于未指定颜色的课程）。 */
function hashString(input) {
  let hash = 0;
  const str = String(input ?? '');
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) % 1000003;
  }
  return hash;
}

/** 取课程配色键。 */
export function paletteKeyFor(course) {
  if (course?.color && COURSE_PALETTE[course.color]) return course.color;
  if (!course?.name) return FALLBACK_KEY;
  return PALETTE_KEYS[hashString(`${course.name}${course.teacher ?? ''}`) % PALETTE_KEYS.length];
}

/**
 * 得到当前主题下该课程的颜色变量。
 * @returns {{key:string, bg:string, ink:string, sub:string}}
 */
export function courseColors(course, theme = 'light') {
  const key = paletteKeyFor(course);
  const entry = COURSE_PALETTE[key] || COURSE_PALETTE[FALLBACK_KEY];
  const tone = theme === 'dark' ? entry.dark : entry.light;
  return { key, ...tone };
}

/** 转成可直接赋给元素的 CSS 变量对象。 */
export function courseColorVars(course, theme = 'light') {
  const { bg, ink, sub } = courseColors(course, theme);
  return { '--card-bg': bg, '--card-ink': ink, '--card-sub': sub };
}
