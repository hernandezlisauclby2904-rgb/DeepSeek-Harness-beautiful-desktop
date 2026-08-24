'use strict';
/**
 * 打包产物完整性验证（防止"桥不可用"回归）
 * 用法: node scripts/verify-build.js [asar路径]
 * 在 npm run build 后自动运行; 任何检查失败即 exit 1, 构建视为失败。
 *
 * 检查项:
 *  1. main.js 不引用 preload.fixed.js（打包版只有 preload.js）
 *  2. build.files 配置包含 scripts/** 与 assets/**（否则主进程 require 崩溃）
 *  3. app.asar 内含 scripts/plugin-manager-patch.js、assets/onboarding.html、
 *     assets/onboarding-preload.js、preload.js
 *  4. asar 内 main.js 含 pluginManager 桥 IPC + 向导 IPC (onboard:*)
 *  5. asar 内 preload.js 含 dshDesktop.pluginManager / pluginWizard
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const asarPath = process.argv[2] || path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  [PASS] ${name}`);
  } else {
    failures++;
    console.log(`  [FAIL] ${name} ${detail}`);
  }
}

console.log('=== 打包产物完整性验证 ===');

// 1. 源码层面
const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
check('main.js 不引用 preload.fixed.js', !mainSrc.includes('preload.fixed.js'),
  '(打包版 asar 只有 preload.js, .fixed 名会导致 preload 整体不加载)');

const files = pkg.build && pkg.build.files ? pkg.build.files : [];
check('build.files 含 scripts/**/*', files.includes('scripts/**/*'),
  `(当前: ${JSON.stringify(files)})`);
check('build.files 含 assets/**/*', files.includes('assets/**/*'),
  `(当前: ${JSON.stringify(files)})`);

// 2. asar 产物层面
if (!fs.existsSync(asarPath)) {
  check(`app.asar 存在 (${asarPath})`, false, '(未找到, 请先 npm run build)');
  process.exit(1);
}

// 用 electron 读 asar (node fs 不支持 asar 路径, 走 electron 主进程)
const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(electronBin)) {
  check('electron 二进制存在', false, electronBin);
  process.exit(1);
}
const probeFile = path.join(require('os').tmpdir(), `verify-build-probe-${process.pid}.js`);
fs.writeFileSync(probeFile, `
const { app } = require('electron');
const fs = require('fs');
const base = ${JSON.stringify(asarPath)} + '/';
const out = {};
try {
  out.hasScripts = fs.existsSync(base + 'scripts/plugin-manager-patch.js');
  out.hasOnboarding = fs.existsSync(base + 'assets/onboarding.html');
  out.hasOnboardingPreload = fs.existsSync(base + 'assets/onboarding-preload.js');
  out.hasPreload = fs.existsSync(base + 'preload.js');
  out.main = fs.readFileSync(base + 'main.js', 'utf8');
  out.pre = fs.readFileSync(base + 'preload.js', 'utf8');
} catch (e) { out.err = e.message; }
console.log('RESULT:' + JSON.stringify(out));
app.quit();
`);
let probeOut = '';
try {
  probeOut = execFileSync(electronBin, [probeFile], { encoding: 'utf8', timeout: 30000 });
} catch (e) {
  check('electron 读取 asar', false, (e.stdout || '').slice(-200) || e.message);
  fs.unlinkSync(probeFile);
  process.exit(1);
}
fs.unlinkSync(probeFile);
const result = JSON.parse(probeOut.split('RESULT:')[1]);

check('asar 含 scripts/plugin-manager-patch.js', result.hasScripts === true);
check('asar 含 assets/onboarding.html', result.hasOnboarding === true);
check('asar 含 assets/onboarding-preload.js', result.hasOnboardingPreload === true);
check('asar 含 preload.js', result.hasPreload === true);
check('asar main.js 含插件管理桥 (dsh:plugin-list)', result.main.includes('dsh:plugin-list'));
check('asar main.js 含向导桥 (onboard:open)', result.main.includes('onboard:open'));
check('asar preload.js 含 dshDesktop.pluginManager', result.pre.includes('pluginManager'));
check('asar preload.js 含 dshDesktop.pluginWizard', result.pre.includes('pluginWizard'));

console.log(failures === 0
  ? '=== 全部通过: 打包产物包含完整桥, 不会出现"桥不可用" ==='
  : `=== ${failures} 项失败: 打包产物不完整, 禁止交付 ===`);
process.exit(failures === 0 ? 0 : 1);
