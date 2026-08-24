import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'assets');
const USER_CONFIG = path.join(homedir(), '.dsh', 'glass-workspace.json');

const DEFAULT_CONFIG = {
  background: {
    // 相对 assets 目录的文件名、本机绝对路径或 http(s) URL 均可
    image: 'bg-default.png',
    enabled: true,
    overlay: 0.22, // 浅色遮罩强度 0~1 (调浅背景, 让顶部与主背景衔接自然)
    blur: 0        // 背景图自身模糊 px
  },
  glass: {
    blur: 14,          // UI 毛玻璃强度 px
    sidebarAlpha: 0.72,
    panelAlpha: 0.62,
    radius: 16
  },
  performance: { autoDegrade: true }
};

let lastConfig = null;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function num(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 只接受已知字段与范围，防止任意数据写入本机配置。 */
function sanitize(patch) {
  const cur = lastConfig || DEFAULT_CONFIG;
  const b = (patch && typeof patch.background === 'object' && patch.background) || {};
  const g = (patch && typeof patch.glass === 'object' && patch.glass) || {};
  const p = (patch && typeof patch.performance === 'object' && patch.performance) || {};
  return {
    background: {
      image: typeof b.image === 'string' ? b.image.slice(0, 512) : cur.background.image,
      enabled: b.enabled !== false,
      overlay: num(b.overlay, cur.background.overlay, 0, 0.9),
      blur: num(b.blur, cur.background.blur, 0, 16)
    },
    glass: {
      blur: num(g.blur, cur.glass.blur, 0, 40),
      sidebarAlpha: num(g.sidebarAlpha, cur.glass.sidebarAlpha, 0.1, 1),
      panelAlpha: num(g.panelAlpha, cur.glass.panelAlpha, 0.1, 1),
      radius: num(g.radius, cur.glass.radius, 0, 32)
    },
    performance: { autoDegrade: p.autoDegrade !== false }
  };
}

async function loadConfig() {
  try {
    const raw = JSON.parse(await readFile(USER_CONFIG, 'utf8'));
    const cfg = {
      ...DEFAULT_CONFIG,
      ...raw,
      background: { ...DEFAULT_CONFIG.background, ...(raw.background || {}) },
      glass: { ...DEFAULT_CONFIG.glass, ...(raw.glass || {}) },
      performance: { ...DEFAULT_CONFIG.performance, ...(raw.performance || {}) }
    };
    lastConfig = cfg;
    return cfg;
  } catch {
    lastConfig = DEFAULT_CONFIG;
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(cfg) {
  const dir = path.dirname(USER_CONFIG);
  await mkdir(dir, { recursive: true });
  const tmp = USER_CONFIG + '.tmp';
  await writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  await rename(tmp, USER_CONFIG);
  lastConfig = cfg;
  return cfg;
}

// 背景图来源：assets 相对名 / 绝对路径 / URL
function resolveBg(cfg) {
  const img = cfg.background.image || '';
  if (/^(https?:)?\/\//.test(img) || img.startsWith('data:')) return { kind: 'remote', value: img };
  if (path.isAbsolute(img) && existsSync(img)) return { kind: 'local', value: img };
  return { kind: 'asset', value: path.join(ASSETS, img || 'bg-default.png') };
}

function bootHtml(cfg) {
  const b = cfg.background;
  const g = cfg.glass;
  const bg = resolveBg(cfg);
  const bgUrl = bg.kind === 'remote' ? bg.value
    : bg.kind === 'local' ? `/glass-assets/local-bg/${encodeURIComponent(bg.value)}`
    : `/glass-assets/bg/${encodeURIComponent(path.basename(bg.value))}`;
  const link = b.enabled ? `<link rel="stylesheet" href="/glass-assets/glass.css">` : '';
  const style = `<style id="glass-boot">:root{--glass-bg-image:url("${bgUrl}");--glass-overlay:${b.overlay};--glass-bg-blur:${b.blur}px;--glass-blur:${g.blur}px;--glass-sidebar-alpha:${g.sidebarAlpha};--glass-panel-alpha:${g.panelAlpha};--glass-radius:${g.radius}px;}</style>`;
  const degrade = cfg.performance.autoDegrade ? `<script>(()=>{try{var low=navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4;var rm=matchMedia('(prefers-reduced-motion: reduce)').matches;if(low||rm){document.documentElement.setAttribute('data-glass-fx','low');}}catch(e){}})()</script>` : '';
  const attr = b.enabled ? 'on' : 'off';
  const script = `<script>document.documentElement.setAttribute('data-glass-bg','${attr}')</script>`;
  // 加载页门卫: 淡蓝→白渐变背景(加载期间不露出背景大图), 居中白色小卡片
  // (中心鲸鱼 + DeepSeek/Harness 文字 + Loading 三点灵动动画); 跟随加载完成 —
  // 最短 1.5s, 失败/超时显示失败弹窗; 移除门卫后才露出背景大图
  const curtain = `<script>(()=>{try{
var MIN_MS=1500,TIMEOUT_MS=20000,t0=performance.now(),removed=false,done=false;
var ov=document.createElement('div');
ov.id='ds-glass-curtain';
ov.style.cssText='position:fixed;inset:0;z-index:9996;background:linear-gradient(175deg,#dcecfb 0%,#eef6fe 48%,#f8fbff 100%);display:flex;align-items:center;justify-content:center;pointer-events:none;';
ov.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;gap:9px;background:rgba(255,255,255,0.97);border-radius:20px;box-shadow:0 14px 44px rgba(58,110,190,0.16);padding:28px 42px;">'
+'<img src="/glass-assets/bg/ds-whale-logo.png" style="width:62px;height:62px;object-fit:contain;animation:dsGlassBreathe 1.8s ease-in-out infinite;margin-bottom:4px" alt="">'
+'<div style="font-size:26px;font-weight:700;letter-spacing:0;line-height:1.1;color:#1e3a8a;-webkit-font-smoothing:antialiased;text-shadow:none">DeepSeek</div>'
+'<div style="font-size:12px;font-weight:600;letter-spacing:.28em;margin-left:.28em;color:#1f2937;line-height:1.4;-webkit-font-smoothing:antialiased;text-shadow:none">HARNESS</div>'
+'<div style="display:flex;align-items:baseline;margin-top:12px;font-size:13px;color:#7d94ad;letter-spacing:.14em">Loading'
+'<span style="display:inline-flex;gap:4px;margin-left:3px">'
+'<i class="dsg-dot"></i><i class="dsg-dot"></i><i class="dsg-dot"></i>'
+'</span></div></div>';
var st=document.createElement('style');
st.textContent='@keyframes dsGlassBreathe{0%,100%{opacity:1}50%{opacity:.72}}'
+'@keyframes dsGlassDot{0%{opacity:0;transform:translateY(0)}18%{opacity:1;transform:translateY(-1px)}60%{opacity:1;transform:translateY(0)}100%{opacity:0}}'
+'.dsg-dot{width:4px;height:4px;border-radius:50%;background:#4a7ab5;opacity:0;animation:dsGlassDot 1.2s ease-in-out infinite}'
+'.dsg-dot:nth-child(1){animation-delay:0s}.dsg-dot:nth-child(2){animation-delay:.2s}.dsg-dot:nth-child(3){animation-delay:.4s}';
document.head.appendChild(st);
document.documentElement.appendChild(ov);
var statusEl=null;
function loaded(){return !document.querySelector('[class*="_boot_"]')&&(document.querySelector('[class*="_sidebarCol"],[class*="_frame"],[class*="_workspace"]')!==null);}
function failed(){return document.querySelector('[class*="_failed_"]')!==null;}
function removeCurtain(){if(!removed){removed=true;done=true;ov.remove();}}
function showFail(){
  if(removed)return;done=true;
  ov.style.background='transparent';
  ov.style.justifyContent='center';
  ov.style.pointerEvents='auto';
  ov.innerHTML='<div style="background:rgba(255,255,255,.97);border-radius:16px;box-shadow:0 10px 40px rgba(15,35,70,.22);padding:30px 40px;display:flex;flex-direction:column;align-items:center;gap:10px;min-width:280px;text-align:center">'+'<div style="font-size:16px;font-weight:600;color:#16324f">加载失败，请稍后重试</div>'+'<div style="font-size:12px;color:#7d94ad;line-height:1.6">未能进入工作区。请刷新重试，<br>或关闭后重新打开应用。</div>'+'<div style="display:flex;gap:10px;margin-top:10px">'+'<button id="ds-glass-retry" style="padding:8px 26px;border:none;border-radius:10px;background:#4a7ab5;color:#fff;font-size:13px;cursor:pointer">刷新重试</button>'+'<button id="ds-glass-close" style="padding:8px 20px;border:1px solid rgba(140,170,205,.55);border-radius:10px;background:#fff;color:#16324f;font-size:13px;cursor:pointer">关闭</button>'+'</div></div>';
  document.getElementById('ds-glass-retry').addEventListener('click',function(){location.reload();});
  document.getElementById('ds-glass-close').addEventListener('click',function(){window.close();});
}
var iv=setInterval(function(){
  if(done){clearInterval(iv);return;}
  var el=performance.now()-t0;
  if(failed()){clearInterval(iv);removeCurtain();return;}
  if(loaded()){
    if(el>=MIN_MS){clearInterval(iv);removeCurtain();}
  }else if(el>TIMEOUT_MS){clearInterval(iv);showFail();}
},120);
setTimeout(function(){if(!done&&!failed()&&loaded()){clearInterval(iv);removeCurtain();}},MIN_MS);
}catch(e){}})();</script>`;
  // 自定义无边框标题栏 + 渐变模糊层（frame: false 模式）
  const titlebar = `<div class="glass-titlebar-blur" id="glass-titlebar-blur"></div><div class="glass-titlebar" id="glass-titlebar">
    <button class="glass-titlebar__btn" data-action="minimize" title="最小化">
      <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" fill="currentColor"/></svg>
    </button>
    <button class="glass-titlebar__btn" data-action="maximize" title="最大化">
      <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" stroke="currentColor" stroke-width="1" fill="none"/></svg>
    </button>
    <button class="glass-titlebar__btn glass-titlebar__btn--close" data-action="close" title="关闭">
      <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
    </button>
  </div>`;
  return link + curtain + titlebar + style + script + degrade;
}

function inject(html, cfg) {
  const m = /<body(?:\s[^>]*)?>/i.exec(html);
  const frag = bootHtml(cfg);
  if (m === null) return html + frag;
  const at = m.index + m[0].length;
  return html.slice(0, at) + frag + html.slice(at);
}

function serveFile(res, file) {
  stat(file).then((s) => {
    if (!s.isFile()) { res.statusCode = 404; res.end('not found'); return; }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(file).pipe(res);
  }).catch(() => { res.statusCode = 404; res.end('not found'); });
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16384) return null; // 超限即弃
  }
  return body;
}

function makeHandler() {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean); // ['glass-assets', ...]
    const zone = parts[1];
    const rest = parts.slice(2);

    // 设置 API：仅本机回环服务可达
    if (zone === 'api' && rest[0] === 'config') {
      if (req.method === 'GET') {
        const cfg = await loadConfig();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(cfg));
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (body === null) { res.statusCode = 413; res.end(); return; }
        let patch;
        try { patch = JSON.parse(body); } catch { res.statusCode = 400; res.end('bad json'); return; }
        const merged = sanitize(patch);
        await saveConfig(merged);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(merged));
        return;
      }
      res.statusCode = 405; res.end(); return;
    }

    if (zone === 'bg' && rest.length === 1) {
      const file = path.normalize(path.join(ASSETS, rest[0]));
      if (!file.startsWith(ASSETS + path.sep)) { res.statusCode = 403; res.end(); return; }
      serveFile(res, file);
      return;
    }
    if (zone === 'local-bg' && rest.length === 1) {
      serveFile(res, rest[0]); // 已是绝对路径（encodeURIComponent 过），仅读不列目录
      return;
    }
    if (zone === 'glass.css') { serveFile(res, path.join(ASSETS, 'glass.css')); return; }
    res.statusCode = 404;
    res.end('not found');
  };
}

export function apply(ctx) {
  ctx.inject(['webServer'], (web) => {
    web.effect(async () => {
      const cfg = await loadConfig();
      const handler = makeHandler();
      const disposeTap = web.webServer.tapIndex((html) => inject(html, lastConfig || cfg));
      const disposeRoute = web.webServer.register({ kind: 'prefix', path: '/glass-assets', handler });
      return () => { disposeTap(); disposeRoute(); };
    }, 'dsh-glass-workspace: glass layer boot');
  });
}

export default { apply };
