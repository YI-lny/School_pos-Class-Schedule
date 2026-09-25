/**
 * school-adapter.js —— 教务系统直连的通用 Adapter 框架。
 *
 * 设计目标：把"某个学校怎么登录、怎么拿课表"这件事从 UI 和 store 里彻底隔离出来。
 * 目前**没有注册任何学校适配器**（还不清楚你的学校用的是什么教务系统），
 * 所以 UI 会如实显示「暂未配置当前学校的教务系统适配器」，不会伪造成功。
 *
 * 数据流：
 *   用户选择学校 → SchoolAdapter.login() → fetchCourses() → parseCourses()
 *     → 统一 Course[] → course-store.importCourses() → 现有课表 UI
 *
 * 新增一所学校时只需要三步（详见 ./adapters/index.js 里的模板）：
 *   1. adapters/school-xxx.js 里 defineSchoolAdapter({ ... })
 *   2. 在 adapters/index.js 的 SCHOOL_ADAPTERS 里登记
 *   3. 用 runSchoolAdapter('xxx') 跑通（UI 会自动列出它）
 */

import { ImportError } from './importer.js';

/** 没有可用适配器时的统一文案（UI 直接显示这句） */
export const NOT_CONFIGURED_MESSAGE = '暂未配置当前学校的教务系统适配器';

export const NOT_CONFIGURED_HINT =
  '教务系统直连需要针对具体学校实现适配器。请提供：教务系统网址、课表页面截图、' +
  '以及开发者工具 Network 里登录/查课表的请求信息，或直接提供教务系统导出的课表文件（推荐先用 JSON / CSV 导入）。';

const registry = new Map();

/** 校验并冻结一个适配器定义 */
export function defineSchoolAdapter(def = {}) {
  const { id, label, description = '', needs = [], login, fetchCourses, parseCourses } = def;

  if (!id) throw new Error('defineSchoolAdapter: 缺少 id');
  if (typeof login !== 'function') throw new Error(`defineSchoolAdapter(${id}): 缺少 login()`);
  if (typeof fetchCourses !== 'function') throw new Error(`defineSchoolAdapter(${id}): 缺少 fetchCourses()`);
  if (typeof parseCourses !== 'function') throw new Error(`defineSchoolAdapter(${id}): 缺少 parseCourses()`);

  return Object.freeze({
    id,
    label: label || id,
    description,
    /** 需要用户提供哪些信息（UI 可以据此渲染表单） */
    needs,
    login,
    fetchCourses,
    parseCourses,
  });
}

export function registerSchoolAdapter(adapter) {
  registry.set(adapter.id, adapter);
  return adapter;
}

export function registerSchoolAdapters(list = []) {
  list.forEach(registerSchoolAdapter);
  return getSchoolAdapters();
}

export function getSchoolAdapters() {
  return [...registry.values()];
}

export function getSchoolAdapter(id) {
  return registry.get(id) ?? null;
}

export function hasSchoolAdapters() {
  return registry.size > 0;
}

/** 仅用于测试：清空注册表 */
export function clearSchoolAdapters() {
  registry.clear();
}

/**
 * 跑一次教务系统导入。
 *
 * @param {string} id 适配器 id
 * @param {object} [options]
 * @param {object} [options.credentials]  学号/密码等（由 UI 收集，adapter 自己解释）
 * @param {Function} [options.fetchImpl]  注入的 fetch（便于测试 / 代理）
 * @param {(step:string, message:string)=>void} [options.onProgress]
 * @returns {Promise<Array>} 原始行数组（交给统一的 toCourses 转 Course[]）
 */
export async function runSchoolAdapter(id, options = {}) {
  const adapter = getSchoolAdapter(id);

  if (!adapter) {
    throw new ImportError(NOT_CONFIGURED_MESSAGE, {
      hint: NOT_CONFIGURED_HINT,
      source: `school:${id}`,
    });
  }

  const { credentials = {}, fetchImpl = globalThis.fetch, onProgress = () => {} } = options;
  const context = { credentials, fetchImpl, onProgress, adapter };

  try {
    onProgress('login', `正在登录 ${adapter.label}…`);
    const session = await adapter.login(context);

    onProgress('fetch', '正在获取课表…');
    const data = await adapter.fetchCourses({ ...context, session });

    onProgress('parse', '正在解析课表…');
    const rows = await adapter.parseCourses({ ...context, session, data });

    if (!Array.isArray(rows)) {
      throw new ImportError('教务系统返回的数据无法解析', {
        hint: '适配器的 parseCourses() 必须返回课程对象数组',
        detail: rows,
        source: `school:${id}`,
      });
    }
    return rows;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('教务系统导入失败', {
      hint: `来自适配器 ${adapter.label}：${error?.message ?? error}`,
      detail: error,
      source: `school:${id}`,
    });
  }
}
