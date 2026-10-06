@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ================================================
echo    卡牌对战模拟器 - 本地服务
echo  ================================================
echo.
where node >nul 2>nul
if %errorlevel%==0 (
    echo  [Node 模式] 支持「卡包丢进 cardPacks 就自动识别」+ 卡牌一键导出
    echo  正在打开浏览器 http://localhost:8080/
    start "" http://localhost:8080/
    node tools\serve.js 8080
) else (
    echo  [警告] 未检测到 Node.js，改用 Python 静态服务
    echo         此模式没有自动卡包发现功能，新卡包仍需写入 cardPacks\manifest.json
    echo  正在打开浏览器 http://localhost:8080/
    start "" http://localhost:8080/
    python -m http.server 8080
)
echo.
echo  服务已停止。按任意键关闭窗口。
pause >nul
