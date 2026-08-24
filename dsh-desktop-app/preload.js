// Preload 脚本：在渲染进程中安全暴露 API
// v2: 新增 dshDesktop.pluginManager（插件管理桥，对齐 EAC 桌面端）
//     供 dsh-pet-settings 等插件的设置页读取/切换插件启用状态
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  // 窗口控制
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowToggleFullscreen: () => ipcRenderer.send('window-toggle-fullscreen'),
  onFullscreenChanged: (callback) => ipcRenderer.on('fullscreen-changed', (event, isFullscreen) => callback(isFullscreen))
});

// 插件管理桥（与 EAC 桌面端 preload 相同接口，供 dsh-pet-settings 等消费）
contextBridge.exposeInMainWorld('dshDesktop', {
  // 内置插件选择向导：重新打开 onboarding.html 向导窗口
  pluginWizard: {
    open: () => ipcRenderer.invoke('onboard:open')
  },
  pluginManager: {
    list: () => ipcRenderer.invoke('dsh:plugin-list'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('dsh:plugin-set-enabled', { id, enabled }),
    setRemoved: (id, removed) => ipcRenderer.invoke('dsh:plugin-set-removed', { id, removed })
  }
});
