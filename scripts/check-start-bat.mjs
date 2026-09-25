/**
 * start.bat 验证（静态检查 / 脚本验证）。
 *
 * 为什么是静态检查：start.bat 会真的安装依赖并启动服务器，行为测试需要"桩程序 + 临时沙箱"，
 * 在普通环境下无法可靠地隔离执行（实测中 npm 桩的调用捕获不稳定）。
 * 因此这里按需求里允许的方式，对启动脚本做**确定性的结构验证**，
 * 逐条确认下面这些行为分支真实存在且顺序正确：
 *   1. 检查 Node.js；缺失 → 明确报错 + 暂停 + 退出（不会继续）
 *   2. 检查 npm；缺失 → 明确报错 + 退出
 *   3. 检查关键依赖（pdfjs-dist 的 package.json 与 cmaps，不只看 node_modules 是否存在）
 *   4. 只有依赖缺失时才 npm install（不是每次启动都装）
 *   5. npm install 失败 → 报错 + 退出（不会启动不完整的项目）
 *   6. 安装后二次确认，防止"npm 返回 0 但依赖仍不可用"的假成功
 *   7. 启动命令保持不变（node scripts\dev-server.mjs）
 *   8. 支持路径含空格（cd /d "%~dp0"）
 *
 * 用法：npm run check:start
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bat = readFileSync(join(ROOT, 'start.bat'), 'utf8');

let passed = 0;
const failures = [];

function check(label, actual, expected = true) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}\n      期望: ${e}\n      实际: ${a}`);
    console.log(`  ✗ ${label}\n      期望: ${e}\n      实际: ${a}`);
  }
}

console.log('start.bat 静态验证（逐条确认行为分支真实存在）\n');

/* 1. Node.js 检查 */
check('检查 Node.js（where node）', /where node >nul 2>nul/.test(bat));
check('缺少 Node.js → 明确提示安装地址', /没有找到 Node\.js[\s\S]{0,200}https:\/\/nodejs\.org\//.test(bat));
check('缺少 Node.js → 暂停后退出（不继续启动）', /没有找到 Node\.js[\s\S]{0,400}pause[\s\S]{0,80}exit \/b 1/.test(bat));

/* 2. npm 检查 */
check('检查 npm（where npm）', /where npm >nul 2>nul/.test(bat));
check('缺少 npm → 报错并退出', /没有找到 npm[\s\S]{0,300}exit \/b 1/.test(bat));

/* 3. 依赖检查：不只看 node_modules 目录 */
check('依赖检查看的是 pdfjs-dist/package.json', bat.includes('node_modules\\pdfjs-dist\\package.json'));
check('依赖检查还确认 cmaps（中文 PDF 解析需要）', bat.includes('node_modules\\pdfjs-dist\\cmaps'));
check('不会只判断 node_modules 目录是否存在', /if exist "node_modules" |if not exist "node_modules" /.test(bat), false);

/* 4. 条件安装 */
const installIndex = bat.indexOf('call npm install');
const flagIndex = bat.indexOf('if defined NEED_INSTALL');
check('存在"依赖缺失"标记与条件分支', flagIndex >= 0 && installIndex >= 0);
check('npm install 在条件分支之内（不是每次都装）', flagIndex < installIndex && flagIndex >= 0);
check('只在缺失时设置 NEED_INSTALL', /if not exist "node_modules\\pdfjs-dist\\package\.json" set "NEED_INSTALL=1"/.test(bat));

/* 5. 安装失败处理 */
check('npm install 失败 → 明确报错', /npm install 失败/.test(bat));
check('npm install 失败 → 退出，不启动项目', /npm install 失败[\s\S]{0,300}exit \/b 1/.test(bat));
check('失败分支出现在启动命令之前', bat.indexOf('npm install 失败') < bat.indexOf('node scripts\\dev-server.mjs'));

/* 6. 假成功防护 */
check('安装后二次确认依赖存在', /仍找不到 node_modules\\pdfjs-dist/.test(bat));
check('二次确认失败 → 退出', /仍找不到 node_modules\\pdfjs-dist[\s\S]{0,300}exit \/b 1/.test(bat));

/* 7. 启动命令不变 */
check('启动命令仍是 node scripts\\dev-server.mjs', /node scripts\\dev-server\.mjs/.test(bat));
check('启动前会打开浏览器（保持原行为）', /Start-Process 'http:\/\/127\.0\.0\.1:5173\/'/.test(bat));
check('未引入任何第三方依赖 / 额外工具', /npx |pnpm |yarn |winget |choco /.test(bat), false);

/* 8. Windows 批处理健壮性 */
check('切到脚本所在目录（路径含空格也安全）', /cd \/d "%~dp0"/.test(bat));
check('使用 setlocal / endlocal 隔离环境变量', /setlocal/.test(bat) && /endlocal/.test(bat));
check('设置 UTF-8 代码页（中文 Windows 不乱码）', /chcp 65001/.test(bat));
check('所有退出分支都带 pause（双击运行不会一闪而过）', (() => {
  const exits = bat.match(/exit \/b 1/g) ?? [];
  const pauses = bat.match(/pause/g) ?? [];
  return exits.length > 0 && pauses.length >= exits.length;
})());

console.log('');
if (failures.length === 0) {
  console.log(`start.bat 静态验证全部通过：${passed} 项 ✅`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项 ❌\n`);
  for (const f of failures) console.log(`  • ${f}\n`);
  process.exit(1);
}
