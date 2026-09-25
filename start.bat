@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo   课程表 · 本地启动
echo   ----------------------------------------

rem ---------- 1. 检查 Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 没有找到 Node.js。
  echo   本项目需要 Node.js 18 或更高版本，请先安装：https://nodejs.org/
  echo   安装完成后重新运行 start.bat。
  echo.
  pause
  exit /b 1
)

rem ---------- 2. 检查 npm ----------
where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 找到了 Node.js，但没有找到 npm。
  echo   请重新安装 Node.js（安装包会自带 npm）：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem ---------- 3. 检查关键依赖是否真的装好了（不只看 node_modules 是否存在） ----------
rem  本项目唯一的运行时依赖是 pdfjs-dist（PDF 课表导入 / 本地解析）。
rem  中文课表 PDF 需要它自带的 cmaps 目录，所以两个都要在。
set "NEED_INSTALL="
if not exist "node_modules\pdfjs-dist\package.json" set "NEED_INSTALL=1"
if not exist "node_modules\pdfjs-dist\cmaps" set "NEED_INSTALL=1"

if defined NEED_INSTALL (
  echo.
  echo   检测到依赖尚未安装（缺少 node_modules\pdfjs-dist），正在执行 npm install ...
  echo   这一步只在第一次运行时需要，之后启动会直接跳过。
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [错误] npm install 失败，项目依赖不完整，已停止启动。
    echo   请检查网络连接后重试，或手动执行：npm install
    echo.
    pause
    exit /b 1
  )

  rem 安装完再确认一次，避免"安装成功但依赖仍然不可用"的假成功
  if not exist "node_modules\pdfjs-dist\package.json" (
    echo.
    echo   [错误] npm install 已结束，但仍找不到 node_modules\pdfjs-dist。
    echo   请手动执行 npm install 检查报错信息。
    echo.
    pause
    exit /b 1
  )
  echo.
  echo   依赖安装完成。
)

rem ---------- 4. 启动 ----------
echo.
echo   正在启动课程表本地服务器...
echo   浏览器会自动打开 http://127.0.0.1:5173/
echo   关闭这个窗口即可停止服务。
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:5173/'"

node scripts\dev-server.mjs
endlocal
pause
