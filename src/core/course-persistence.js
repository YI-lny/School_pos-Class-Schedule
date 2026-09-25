/**
 * course-persistence.js —— 用户导入的课表在浏览器本地的持久化。
 *
 * localStorage 键名（按要求）：
 *   school_pos_courses   { version, source, importedAt, courses: Course[] }
 *   school_pos_term      { id, name, startDate, totalWeeks }（可选，导入数据带学期时才有）
 *
 * 规则：
 *   - 只保存"用户自己的课表"；示例（mock）数据不写入本地，
 *     所以刷新后：有用户数据就用用户数据，没有就回到示例课表；
 *   - 读取时做结构校验，坏数据不会让页面白屏（当作没有数据）。
 */

import { normalizeCourses } from '../data/course-model.js';

export const STORAGE_KEYS = {
  courses: 'school_pos_courses',
  term: 'school_pos_term',
};

export const SCHEMA_VERSION = 1;

/**
 * @param {{get:Function,set:Function,remove:Function}} storage 见 core/storage.js
 */
export function createCoursePersistence(storage) {
  if (!storage) {
    return {
      load: () => null,
      save: () => false,
      clear: () => false,
      hasUserData: () => false,
    };
  }

  /** @returns {{courses:Array, term:object|null, source:string, importedAt:number|null}|null} */
  function load() {
    let payload;
    try {
      const raw = storage.get(STORAGE_KEYS.courses, null);
      if (!raw) return null;
      payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (error) {
      console.warn('[课表] 本地保存的课程数据无法解析，已忽略：', error);
      return null;
    }

    const list = Array.isArray(payload) ? payload : payload?.courses;
    if (!Array.isArray(list) || list.length === 0) return null;

    const { courses } = normalizeCourses(list);
    if (courses.length === 0) return null;

    let term = null;
    try {
      const rawTerm = storage.get(STORAGE_KEYS.term, null);
      if (rawTerm) term = typeof rawTerm === 'string' ? JSON.parse(rawTerm) : rawTerm;
    } catch {
      term = null;
    }

    return {
      courses,
      term: term && typeof term === 'object' ? term : null,
      source: payload?.source ?? 'local',
      importedAt: payload?.importedAt ?? null,
    };
  }

  /** @returns {boolean} 是否写入成功 */
  function save({ courses = [], term = null, source = 'import' } = {}) {
    if (!courses.length) return false;
    try {
      storage.set(
        STORAGE_KEYS.courses,
        JSON.stringify({
          version: SCHEMA_VERSION,
          source,
          importedAt: Date.now(),
          courses,
        }),
      );
      if (term) {
        storage.set(
          STORAGE_KEYS.term,
          JSON.stringify({
            id: term.id ?? null,
            name: term.name ?? '',
            startDate: term.startDate ?? null,
            totalWeeks: term.totalWeeks ?? null,
          }),
        );
      }
      return true;
    } catch (error) {
      console.warn('[课表] 保存到本地失败（可能是隐私模式或空间不足）：', error);
      return false;
    }
  }

  function clear() {
    try {
      storage.remove(STORAGE_KEYS.courses);
      storage.remove(STORAGE_KEYS.term);
      return true;
    } catch {
      return false;
    }
  }

  return { load, save, clear, hasUserData: () => Boolean(load()) };
}
