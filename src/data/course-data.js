/**
 * Mock 课程数据 —— 依据参考课表截图整理（第 3 周，2026 秋季学期）。
 *
 * 说明：
 *   - 这是唯一的"假数据"来源，UI 不硬编码任何课程；
 *   - 想替换成真实课表，只要让 course-store 的 setCourses / importCourses 拿到同样结构的数组；
 *   - color 字段可选，用于固定卡片配色（不写则按课程名稳定哈希取色）。
 */

export const MOCK_COURSES = [
  {
    id: 'course-001',
    name: '电工电子技术',
    teacher: '吴高标',
    room: '5-409',
    campus: '椒江校区',
    weekday: 1,
    startSection: 1,
    endSection: 2,
    weeks: '1-16',
    color: 'slate',
  },
  {
    id: 'course-002',
    name: '大学物理及实验 B2',
    teacher: '梁华秋',
    room: '6-101',
    campus: '椒江校区',
    weekday: 1,
    startSection: 3,
    endSection: 5,
    weeks: '1-16',
    color: 'mint',
  },
  {
    id: 'course-003',
    name: '大学物理及实验 B2',
    teacher: '周英',
    room: '航-N903 电磁学实验室1',
    campus: '椒江校区',
    weekday: 1,
    startSection: 6,
    endSection: 8,
    weeks: '1-16',
    color: 'mint',
  },
  {
    id: 'course-004',
    name: '田径健身初级',
    teacher: '孙毅',
    room: '椒江校区操场',
    campus: '椒江校区',
    weekday: 2,
    startSection: 3,
    endSection: 5,
    weeks: '1-16',
    color: 'blush',
  },
  {
    id: 'course-005',
    name: '毛泽东思想和中国特色社会主义理论体系概论',
    teacher: '汤晓黎',
    room: '5-202',
    campus: '椒江校区',
    weekday: 2,
    startSection: 6,
    endSection: 7,
    weeks: '1-16',
    color: 'lavender',
  },
  {
    id: 'course-006',
    name: '理工英语',
    teacher: '张英',
    room: '4-301',
    campus: '椒江校区',
    weekday: 2,
    startSection: 8,
    endSection: 9,
    weeks: '1-16',
    color: 'mist',
  },
  {
    id: 'course-007',
    name: 'Java高级编程',
    teacher: '邓军',
    room: 'K-408 大数据专业实验室',
    campus: '椒江校区',
    weekday: 3,
    startSection: 3,
    endSection: 5,
    weeks: '1-16',
    color: 'taupe',
  },
  {
    id: 'course-008',
    name: '线性代数',
    teacher: '冯先智',
    room: '5-109',
    campus: '椒江校区',
    weekday: 3,
    startSection: 6,
    endSection: 8,
    weeks: '1-16',
    color: 'forest',
  },
  {
    id: 'course-009',
    name: '离散数学',
    teacher: '张海良',
    room: '2-404',
    campus: '椒江校区',
    weekday: 4,
    startSection: 3,
    endSection: 5,
    weeks: '1-16',
    color: 'sage',
  },
];

/**
 * 演示数据：用于验证「同一时间多门课自动分栏」。
 * 在控制台执行下面这行即可预览效果：
 *   window.courseApp.store.importCourses(window.courseApp.demo.overlapDemoCourses, { mode: 'merge' })
 */
export const OVERLAP_DEMO_COURSES = [
  {
    id: 'demo-overlap-1',
    name: '形势与政策',
    teacher: '李老师',
    room: '2-301',
    campus: '椒江校区',
    weekday: 5,
    startSection: 3,
    endSection: 5,
    weeks: '1-16',
    color: 'blush',
  },
  {
    id: 'demo-overlap-2',
    name: '创新创业基础',
    teacher: '王老师',
    room: '3-215',
    campus: '椒江校区',
    weekday: 5,
    startSection: 4,
    endSection: 6,
    weeks: '1-16',
    color: 'lavender',
  },
  {
    id: 'demo-overlap-3',
    name: '程序设计竞赛训练',
    teacher: '陈老师',
    room: 'K-501',
    campus: '椒江校区',
    weekday: 5,
    startSection: 3,
    endSection: 4,
    weeks: '1-16',
    color: 'forest',
  },
  {
    id: 'demo-overlap-4',
    name: '单周研讨课',
    teacher: '赵老师',
    room: '1-102',
    campus: '椒江校区',
    weekday: 6,
    startSection: 1,
    endSection: 2,
    weeks: '1-16(单)',
    color: 'slate',
  },
];

/**
 * 未来扩展占位：导入来源注册表。
 * 每个 importer 只要把任意格式转换成 Course[] 即可，UI 不需要改。
 */
export const IMPORT_SOURCES = {
  json: { label: 'JSON 导入', accept: '.json,application/json', status: 'ready' },
  csv: { label: 'CSV 导入', accept: '.csv,text/csv', status: 'ready' },
  excel: { label: 'Excel 导入', accept: '.xlsx,.xls', status: 'planned' },
  jwxt: { label: '教务系统导入', accept: null, status: 'planned' },
};
