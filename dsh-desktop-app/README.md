# AI Workspace - DeepSeek Harness 桌面端

基于 DeepSeek Harness 的独立桌面应用，双击即可使用，无需在浏览器中打开。

## 📦 快速开始

### 1. 安装依赖

```bash
cd D:\ds\dsh-desktop-app
npm install
```

### 2. 开发模式运行

```bash
npm start
```

这会：
- 自动启动 DeepSeek Harness 后端服务（端口 3080）
- 等待服务就绪后打开桌面窗口
- 关闭窗口时自动停止后端服务

### 3. 构建安装包

#### 构建安装版（带安装向导）
```bash
npm run build
```
输出文件：`dist/AI Workspace Setup X.X.X.exe`

#### 构建便携版（单文件可执行）
```bash
npm run build:portable
```
输出文件：`dist/AI-Workspace-Portable.exe`

## 🎨 自定义图标

将你的图标文件放到 `resources/icon.ico`（Windows 格式，建议 256x256）。

如果没有图标，可以：
1. 使用在线工具转换：https://convertio.co/png-ico/
2. 或者删除 `package.json` 中的 `"icon": "resources/icon.ico"` 行

## 🔧 配置说明

### 修改端口

编辑 `main.js` 中的：
```javascript
const DSH_PORT = 3080; // 改成你想要的端口
```

### 修改窗口大小

编辑 `main.js` 中 `createWindow()` 函数：
```javascript
width: 1400,  // 默认宽度
height: 900,  // 默认高度
```

### 启用开发者工具

取消 `main.js` 中这行的注释：
```javascript
// mainWindow.webContents.openDevTools();
```

## 📁 项目结构

```
dsh-desktop-app/
├── main.js          # Electron 主进程
├── preload.js       # 预加载脚本
├── package.json     # 项目配置
├── resources/       # 资源文件
│   └── icon.ico     # 应用图标（可选）
├── dist/            # 构建输出（生成后）
└── README.md        # 本文档
```

## ⚙️ 工作原理

1. **启动流程**
   - 检查 3080 端口是否已有服务运行
   - 如果没有，启动 `~/.dsh/profiles/.../dsh/lib/bin.js web`
   - 等待服务就绪（最多 30 秒）
   - 打开 Electron 窗口加载 `http://127.0.0.1:3080`

2. **关闭流程**
   - 关闭所有窗口时自动停止后端服务
   - 如果后端服务是手动启动的，则不会停止

## 🐛 故障排除

### 服务启动失败

检查控制台输出，常见原因：
- Node.js 未安装或路径不对
- DeepSeek Harness 未正确安装
- 端口 3080 被其他程序占用

### 窗口打开但显示空白

- 等待几秒让服务完全启动
- 按 `Ctrl+Shift+I` 打开开发者工具查看错误

### 构建失败

- 确保已运行 `npm install`
- Windows 需要安装 Visual Studio Build Tools（electron-builder 依赖）

## 📝 注意事项

- 首次运行需要几秒钟启动后端服务
- 构建的安装包约 150-200 MB（包含 Electron 运行时）
- 便携版可以直接复制到 U 盘使用

## 🔗 相关链接

- [DeepSeek Harness](https://github.com/deepseek-ai/harness)
- [Electron 文档](https://www.electronjs.org/docs)
- [Electron Builder](https://www.electron.build/)
