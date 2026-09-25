/**
 * schedule-parser.js —— 课表 PDF 的**纯解析逻辑**（不依赖 pdf.js，可在 Node 里单测）。
 *
 * 输入：各页的文本项（带坐标）：
 *   pages = [{ items: [{ str, x, y }], ... }]
 *
 * 真实课表 PDF（台州学院教务系统导出）的结构特点：
 *   - 页面是旋转过的表格：**星期 = y 轴**（星期一 y 最小，星期日 y 最大，间距约 104），
 *     **节次 = x 轴**（1..12），单元格内的文字沿 x 方向排布；
 *   - 每个单元格 = 一门课的一次教学安排：
 *       课程名★ / (2-3节)1-4周,6-18周 / 校区:xx / 场地:xx / 教师:xx / 教学班:xx / ...
 *   - 因此：
 *       weekday   ← 该块所在的 y 落在哪个星期条带（**用坐标判断，不靠文字顺序**）
 *       start/end ← 单元格里的 "(a-b节)"（(10-10节) 也原样保留）
 *       weeks     ← "(a-b节)" 之后到第一个 "/" 之间的文本
 *       teacher/room/campus ← "/"-分隔的 `键:值` 字段
 *
 * 设计原则：解析不出课程时返回空结果 + 原因，绝不编造课程。
 */

/** 星期标签 → weekday（1=周一 … 7=周日） */
const WEEKDAY_LABELS = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

/** 课程类型标记（台州学院课表用 ★ 理论 / ○ 实验 / ● 实践） */
const TYPE_MARKS = {
  '★': '理论',
  '☆': '理论',
  '○': '实验',
  '●': '实践',
  '◆': '实践',
};

/** 节次标记：中英文括号、各种连接符都要认（真实 PDF 常是全角括号） */
const SECTION_RE = /^[（(]\s*(\d+)\s*[-–—~至]\s*(\d+)\s*节\s*[）)]/;

/** 字段分隔符：半角 / 与全角 ／ 都可能出现 */
const FIELD_SPLIT_RE = /[/／]/;

/** 页面上的表格框架文字（不是课程内容） */
const FURNITURE_PATTERNS = [
  /^学号/,
  /^姓名/,
  /^时间段$/,
  /^节次$/,
  /^上午$|^下午$|^晚上$/,
  /^打印时间/,
  /^其他课程/,
  /^★\s*[:：]/,
  /课表$/,
  /^\d+$/,
  /^星期[一二三四五六日天]$/,
];

function isFurniture(text) {
  const value = String(text ?? '').trim();
  if (!value) return true;
  return FURNITURE_PATTERNS.some((pattern) => pattern.test(value));
}

/* -------------------------------------------------------------- 周次解析 */

/**
 * 解析课表里的周次文本（中文，支持每个区间各自带单双周）。
 *   '1-18周'                  → [1..18]
 *   '1-4周,6-18周'            → 1,2,3,4,6..18
 *   '2-18周(双)'              → 2,4,...18
 *   '9-11周(单)'              → 9,11
 *   '3周,7周'                 → 3,7
 *   '1-4周,6-18周(双)'        → 1..4 + 6,8,...18   ← 单双周只作用于它所在的区间
 * @returns {number[]} 升序周次
 */
export function parsePdfWeeks(text) {
  const weeks = new Set();
  const source = String(text ?? '').replace(/[（]/g, '(').replace(/[）]/g, ')');

  for (const rawPart of source.split(/[,，、;；]+/)) {
    const part = rawPart.trim();
    if (!part) continue;

    const parity = /\(\s*单\s*\)/.test(part) ? 'odd' : /\(\s*双\s*\)/.test(part) ? 'even' : null;
    const body = part.replace(/\([^)]*\)/g, '');

    const range = body.match(/(\d+)\s*[-~—至]\s*(\d+)/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let week = Math.min(from, to); week <= Math.max(from, to); week += 1) {
        if (parity === 'odd' && week % 2 === 0) continue;
        if (parity === 'even' && week % 2 === 1) continue;
        weeks.add(week);
      }
      continue;
    }

    const single = body.match(/(\d+)/);
    if (single) {
      const week = Number(single[1]);
      if (parity === 'odd' && week % 2 === 0) continue;
      if (parity === 'even' && week % 2 === 1) continue;
      weeks.add(week);
    }
  }

  return [...weeks].sort((a, b) => a - b);
}

/**
 * 把周次数组写回项目现有的 weeks 字符串语法（week-utils 能直接解析）：
 *   连续区间 → '1-18'
 *   单一奇偶且连续 → '2-18(双)'
 *   其它 → 合并连续段后逗号连接，如 '1-4,6,8,10,18'
 */
export function formatWeeks(weeks) {
  const list = [...new Set(weeks)].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (list.length === 0) return '*';

  const isContiguous = list.every((week, index) => index === 0 || week === list[index - 1] + 1);

  if (isContiguous) return list.length === 1 ? String(list[0]) : `${list[0]}-${list[list.length - 1]}`;

  const allOdd = list.every((week) => week % 2 === 1);
  const allEven = list.every((week) => week % 2 === 0);
  const step2 = list.every((week, index) => index === 0 || week === list[index - 1] + 2);
  if (step2 && (allOdd || allEven)) {
    return `${list[0]}-${list[list.length - 1]}(${allEven ? '双' : '单'})`;
  }

  // 合并连续段
  const parts = [];
  let start = list[0];
  let prev = list[0];
  for (let i = 1; i <= list.length; i += 1) {
    const current = list[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  return parts.join(',');
}

/* -------------------------------------------------------------- 文本工具 */

/** 把一门课的文本块拆成字段：'/'-分隔的 `键:值` */
function splitFields(text) {
  const fields = {};
  for (const chunk of String(text).split(FIELD_SPLIT_RE)) {
    const match = chunk.match(/^\s*([^:：]{1,10})[:：]\s*([\s\S]*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!value) continue;
    if (!fields[key]) fields[key] = value;
  }
  return fields;
}

function pickField(fields, keys) {
  for (const key of keys) {
    if (fields[key]) return fields[key];
  }
  return '';
}

/** 课程名末尾的类型标记 → { name, type } */
function splitTypeMark(rawName) {
  const text = String(rawName).trim();
  const last = text.slice(-1);
  if (TYPE_MARKS[last]) {
    return { name: text.slice(0, -1).trim(), type: TYPE_MARKS[last] };
  }
  return { name: text, type: '' };
}

/* -------------------------------------------------------------- 主解析 */

function collectWeekdayBands(pages) {
  const found = new Map(); // weekday → y
  for (const page of pages) {
    for (const item of page.items) {
      const text = String(item.str ?? '').trim();
      const match = text.match(/^星期([一二三四五六日天])$/);
      if (!match) continue;
      const weekday = WEEKDAY_LABELS[match[1]];
      if (weekday && !found.has(weekday)) found.set(weekday, item.y);
    }
  }

  const entries = [...found.entries()].sort((a, b) => a[1] - b[1]); // y 升序 = 周一到周日
  if (entries.length < 5) return null;

  const spacing =
    entries.length > 1
      ? (entries[entries.length - 1][1] - entries[0][1]) / (entries.length - 1)
      : 100;
  const half = Math.abs(spacing) / 2;

  const bands = entries.map(([weekday, y], index) => ({
    weekday,
    y,
    min: index === 0 ? y - half : (entries[index - 1][1] + y) / 2,
    max: index === entries.length - 1 ? y + half : (y + entries[index + 1][1]) / 2,
  }));

  return bands;
}

/** 星期标签的 x（用于区分"内容列"与页面左侧的表格框架文字） */
function collectLabelMaxX(pages) {
  let maxX = -Infinity;
  for (const page of pages) {
    for (const item of page.items) {
      if (/^星期[一二三四五六日天]$/.test(String(item.str ?? '').trim())) {
        maxX = Math.max(maxX, Number(item.x) || 0);
      }
    }
  }
  return Number.isFinite(maxX) ? maxX : 0;
}

/**
 * 判断一段文字是不是"课程名的一部分"。
 * 课程名不会带 `/`（字段分隔符）也不会带 `:`（键值分隔符）；
 * 真实 PDF 里像 `04121111-01/教学班组成`、`03010038-15/教学班组成` 这种
 * 断在键值中间的小片段，正是靠这两条排除掉的。
 */
function isNameLike(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  if (SECTION_RE.test(value)) return false;
  if (/[/／]/.test(value)) return false;
  if (/[:：]/.test(value)) return false;
  return true;
}

function weekdayAt(bands, y) {
  for (const band of bands) {
    if (y >= band.min && y <= band.max) return band.weekday;
  }
  return null;
}

/**
 * 解析全部页面 → 课程安排行（统一 Course 的原始行）。
 *
 * @param {Array<{items:Array<{str:string,x:number,y:number}>}>} pages
 * @returns {{rows:Array, warnings:string[], stats:object}}
 */
export function parseSchedulePages(pages = []) {
  const warnings = [];
  const stats = { items: 0, blocks: 0, skipped: 0, merged: 0, pages: pages.length };

  const bands = collectWeekdayBands(pages);
  if (!bands) {
    return {
      rows: [],
      warnings: ['没有在 PDF 里找到「星期一 ~ 星期日」表头，无法判断课程属于星期几'],
      stats,
    };
  }

  const minBandY = Math.min(...bands.map((band) => band.min));
  const contentMinX = collectLabelMaxX(pages) + 10; // 星期标签右侧才是课程内容
  const blocks = [];

  for (const page of pages) {
    const perWeekday = new Map();

    for (const item of page.items) {
      const text = String(item.str ?? '').trim();
      if (!text || isFurniture(text)) continue;
      stats.items += 1;
      if (item.y < minBandY) continue; // 表格下方的节次编号 / 上午下午 / 图例

      const weekday = weekdayAt(bands, item.y);
      if (!weekday) continue;
      if (!perWeekday.has(weekday)) perWeekday.set(weekday, []);
      perWeekday.get(weekday).push({ text, x: item.x, y: item.y });
    }

    for (const [weekday, items] of perWeekday) {
      items.sort((a, b) => a.x - b.x);

      // ① 找出所有 "(a-b节)" 项的下标 —— 它是每个课程块的锚点
      const scheduleIndexes = [];
      items.forEach((item, index) => {
        if (SECTION_RE.test(item.text)) scheduleIndexes.push(index);
      });
      if (scheduleIndexes.length === 0) continue;

      // ② 课程名 = 锚点往前连续的"名字样"文字（不含 : 与 /，且与锚点相邻）
      const nameStarts = scheduleIndexes.map((scheduleIndex, order) => {
        const lowerBound = order === 0 ? 0 : scheduleIndexes[order - 1] + 1;
        let start = scheduleIndex;
        // 单元格内的文字行间距约 12pt；跨列/页面标题离得很远，用间距把后者挡掉
        while (
          start - 1 >= lowerBound &&
          isNameLike(items[start - 1].text) &&
          Math.abs(items[start].x - items[start - 1].x) <= 20
        ) {
          start -= 1;
        }
        return start;
      });

      // ③ 字段 = 锚点到下一块课程名之前的所有文字
      scheduleIndexes.forEach((scheduleIndex, order) => {
        const nameStart = nameStarts[order];
        const name = items
          .slice(nameStart, scheduleIndex)
          .map((item) => item.text)
          .join('');
        const tailEnd = order + 1 < nameStarts.length ? nameStarts[order + 1] : items.length;
        blocks.push({
          weekday,
          nameParts: name ? [name] : [],
          scheduleItem: items[scheduleIndex].text,
          tail: items.slice(scheduleIndex, tailEnd).map((item) => item.text),
        });
      });
    }
  }

  stats.blocks = blocks.length;

  /* ---- 每个块 → 一行课程安排 ---- */
  const rows = [];
  for (const block of blocks) {
    const rawName = block.nameParts.join('');
    const { name, type } = splitTypeMark(rawName);
    if (!name) {
      stats.skipped += 1;
      continue;
    }

    const sectionMatch = block.scheduleItem.match(SECTION_RE);
    const startSection = Number(sectionMatch[1]);
    const endSection = Number(sectionMatch[2]);

    const joined = block.tail.join('');
    const afterSection = joined.replace(SECTION_RE, '');
    const weeksText = afterSection.split(FIELD_SPLIT_RE)[0] ?? '';
    const weeks = parsePdfWeeks(weeksText);

    const fields = splitFields(joined);
    const teacher = pickField(fields, ['教师', '任课教师', '老师']);
    const room = pickField(fields, ['场地', '教室', '上课地点']);
    const campus = pickField(fields, ['校区', '上课校区']);

    rows.push({
      name,
      teacher,
      room,
      campus,
      weekday: block.weekday,
      startSection,
      endSection,
      weeks: formatWeeks(weeks),
      note: type,
    });
  }

  /* ---- 合并"同一天同一节次、只有周次不同"的多次安排（例如实验室轮换）---- */
  const merged = new Map();
  const result = [];
  for (const row of rows) {
    const key = [row.name, row.teacher, row.weekday, row.startSection, row.endSection].join('|');
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      result.push(row);
      continue;
    }
    const union = [...new Set([...parsePdfWeeks(existing.weeks), ...parsePdfWeeks(row.weeks)])];
    existing.weeks = formatWeeks(union);
    existing.note = existing.note || row.note;
    if (existing.room !== row.room) {
      stats.merged += 1;
      warnings.push(
        `${row.name}（周${'一二三四五六日'[row.weekday - 1]} 第${row.startSection}-${row.endSection}节）在不同周次使用了不同场地：` +
          `${existing.room || '未填'} / ${row.room || '未填'}，已在同一张卡片上显示首个场地，周次已合并`,
      );
    }
  }

  return { rows: result, warnings, stats };
}
