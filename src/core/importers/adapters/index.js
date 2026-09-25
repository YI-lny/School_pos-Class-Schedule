/**
 * adapters/index.js —— 学校教务系统适配器注册表。
 *
 * ⚠️ 目前是空的，这是**有意为之**：
 *    还不知道你的学校用的是哪套教务系统，所以不写死任何 URL、不伪造任何请求。
 *    没有适配器时，导入面板会如实显示「暂未配置当前学校的教务系统适配器」。
 *
 * 需要你提供这些信息后，才能为你的学校实现适配器：
 *   1. 教务系统登录页网址（例如 https://jw.xxx.edu.cn/）
 *   2. 课表页面截图（看清是表格、还是接口返回的 JSON）
 *   3. 开发者工具 Network 里：登录请求 + 课表请求的 URL / 方法 / 参数 / 响应片段
 *   4. 或者：教务系统自带的"导出课表"文件（Excel / CSV / HTML 均可）
 *
 * 有了信息之后，新建 adapters/school-xxx.js：
 *
 *   import { defineSchoolAdapter } from '../school-adapter.js';
 *
 *   export const schoolXxxAdapter = defineSchoolAdapter({
 *     id: 'xxx',
 *     label: 'XX 大学教务系统',
 *     description: '基于教务系统公开的课表查询接口',
 *     needs: ['学号', '密码'],
 *
 *     async login({ credentials, fetchImpl }) {
 *       const res = await fetchImpl('https://jw.xxx.edu.cn/login', { method: 'POST', body: ... });
 *       return { cookie: res.headers.get('set-cookie') };
 *     },
 *
 *     async fetchCourses({ session, fetchImpl }) {
 *       const res = await fetchImpl('https://jw.xxx.edu.cn/kbcx', { headers: { cookie: session.cookie } });
 *       return res.json();
 *     },
 *
 *     parseCourses({ data }) {
 *       // 把学校自己的字段映射成统一字段，周次/节次/星期交给 csv-importer 里的解析函数复用
 *       return data.rows.map((r) => ({
 *         name: r.kcmc, teacher: r.jsxm, room: r.jasmc,
 *         weekday: r.xqj, startSection: r.jcs, endSection: r.jce, weeks: r.zcd,
 *       }));
 *     },
 *   });
 *
 * 然后在这里 import 并加入 SCHOOL_ADAPTERS，UI 就会自动多出一个可选的学校。
 */

import { registerSchoolAdapters } from '../school-adapter.js';

/** 已注册的适配器（当前为空） */
export const SCHOOL_ADAPTERS = [];

/** 供 index.js 在加载时调用 */
export function registerBuiltinAdapters() {
  return registerSchoolAdapters(SCHOOL_ADAPTERS);
}
