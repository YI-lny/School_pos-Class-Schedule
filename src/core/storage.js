/**
 * localStorage 适配器（可安全降级：隐私模式 / SSR / 测试环境下不报错）。
 * store 只依赖这个接口，方便测试时注入内存实现。
 */

const memory = new Map();

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

export function createStorage(prefix = 'school-pos:') {
  return {
    get(key, fallback = null) {
      const fullKey = prefix + key;
      try {
        if (hasLocalStorage()) {
          const value = localStorage.getItem(fullKey);
          return value === null ? fallback : value;
        }
      } catch {
        /* ignore */
      }
      return memory.has(fullKey) ? memory.get(fullKey) : fallback;
    },
    set(key, value) {
      const fullKey = prefix + key;
      try {
        if (hasLocalStorage()) {
          localStorage.setItem(fullKey, String(value));
          return;
        }
      } catch {
        /* ignore */
      }
      memory.set(fullKey, String(value));
    },
    remove(key) {
      const fullKey = prefix + key;
      try {
        if (hasLocalStorage()) localStorage.removeItem(fullKey);
      } catch {
        /* ignore */
      }
      memory.delete(fullKey);
    },
  };
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    get: (key, fallback = null) => (map.has(key) ? map.get(key) : fallback),
    set: (key, value) => void map.set(key, String(value)),
    remove: (key) => void map.delete(key),
  };
}
