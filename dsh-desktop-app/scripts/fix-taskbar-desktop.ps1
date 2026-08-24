# 修复: 1) 任务栏应用名(Electron→DeepSeek Harness) 2) 桌面快捷方式图标(原子→鲸鱼)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class AppIdSetter {
    [StructLayout(LayoutKind.Sequential)]
    public struct PROPERTYKEY {
        public Guid fmtid;
        public uint pid;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROPVARIANT {
        public ushort vt;
        public ushort wReserved1, wReserved2, wReserved3;
        public IntPtr pVal;
    }
    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        int GetCount(out uint cProps);
        int GetAt(uint iProp, out PROPERTYKEY pkey);
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        int Commit();
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHGetPropertyStoreFromParsingName(string pszPath, IntPtr pbc, uint flags, ref Guid riid, out IPropertyStore ppv);

    public static void Set(string lnkPath, string appId) {
        Guid IID = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
        IPropertyStore store;
        int hr = SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 0, ref IID, out store);
        if (hr != 0) throw new Exception("SHGetPropertyStoreFromParsingName failed: " + hr.ToString("X8"));
        PROPERTYKEY key = new PROPERTYKEY();
        key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); // System.AppUserModel
        key.pid = 5; // PKEY_AppUserModel_ID
        PROPVARIANT pv = new PROPVARIANT();
        pv.vt = 31; // VT_LPWSTR
        pv.pVal = Marshal.StringToCoTaskMemUni(appId);
        store.SetValue(ref key, ref pv);
        store.Commit();
        Marshal.FreeCoTaskMem(pv.pVal);
        Marshal.ReleaseComObject(store);
    }
}
"@

$exe = 'D:\ds\dsh-desktop-app\dist\win-unpacked\DeepSeek Harness.exe'
$ico = 'D:\ds\dsh-desktop-app\resources\whale-blue.ico'

# === 1. 开始菜单快捷方式 (AppUserModelID 匹配 → 任务栏显示 DeepSeek Harness) ===
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk"
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($startMenu)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = Split-Path $exe
$lnk.IconLocation = "$exe,0"
$lnk.Save()
[AppIdSetter]::Set($startMenu, 'com.deepseek.harness.desktop')
Write-Output "✓ 开始菜单快捷方式已创建 + AppUserModelID 已设置: $startMenu"

# === 2. 桌面快捷方式图标 → 直接指向 whale-blue.ico (绕过 exe 图标缓存) ===
$desktop = 'C:\Users\boss\Desktop\DeepSeek Harness.lnk'
$lnk2 = $ws.CreateShortcut($desktop)
$lnk2.TargetPath = $exe
$lnk2.WorkingDirectory = Split-Path $exe
$lnk2.Arguments = ''
$lnk2.IconLocation = "$ico,0"
$lnk2.Save()
Write-Output "✓ 桌面快捷方式图标已指向 whale-blue.ico: $ico"

# === 3. 清图标缓存 + 重启 explorer ===
Stop-Process -Name explorer -Force
Start-Sleep -Seconds 2
Remove-Item "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\IconCache.db" -Force -ErrorAction SilentlyContinue
Start-Process explorer
Write-Output "✓ 图标缓存已清除, explorer 已重启"
