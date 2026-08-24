// 构建后置脚本: 用 rcedit 给打包好的 exe 嵌入鲸鱼图标 + 产品元数据
// (electron-builder 配置了 signAndEditExecutable:false, 不会自动写图标/版本信息)
// 用法: node scripts/postbuild-icon.js  (被 npm run build 自动调用)
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// rcedit 来自 electron-builder 的 winCodeSign 缓存
function findRcedit() {
  const cacheDir = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(cacheDir)) return null;
  for (const sub of fs.readdirSync(cacheDir)) {
    const p = path.join(cacheDir, sub, 'rcedit-x64.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const APP_EXE = path.join(__dirname, '..', 'dist', 'win-unpacked', 'DeepSeek Harness.exe');
const ICON = path.join(__dirname, '..', 'resources', 'whale-blue.ico');

function main() {
  const rcedit = findRcedit();
  if (!rcedit) { console.error('[postbuild-icon] 未找到 rcedit-x64.exe'); process.exit(1); }
  if (!fs.existsSync(APP_EXE)) { console.error('[postbuild-icon] 未找到', APP_EXE); process.exit(1); }

  const args = [
    APP_EXE,
    '--set-icon', ICON,
    '--set-version-string', 'ProductName', 'DeepSeek Harness',
    '--set-version-string', 'FileDescription', 'DeepSeek Harness',
    '--set-version-string', 'CompanyName', 'DeepSeek',
    '--set-version-string', 'LegalCopyright', 'DeepSeek',
    '--set-product-version', '1.0.0.0',
    '--set-file-version', '1.0.0.0',
  ];
  try {
    execFileSync(rcedit, args, { stdio: 'pipe' });
    console.log('[postbuild-icon] ✓ 鲸鱼图标与产品元数据已嵌入 exe');
  } catch (e) {
    console.error('[postbuild-icon] rcedit 失败:', e.message);
    process.exit(1);
  }
}
main();
