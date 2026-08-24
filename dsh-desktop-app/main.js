const { app, BrowserWindow, shell, nativeTheme, Menu, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const http = require('http');
const fs = require('fs');
// 插件管理桥：cordis.patch.yml 纯文本手术（复用 EAC 的实现，无外部依赖）
const pluginPatch = require('./scripts/plugin-manager-patch.js');

// 禁用 GPU 硬件加速：本机 GPU 驱动与 Chromium 不兼容会导致 GPU 进程崩溃,
// 渲染进程随之死亡、窗口自动关闭 (表现为启动后闪退)
// 该应用为轻量 UI, 软件渲染完全够用且更稳定
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');

// 禁用网络服务沙盒：自定义 userData 路径会导致沙盒无法访问缓存和网络目录
app.commandLine.appendSwitch('no-sandbox');

// 强制使用浅色主题，阻止跟随系统深色模式
nativeTheme.themeSource = 'light';

// 删除菜单栏
Menu.setApplicationMenu(null);

// 设置任务栏显示名称和图标（开发模式下 Electron 默认显示 "Electron"）
app.setAppUserModelId('com.deepseek.harness.desktop');

// ── user-data 目录解析（修复: 安装版写程序目录可能无权限）─────────────────
// 安装版默认装在 C:\Program Files\...，普通用户无写权限，会导致 userData 初始化失败
// 或 Chromium 缓存写入异常。规则：
//   开发模式        → 项目目录下 user-data
//   可写 exe 目录   → portable/绿色版，用 exe 同级 user-data
//   不可写 exe 目录 → 安装版，回退到 %APPDATA%\DeepSeek Harness\user-data（用户可写）
function resolveUserDataPath() {
  if (!app.isPackaged) return path.join(__dirname, 'user-data');

  const exeDir = path.dirname(process.execPath);
  let exeDirWritable = false;
  try {
    const probe = path.join(exeDir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    exeDirWritable = true;
  } catch { /* 不可写（如 Program Files） */ }

  if (exeDirWritable) {
    return path.join(exeDir, 'user-data');
  }
  return path.join(app.getPath('appData'), 'DeepSeek Harness', 'user-data');
}

const userDataPath = resolveUserDataPath();
try {
  fs.mkdirSync(userDataPath, { recursive: true });
  app.setPath('userData', userDataPath);
} catch (err) {
  console.error('Failed to prepare userData path:', err.message);
}

let mainWindow = null;
let dshProcess = null;
let dshStarted = false; // 标记是否由本进程启动
// 内置插件选择向导窗口状态
let wizardWindow = null;
let wizardMode = 'first';
let wizardDone = null;
const DSH_PORT = 3080;
const DSH_HOST = '127.0.0.1';
// 内部导航放行的回环地址（修复: localhost / [::1] 被误判为外链）
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

/**
 * 自动检测 Node.js 路径，兼容不同安装位置
 */
function findNodePath() {
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(process.env.APPDATA || '', 'nvm', 'current', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
  ];

  // 也检查当前 PATH 中的 node
  const pathNode = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    candidates.push(path.join(dir, pathNode));
  }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return 'node'; // fallback: 依赖系统 PATH
}

/**
 * TCP 端口连通性检查（仅握手，不保证 HTTP 就绪）
 */
function tcpCheck(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * HTTP 探活（修复: 仅 TCP 可连不代表服务已就绪，需 HTTP 响应才算就绪）
 */
function httpProbe(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/', timeout }, (res) => {
      res.resume(); // 消费响应体，避免 socket 泄漏
      resolve(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

/**
 * 检查端口服务是否真正就绪：TCP 可连 + HTTP 有响应
 */
async function checkPort(host, port) {
  const tcpOk = await tcpCheck(host, port);
  if (!tcpOk) return false;
  return httpProbe(host, port);
}

/**
 * 结束 DSH 子进程（修复: Windows 上 kill() 是强杀且不杀进程树，
 * 用 taskkill /T 连子进程树一起结束，避免 3080 端口被孤儿进程占用）
 */
function killProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || !child.pid) return resolve();
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolve());
      killer.on('error', () => {
        try { child.kill(); } catch {}
        resolve();
      });
    } else {
      try { child.kill('SIGTERM'); } catch {}
      resolve();
    }
  });
}

/**
 * 启动 DeepSeek Harness Web 服务
 * （修复竞态: 已有进程在跑则直接返回，避免重复拉起多个后端）
 */
/**
 * 解析 DSH 运行时入口（便携模式优先）
 * 完整版一体包：exe 同级携带 .dsh 运行时 → 解压到任意位置即可运行
 * 回退：用户主目录 ~/.dsh（传统安装方式）
 */
function resolveDshBin() {
  // 便携模式：exe 同级 .dsh
  const exeDir = path.dirname(process.execPath);
  const portableBin = path.join(exeDir, '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (fs.existsSync(portableBin)) return portableBin;
  // 传统模式：用户主目录 .dsh
  return path.join(
    app.getPath('home'),
    '.dsh',
    'profiles',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js'
  );
}

function startDSHService() {
  if (dshProcess) {
    console.log('DSH service already starting/running, skip duplicate start');
    return true;
  }

  const nodePath = findNodePath();
  const dshBin = resolveDshBin();

  // 验证 dsh 入口文件是否存在
  if (!fs.existsSync(dshBin)) {
    console.error('DSH bin not found at:', dshBin);
    return false;
  }

  console.log('Starting DSH service...');
  console.log('Node path:', nodePath);
  console.log('DSH bin:', dshBin);

  dshStarted = true;
  const proc = spawn(nodePath, [dshBin, 'web'], {
    stdio: 'pipe',
    detached: false
  });
  dshProcess = proc;

  proc.stdout.on('data', (data) => {
    console.log(`[DSH] ${data.toString()}`);
  });

  proc.stderr.on('data', (data) => {
    console.error(`[DSH ERROR] ${data.toString()}`);
  });

  proc.on('error', (err) => {
    console.error('Failed to start DSH service:', err);
    // 只清理自己的引用，不影响新进程
    if (dshProcess === proc) dshProcess = null;
  });

  proc.on('exit', (code) => {
    // 用局部引用判断，防止退出回调把新进程的引用误清空
    if (dshProcess === proc) dshProcess = null;
    console.log(`DSH service exited with code ${code}`);

    // 如果是本进程启动的，且窗口还在，自动重启
    if (dshStarted && mainWindow && !mainWindow.isDestroyed()) {
      console.log('Auto-restarting DSH service...');
      setTimeout(() => {
        // 二次确认: 定时器触发时确实没有进程且窗口还在才重启
        if (!dshProcess && mainWindow && !mainWindow.isDestroyed()) {
          startDSHService();
        } else {
          console.log('DSH restart skipped (process exists or window gone)');
        }
      }, 2000);
    }
  });

  return true;
}

/**
 * 等待服务启动完成（checkPort 已含 HTTP 探活）
 */
async function waitForService(host, port, maxWait = 45000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const isUp = await checkPort(host, port);
    if (isUp) {
      console.log('DSH service is ready!');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.error('Timeout waiting for DSH service');
  return false;
}

/**
 * 加载页面（带重试机制）
 */
async function loadPage() {
  const url = `http://${DSH_HOST}:${DSH_PORT}`;
  console.log('Loading URL:', url);

  let retries = 3;
  while (retries > 0) {
    try {
      await mainWindow.loadURL(url);
      console.log('Page loaded successfully');
      return true;
    } catch (err) {
      console.error(`Load attempt failed (${retries} retries left):`, err.message);
      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        // 确认服务还在运行
        const isUp = await checkPort(DSH_HOST, DSH_PORT);
        if (!isUp) {
          console.log('Service down during retry, restarting...');
          startDSHService();
          await waitForService(DSH_HOST, DSH_PORT, 30000);
        }
      }
    }
  }
  return false;
}

/**
 * 判断 URL 是否为本机回环地址（修复: 放行 localhost/[::1]/无端口等内部地址）
 */
function isLoopbackUrl(parsed) {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return LOOPBACK_HOSTS.has(parsed.hostname);
}

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'DeepSeek Harness',
    icon: path.join(__dirname, 'resources', 'whale-blue.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // sandbox:false 说明（低风险项留痕）:
      // 本应用只加载本机 127.0.0.1 的 DSH 页面（可信内容），沙箱关闭便于
      // preload 与渲染进程正常通信；若未来加载不可信远程内容，应改回 true。
      sandbox: false
    },
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#e8f0fa',
    show: false  // 等待主页面加载完成后再显示
  });

  // --- 自定义无边框窗口控制 IPC（移除旧监听器防止重复注册） ---
  ipcMain.removeAllListeners('window-minimize');
  ipcMain.removeAllListeners('window-maximize');
  ipcMain.removeAllListeners('window-close');
  ipcMain.removeAllListeners('window-toggle-fullscreen');
  
  ipcMain.on('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });
  
  ipcMain.on('window-maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      }
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });
  
  ipcMain.on('window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
  
  ipcMain.on('window-toggle-fullscreen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });
  
  // 全屏状态变化通知渲染进程
  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('fullscreen-changed', true);
    }
  });
  
  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('fullscreen-changed', false);
    }
  });

  // 页面加载完成后强制设置窗口标题
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle('DeepSeek Harness');
    }
  });

  // 阻止页面自动修改窗口标题
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });

  // 阻止所有新窗口创建（修复双击出现多个页面的问题）
  // 外部链接用系统浏览器打开; chrome: 等特殊协议一律拦截, 不触发系统弹窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!url.includes(`${DSH_HOST}:${DSH_PORT}`)) {
        shell.openExternal(url);
      }
    }
    return { action: 'deny' };
  });

  // 拦截页面内导航：外部链接用系统浏览器打开，内部回环地址放行；
  // 非 http(s) 协议（含 file:，修复: 避免被诱导跳转本地文件）一律拦截
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (!isLoopbackUrl(parsed)) {
          event.preventDefault();
          shell.openExternal(url);
        }
      } else {
        // chrome: / about: / ms-* / file: 等特殊协议 — 直接吞掉, 防止 Windows "获取应用"弹窗
        event.preventDefault();
      }
    } catch (e) { /* 忽略无效 URL */ }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * ── 插件管理桥（对齐 EAC 桌面端 dshDesktop.pluginManager）────────────
 * 供 dsh-pet-settings 等插件的设置页读取/切换插件启用状态。
 * 数据源: web profile 的 cordis.patch.yml（正则解析，不依赖 yaml 包）。
 */

/** 读取 web profile 的插件注册文件 */
function readPluginPatch() {
  const file = path.join(app.getPath('home'), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  return { file, text };
}

/** 正则解析 patch 里的登记点（- id: 块及其后的 name/disabled/config） */
function parsePatchEntries(text) {
  const entries = [];
  const lines = text.split('\n');
  const idIdx = [];
  lines.forEach((l, i) => { if (/^\s*-\s*id:\s*\S/.test(l)) idIdx.push(i); });
  for (let k = 0; k < idIdx.length; k++) {
    const start = idIdx[k];
    const end = k + 1 < idIdx.length ? idIdx[k + 1] : lines.length;
    const idMatch = lines[start].match(/-\s*id:\s*([\w@./-]+)/);
    if (!idMatch) continue;
    const id = idMatch[1];
    let name = id, disabled = false, hasConfig = false;
    for (let j = start + 1; j < end; j++) {
      const l = lines[j];
      const nm = l.match(/^\s+name:\s*['"]?([^'"]+)['"]?\s*$/);
      if (nm) name = nm[1];
      const dm = l.match(/^\s+disabled:\s*(true|false)\b/);
      if (dm) disabled = dm[1] === 'true';
      if (/^\s+config:/.test(l)) hasConfig = true;
    }
    entries.push({ id, name, disabled, hasConfig });
  }
  return entries;
}

/** 注册插件管理桥 IPC（dsh:plugin-list / set-enabled / set-removed） */
function setupPluginManagerBridge() {
  ipcMain.handle('dsh:plugin-list', () => {
    const { text } = readPluginPatch();
    return parsePatchEntries(text).map((e) => ({
      id: e.id,
      name: e.name,
      description: '',
      enabled: !e.disabled,
      toggleable: true,
      removable: false,
      removed: false,
      core: false,
      group: 'companion'
    }));
  });

  ipcMain.handle('dsh:plugin-set-enabled', (event, { id, enabled } = {}) => {
    if (!id) return { ok: false, error: 'missing id' };
    const { file, text } = readPluginPatch();
    try {
      const patched = pluginPatch.togglePluginInPatch(text, id, !!enabled, id);
      if (patched !== text) {
        fs.writeFileSync(file, patched, 'utf8');
        console.log(`[plugin-bridge] ${enabled ? '启用' : '停用'}插件 ${id}，需重启生效`);
        return { ok: true, restartRequired: true };
      }
      return { ok: true, restartRequired: false, unchanged: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // 移除/恢复语义原项目暂不提供（桌宠设置页不依赖）
  ipcMain.handle('dsh:plugin-set-removed', () => ({ ok: false, error: 'not supported' }));
}

/**
 * ── 内置插件选择向导（对齐 EAC 桌面端 onboard:* IPC）──────────────
 * 设置页「插件 → 选择向导」二次打开 onboarding.html，勾选启用/停用内置插件。
 */

/** 向导目录：patch 里注册的全部插件（glass-workspace 为核心主题，不可停用） */
function buildOnboardingCatalog() {
  const { text } = readPluginPatch();
  return parsePatchEntries(text)
    .filter((e) => e.id !== 'glass-workspace')
    .map((e) => ({ id: e.id, name: e.name, description: '', defaultEnabled: !e.disabled }));
}

/** 当前插件启用状态表 */
function pluginCurrentState() {
  const { text } = readPluginPatch();
  const map = {};
  for (const e of parsePatchEntries(text)) map[e.id] = !e.disabled;
  return map;
}

/** 打开向导窗口（mode: first 首启 / rerun 二次） */
function openPluginWizard({ mode = 'first' } = {}) {
  return new Promise((resolve) => {
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.focus();
      resolve({ ok: false, cancelled: true });
      return;
    }
    wizardMode = mode === 'rerun' ? 'rerun' : 'first';
    wizardDone = resolve;
    const win = new BrowserWindow({
      width: 920,
      height: 700,
      minWidth: 640,
      minHeight: 520,
      show: false,
      title: '内置插件选择向导',
      backgroundColor: '#0b1220',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      frame: false,
      webPreferences: {
        preload: path.join(__dirname, 'assets', 'onboarding-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    wizardWindow = win;
    win.loadFile(path.join(__dirname, 'assets', 'onboarding.html'));
    win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
    win.on('closed', () => {
      const cb = wizardDone;
      wizardDone = null;
      wizardWindow = null;
      if (cb) cb({ ok: false, cancelled: true });
    });
    console.log(`已打开内置插件选择向导（${wizardMode} 模式）`);
  });
}

/** 关闭向导窗口并 resolve */
function closeWizard(result) {
  const cb = wizardDone;
  wizardDone = null;
  if (wizardWindow && !wizardWindow.isDestroyed()) wizardWindow.close();
  wizardWindow = null;
  if (cb) cb(result);
}

/** 注册向导 IPC（onboard:list / submit / close / open） */
function setupWizardBridge() {
  ipcMain.handle('onboard:list', (event) => {
    if (!wizardWindow || event.sender !== wizardWindow.webContents) return null;
    return {
      mode: wizardMode,
      catalog: buildOnboardingCatalog(),
      current: wizardMode === 'rerun' ? pluginCurrentState() : null
    };
  });

  ipcMain.handle('onboard:submit', (event, { ids } = {}) => {
    if (!wizardWindow || event.sender !== wizardWindow.webContents) return { ok: false, error: 'unauthorized' };
    const want = new Set(Array.isArray(ids) ? ids : []);
    const catalog = buildOnboardingCatalog();
    const current = pluginCurrentState();
    const errors = [];
    let applied = 0;
    for (const c of catalog) {
      const target = want.has(c.id);
      if (target !== !!current[c.id]) {
        try {
          const res = pluginManagerSetEnabledImpl(c.id, target);
          if (!res.ok) errors.push(c.id + ': ' + (res.error || 'unknown'));
          else applied++;
        } catch (err) {
          errors.push(c.id + ': ' + String((err && err.message) || err));
        }
      }
    }
    const mode = wizardMode;
    closeWizard({ ok: true, applied, errors });
    if (mode === 'rerun' && dshStarted && dshProcess) {
      console.log('[wizard] rerun 提交，重启 DSH Web 服务使插件生效...');
      const old = dshProcess;
      dshProcess = null;
      killProcessTree(old).then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          startDSHService();
          waitForService(DSH_HOST, DSH_PORT, 30000);
        }
      });
    }
    return { ok: true, applied, errors };
  });

  ipcMain.on('onboard:close', (event) => {
    if (!wizardWindow || event.sender !== wizardWindow.webContents) return;
    closeWizard({ ok: false, cancelled: true });
  });

  ipcMain.handle('onboard:open', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'unauthorized' };
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.focus();
      return { ok: true, reused: true };
    }
    openPluginWizard({ mode: 'rerun' });
    return { ok: true };
  });
}

/** 插件启停落盘（供向导与插件管理桥共用） */
function pluginManagerSetEnabledImpl(id, enabled) {
  const { file, text } = readPluginPatch();
  try {
    const patched = pluginPatch.togglePluginInPatch(text, id, !!enabled, id);
    if (patched !== text) {
      fs.writeFileSync(file, patched, 'utf8');
      return { ok: true, restartRequired: true };
    }
    return { ok: true, restartRequired: false, unchanged: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/**
 * 应用启动流程（提取为函数，供 bootstrap 与 macOS activate 复用）
 */
async function startApp() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  // 检查服务是否已在运行
  const isRunning = await checkPort(DSH_HOST, DSH_PORT);
  if (!isRunning) {
    console.log('DSH service not running, starting...');
    const started = startDSHService();
    if (!started) {
      console.error('Cannot start DSH service - DSH binary not found');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
      return;
    }
    const ready = await waitForService(DSH_HOST, DSH_PORT);
    if (!ready) {
      console.error('Failed to start DSH service within timeout');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
      return;
    }
  } else {
    console.log('DSH service already running');
  }

  // 服务就绪，加载主页面
  const success = await loadPage();
  // 无论成败都保持窗口可见（失败时用户能看到错误页/重试提示）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
  console.log(success ? 'Main page loaded' : 'Main page load failed');
}

// Electron 应用生命周期
// ---- 单实例锁: 无论双击多少次, 全机只允许一个窗口 ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在运行, 直接退出本次启动
  app.quit();
} else {
  // 再次双击/启动时, 聚焦已有窗口而不是新建
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    setupPluginManagerBridge();
    setupWizardBridge();
    return startApp();
  });
}

app.on('window-all-closed', () => {
  console.log('All windows closed');
  dshStarted = false;
  if (dshProcess) {
    console.log('Stopping DSH service...');
    killProcessTree(dshProcess);
    dshProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 修复: macOS activate 分支补齐完整启动流程（建窗口 + 检查/启动服务 + 加载页面）
app.on('activate', () => {
  if (mainWindow === null) {
    startApp();
  }
});

// 优雅退出
app.on('before-quit', () => {
  dshStarted = false;
  if (dshProcess) {
    console.log('Stopping DSH service on quit...');
    killProcessTree(dshProcess);
    dshProcess = null;
  }
});
