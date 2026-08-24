/* dsh-glass-workspace 客户端主题层（官方 __ModuleLoader__ 工厂包格式）
 * 职责：
 *  1) 通过官方 theme 服务扩展点 overrideTokens 叠加玻璃拟态 token 层；
 *  2) 实时同步 --glass-* 变量与背景开关（保存设置后立即生效，无需刷新）；
 *  3) 在 Settings > 常规 注册「玻璃拟态工作区」设置卡片。
 * 不修改任何官方包文件；所有官方 API 调用均 try/catch 降级，失败不影响核心功能。
 */
window.__ModuleLoader__.load({
	id: "dsh-glass-workspace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var GLASS_ID = "dsh-glass-workspace";
		var API = "/glass-assets/api/config";

		var BG_PRESETS = [
			{ id: "bg-default.png", label: "默认 · 蓝色人鱼" },
			{ id: "bg-cloud.jpg", label: "云海 · 浅蓝" },
			{ id: "bg-sky.jpg", label: "蓝天 · 鲸跃" },
			{ id: "bg-star.jpg", label: "星空 · 骑鲸" }
		];

		/* 与 CSS 覆盖层一致的 token 调色板（官方 theme 扩展点） */
		/* v6: 大幅下调浅色 token 透明度, 消除顶部与整体偏白; 保持深色 token 不变 */
		var GLASS_TOKENS = {
			"--dsw-alias-bg-base": { light: "rgba(238,246,253,0.18)", dark: "rgba(16,26,40,0.66)" },
			"--dsw-alias-bg-layer-1": { light: "rgba(226,238,249,0.14)", dark: "rgba(20,30,46,0.70)" },
			"--dsw-alias-bg-layer-2": { light: "rgba(246,250,255,0.10)", dark: "rgba(28,40,58,0.62)" },
			"--dsw-alias-bg-layer-3": { light: "rgba(252,253,255,0.16)", dark: "rgba(36,50,70,0.78)" },
			"--dsw-alias-bg-overlay": { light: "rgba(255,255,255,0.08)", dark: "rgba(10,16,26,0.44)" },
			"--dsw-alias-border-l1": { light: "rgba(140,170,205,0.30)", dark: "rgba(90,120,160,0.30)" },
			"--dsw-alias-border-l2": { light: "rgba(140,170,205,0.42)", dark: "rgba(90,120,160,0.42)" },
			"--dsw-alias-border-l3": { light: "rgba(120,155,200,0.52)", dark: "rgba(100,130,170,0.52)" },
			"--dsw-alias-label-primary": { light: "rgba(22,50,79,0.96)", dark: "rgba(226,238,250,0.96)" },
			"--dsw-alias-label-secondary": { light: "rgba(61,90,122,0.92)", dark: "rgba(190,208,228,0.92)" },
			"--dsw-alias-label-tertiary": { light: "rgba(125,148,173,0.90)", dark: "rgba(150,170,195,0.90)" },
			"--dsw-alias-brand-primary": { light: "rgba(74,122,181,1)", dark: "rgba(122,166,220,1)" },
			"--dsw-alias-button-primary-fill": { light: "rgba(74,122,181,1)", dark: "rgba(96,144,201,1)" },
			"--dsw-alias-button-primary-hover": { light: "rgba(90,138,197,1)", dark: "rgba(112,160,217,1)" },
			"--dsw-alias-interactive-bg-hover": { light: "rgba(120,155,200,0.056)", dark: "rgba(120,155,200,0.22)" },
			"--dsw-alias-interactive-bg-active": { light: "rgba(120,155,200,0.24)", dark: "rgba(120,155,200,0.30)" },
			"--dsw-alias-tooltip-bg": { light: "rgba(24,52,82,0.88)", dark: "rgba(24,52,82,0.88)" },
			"--dsw-alias-toast-bg": { light: "rgba(24,52,82,0.88)", dark: "rgba(24,52,82,0.88)" },
			"--dsw-specific-sidebar-fill": { light: "rgba(233,242,250,0.72)", dark: "rgba(18,28,44,0.72)" }
		};

		/* ---------- 背景 URL 解析（与 node 侧 bootHtml 同规则） ---------- */
		function bgUrl(image) {
			if (!image) return "";
			if (/^(https?:)?\/\//.test(image) || image.indexOf("data:") === 0) return image;
			if (/^[A-Za-z]:[\\/]/.test(image) || image.indexOf("/") === 0) {
				return "/glass-assets/local-bg/" + encodeURIComponent(image);
			}
			var base = image.split(/[\\/]/).pop();
			return "/glass-assets/bg/" + encodeURIComponent(base);
		}

		/* ---------- 实时应用配置到页面 ---------- */
		function applyVars(cfg) {
			var b = cfg.background || {};
			var g = cfg.glass || {};
			var s = document.documentElement.style;
			s.setProperty("--glass-bg-image", 'url("' + bgUrl(b.image || "bg-default.png") + '")');
			s.setProperty("--glass-overlay", String(b.overlay != null ? b.overlay : 0.05));
			s.setProperty("--glass-bg-blur", (b.blur != null ? b.blur : 0) + "px");
			s.setProperty("--glass-blur", (g.blur != null ? g.blur : 14) + "px");
			s.setProperty("--glass-sidebar-alpha", String(g.sidebarAlpha != null ? g.sidebarAlpha : 0.72));
			s.setProperty("--glass-panel-alpha", String(g.panelAlpha != null ? g.panelAlpha : 0.62));
			s.setProperty("--glass-radius", (g.radius != null ? g.radius : 16) + "px");
			document.documentElement.setAttribute("data-glass-bg", b.enabled === false ? "off" : "on");
		}

		function loadConfig() {
			return fetch(API, { cache: "no-store" }).then(function (r) {
				if (!r.ok) throw new Error("config http " + r.status);
				return r.json();
			});
		}

		function saveConfig(cfg) {
			return fetch(API, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(cfg)
			}).then(function (r) {
				if (!r.ok) throw new Error("save http " + r.status);
				return r.json();
			});
		}

		/* ---------- 设置卡片（React 组件，注册到 settings.general.item 槽位） ---------- */
		function makeRow(React) {
			var h = React.createElement;
			var label = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", fontSize: "13px", color: "var(--dsw-alias-label-primary, #16324f)", padding: "4px 0" };
			var slider = { flex: 1, accentColor: "#4a7ab5" };
			var group = { display: "flex", flexDirection: "column", gap: "6px", padding: "10px 0", borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(140,170,205,0.3))" };
			var title = { fontSize: "14px", fontWeight: 600, color: "var(--dsw-alias-label-primary, #16324f)" };
			var desc = { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #7d94ad)", marginTop: "2px" };
			var btn = { marginTop: "10px", padding: "6px 18px", borderRadius: "10px", border: "none", cursor: "pointer", background: "#4a7ab5", color: "#fff", fontSize: "13px" };
			var select = { padding: "4px 8px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2, rgba(140,170,205,0.42))", background: "rgba(255,255,255,0.7)", color: "var(--dsw-alias-label-primary, #16324f)" };

			function GlassRow() {
				var st = React.useState(null);
				var cfg = st[0];
				var setCfg = st[1];
				var msg = React.useState("");
				var setMsg = msg[1];

				React.useEffect(function () {
					loadConfig().then(setCfg).catch(function () { /* 配置不可用时静默 */ });
				}, []);

				if (!cfg) return h("div", { style: group }, h("div", { style: title }, "玻璃拟态工作区"), h("div", { style: desc }, "加载中…"));

				var b = cfg.background || {};
				var g = cfg.glass || {};
				var isPreset = BG_PRESETS.some(function (p) { return p.id === b.image; });

				function patch(next) {
					var merged = Object.assign({}, cfg, next);
					setCfg(merged);
					applyVars(merged); /* 实时预览 */
					return merged;
				}

				return h("div", { style: group },
					h("div", { style: title }, "玻璃拟态工作区"),
					h("div", { style: desc }, "自定义背景图、透明度与毛玻璃强度；保存后写入本机配置文件，不上传任何数据。"),

					h("div", { style: group, borderBottom: "none", padding: "6px 0" },
						h("div", { style: label },
							h("span", null, "背景图"),
							h("select", {
								style: select,
								value: isPreset ? b.image : "__custom",
								onChange: function (e) {
									var v = e.target.value;
									if (v !== "__custom") patch({ background: Object.assign({}, b, { image: v }) });
								}
							},
								BG_PRESETS.map(function (p) { return h("option", { key: p.id, value: p.id }, p.label); }),
								h("option", { value: "__custom" }, "自定义…")
							)
						),
						h("div", { style: label },
							h("span", null, "自定义路径 / URL"),
							h("input", {
								style: Object.assign({}, select, { width: "260px" }),
								placeholder: "本机绝对路径或 http(s) 图片地址",
								defaultValue: isPreset ? "" : (b.image || ""),
								onBlur: function (e) { patch({ background: Object.assign({}, b, { image: e.target.value }) }); }
							})
						),
						h("div", { style: label },
							h("span", null, "启用背景"),
							h("input", { type: "checkbox", checked: b.enabled !== false, onChange: function (e) { patch({ background: Object.assign({}, b, { enabled: e.target.checked }) }); } })
						),
						h("div", { style: label },
							h("span", null, "遮罩强度 " + (b.overlay != null ? b.overlay : 0.05).toFixed(2)),
							h("input", { type: "range", min: 0, max: 0.8, step: 0.02, style: slider, value: b.overlay != null ? b.overlay : 0.05, onChange: function (e) { patch({ background: Object.assign({}, b, { overlay: Number(e.target.value) }) }); } })
						),
						h("div", { style: label },
							h("span", null, "背景模糊 " + (b.blur != null ? b.blur : 0) + "px"),
							h("input", { type: "range", min: 0, max: 12, step: 1, style: slider, value: b.blur != null ? b.blur : 0, onChange: function (e) { patch({ background: Object.assign({}, b, { blur: Number(e.target.value) }) }); } })
						),
						h("div", { style: label },
							h("span", null, "毛玻璃强度 " + (g.blur != null ? g.blur : 14) + "px"),
							h("input", { type: "range", min: 0, max: 30, step: 1, style: slider, value: g.blur != null ? g.blur : 14, onChange: function (e) { patch({ glass: Object.assign({}, g, { blur: Number(e.target.value) }) }); } })
						),
						h("div", { style: label },
							h("span", null, "侧栏透明度 " + (g.sidebarAlpha != null ? g.sidebarAlpha : 0.72).toFixed(2)),
							h("input", { type: "range", min: 0.3, max: 0.95, step: 0.01, style: slider, value: g.sidebarAlpha != null ? g.sidebarAlpha : 0.72, onChange: function (e) { patch({ glass: Object.assign({}, g, { sidebarAlpha: Number(e.target.value) }) }); } })
						),
						h("div", { style: label },
							h("span", null, "圆角 " + (g.radius != null ? g.radius : 16) + "px"),
							h("input", { type: "range", min: 0, max: 28, step: 1, style: slider, value: g.radius != null ? g.radius : 16, onChange: function (e) { patch({ glass: Object.assign({}, g, { radius: Number(e.target.value) }) }); } })
						),
						h("div", null,
							h("button", {
								style: btn,
								onClick: function () {
									saveConfig(cfg).then(function () { setMsg("已保存到本机配置"); }).catch(function () { setMsg("保存失败，请重试"); });
								}
							}, "保存设置"),
							h("span", { style: { marginLeft: "10px", fontSize: "12px", color: "var(--dsw-alias-label-secondary, #3d5a7a)" } }, msg[0])
						)
					)
				);
			}
			return GlassRow;
		}

		/* ---------- 窗口控制与沉浸式交互 ---------- */
		function initWindowControls() {
			var titlebar = document.getElementById("glass-titlebar");
			if (!titlebar) return;

			// 窗口控制按钮事件
			titlebar.addEventListener("click", function (e) {
				var btn = e.target.closest("[data-action]");
				if (!btn || !window.electronAPI) return;
				var action = btn.getAttribute("data-action");
				if (action === "minimize" && window.electronAPI.windowMinimize) {
					window.electronAPI.windowMinimize();
				}
				if (action === "maximize" && window.electronAPI.windowMaximize) {
					window.electronAPI.windowMaximize();
				}
				if (action === "close" && window.electronAPI.windowClose) {
					window.electronAPI.windowClose();
				}
			});

			// 双击全屏（排除按钮、输入框、链接、可编辑区域）
			var lastDblClick = 0;
			document.addEventListener("dblclick", function (e) {
				// 防止重复触发
				var now = Date.now();
				if (now - lastDblClick < 500) return;
				lastDblClick = now;

				var tag = e.target.tagName;
				if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "A") return;
				if (e.target.closest("button, input, textarea, select, a, [contenteditable], [role='button'], [role='menu'], [role='dialog']")) return;
				if (e.target.closest("[class*='_card']")) return;
				if (e.target.closest("[class*='_sidebar']")) return;
				if (e.target.closest("[class*='_titlebar']")) return;
				if (window.electronAPI && window.electronAPI.windowToggleFullscreen) {
					window.electronAPI.windowToggleFullscreen();
				}
			});

			// ESC 键退出全屏
			document.addEventListener("keydown", function (e) {
				if (e.key === "Escape" && document.documentElement.getAttribute("data-glass-immersive") === "on") {
					if (window.electronAPI && window.electronAPI.windowToggleFullscreen) {
						window.electronAPI.windowToggleFullscreen();
					}
				}
			});

			// 全屏状态变化
			if (window.electronAPI && window.electronAPI.onFullscreenChanged) {
				window.electronAPI.onFullscreenChanged(function (isFullscreen) {
					document.documentElement.setAttribute("data-glass-immersive", isFullscreen ? "on" : "off");
				});
			}

			// 自动隐藏标题栏：鼠标靠近顶部时轻微显现
			var hideTimer = null;
			document.addEventListener("mousemove", function (e) {
				if (document.documentElement.getAttribute("data-glass-immersive") === "on") return;
				if (e.clientY < 40) {
					titlebar.classList.add("glass-titlebar--hover");
					clearTimeout(hideTimer);
				} else {
					clearTimeout(hideTimer);
					hideTimer = setTimeout(function () {
						titlebar.classList.remove("glass-titlebar--hover");
					}, 300);
				}
			});
		}

		/* ---------- 客户端插件入口 ---------- */
		function apply(ctx) {
			/* 1) token 覆盖层（官方扩展点） */
			try {
				if (ctx.theme && typeof ctx.theme.overrideTokens === "function") {
					ctx.effect(function () {
						return ctx.theme.overrideTokens(GLASS_ID, GLASS_TOKENS);
					}, "dsh-glass-workspace: glass token overlay");
				}
			} catch (e) { /* 主题服务不可用时由 CSS 层兜底 */ }

			/* 2) 启动时同步一次变量（host 注入的 boot 值已存在，这里确保热更新一致） */
			try {
				loadConfig().then(applyVars).catch(function () { /* 静默 */ });
			} catch (e) { /* 静默 */ }

			/* 3) 设置卡片（React / slots 任一不可用时降级跳过） */
			try {
				var React = require("react");
				if (ctx.slots && typeof ctx.slots.register === "function") {
					ctx.effect(function () {
						return ctx.slots.register({
							name: "settings.general.item",
							id: "glass-workspace",
							order: 15
						}, makeRow(React));
					}, "dsh-glass-workspace: settings row");
				}
			} catch (e) { /* 无 react / slots 种子时跳过卡片，不阻塞 */ }

			/* 4) 窗口控制与沉浸式交互 */
			try {
				if (document.readyState === "loading") {
					document.addEventListener("DOMContentLoaded", initWindowControls);
				} else {
					initWindowControls();
				}
			} catch (e) { /* 静默 */ }
		}

		exports.apply = apply;
		return module.exports;
	}
});
