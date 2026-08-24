@echo off
chcp 65001 >nul
echo ========================================
echo   AI Workspace 开发模式启动器
echo ========================================
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo [1/2] 首次运行，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo.
        echo ❌ 依赖安装失败，请检查：
        echo    1. Node.js 是否已安装（node --version）
        echo    2. npm 是否可用（npm --version）
        echo    3. 网络连接是否正常
        pause
        exit /b 1
    )
    echo ✅ 依赖安装完成
    echo.
) else (
    echo [1/2] 依赖已安装，跳过
)

echo [2/2] 正在启动应用...
echo.
call npm start

if errorlevel 1 (
    echo.
    echo ❌ 应用启动失败，请检查上方错误信息
    pause
)
