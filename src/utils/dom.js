/**
 * 极简 DOM 构建工具。
 * 组件全部用它生成真实 DOM（而不是 innerHTML 拼字符串），
 * 这样插值内容天然免疫 XSS，也便于挂事件。
 */

/**
 * 创建元素。
 * @param {string} tag 标签名
 * @param {object} [props] 属性：class / text / html / style / dataset / on* / aria-* ...
 * @param {Array|Node|string} [children] 子节点
 */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key === 'style') {
      if (typeof value === 'string') {
        el.style.cssText = value;
      } else {
        for (const [prop, v] of Object.entries(value)) {
          if (v === null || v === undefined) continue;
          if (prop.startsWith('--')) el.style.setProperty(prop, String(v));
          else el.style[prop] = String(v);
        }
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        el.dataset[k] = String(v);
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }

  append(el, children);
  return el;
}

/** 追加子节点（自动跳过 null / false / undefined）。 */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** 清空子节点。 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** 便捷查询。 */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * 使用 requestAnimationFrame 合并高频调用（滚动 / resize）。
 */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

/** 防抖。 */
export function debounce(fn, wait = 120) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
