@echo off
chcp 65001 >nul
echo ========================================
echo   AI Workspace 安装包构建器
echo ========================================
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo [1/3] 首次构建，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [1/3] 依赖已安装，跳过
)

echo [2/3] 正在构建安装包...
echo 这可能需要几分钟，请耐心等待...
echo.
call npm run build

if errorlevel 1 (
    echo.
    echo ❌ 构建失败，请检查上方错误信息
    echo 常见问题：
    echo   - 缺少 Visual Studio Build Tools
    echo   - 网络问题导致下载失败
    pause
    exit /b 1
)

echo.
echo [3/3] 构建完成！
echo.
echo 📦 安装包位置：
dir /b dist\*.exe 2>nul
echo.
echo 💡 提示：
echo   - Setup 版本：带安装向导，可自定义安装目录
echo   - Portable 版本：单文件可执行，适合 U 盘携带
echo.
pause
