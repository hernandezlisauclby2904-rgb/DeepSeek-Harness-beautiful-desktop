; installer.nsh — 安装完成后询问是否在任务栏创建快捷方式
; 在 NSIS 安装向导的 "完成" 页面之前执行

!macro customInstall
  ; 桌面快捷方式已由 electron-builder 自动创建
  ; 额外询问：是否在任务栏固定快捷方式
  MessageBox MB_YESNO "是否在任务栏上创建 DeepSeek Harness 快捷方式？" IDYES taskbar IDNO skipTaskbar
  taskbar:
    ; 使用 PowerShell 将快捷方式固定到任务栏 (NSIS 中 $ 需写为 $$)
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$s = [System.IO.Path]::Combine($$env:APPDATA, ''Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar''); $$src = [System.IO.Path]::Combine($$env:APPDATA, ''Microsoft\Windows\Start Menu\Programs'', ''${PRODUCT_NAME}'', ''${PRODUCT_NAME}.lnk''); if (Test-Path $$src) { Copy-Item $$src $$s -Force }"'
  skipTaskbar:
!macroend
