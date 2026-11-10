window.__ModuleLoader__.load({
	id: "dsh-agent-desk",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const h = React.createElement;

		const PANEL_ID = "agent-desk";
		const PANEL_LABEL = "智能体";
		const STORAGE_KEY = "dsh-agent-desk:expanded";
		const BUILTIN_PRESETS = ["standard", "minimal", "ptc", "cordis"];
		const FLAT_NOTE = "当前宿主未暴露会话所属预设，暂按会话平铺";
		/** 主区只列最近 7 天有更新的任务；改这里即可调整窗口。 */
		const TASK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

		//#region 纯函数：状态、归属、排序、分组
		/** 四态判定：等待确认优先于运行中。 */
		function statusOf(session) {
			if (!session || typeof session !== "object") return "idle";
			if (session.pendingInteraction) return "waiting";
			if (session.running) return "running";
			if (session.error) return "error";
			return "idle";
		}
		const STATUS_TEXT = { running: "运行中", waiting: "等待确认", error: "出错", idle: "空闲" };
		const STATUS_COLOR = { running: "#4c9aff", waiting: "#e5a13a", error: "#e5484d", idle: "#8b8f98" };
		const STATUS_ORDER = { waiting: 0, running: 1, error: 2, idle: 3 };

		/** 统计一组会话的四态数量；坏数据跳过。 */
		function countStatuses(items) {
			const counts = { running: 0, waiting: 0, error: 0, idle: 0, total: 0 };
			if (!Array.isArray(items)) return counts;
			for (const session of items) {
				if (!session || typeof session !== "object") continue;
				counts.total += 1;
				const status = statusOf(session);
				if (counts[status] === undefined) counts.idle += 1;
				else counts[status] += 1;
			}
			return counts;
		}

		/**
		 * 读会话的预设归属。0.2.2 的实际字段在 projectionValues.agentPreset；
		 * 同时兼容顶层 agentPreset，其他形态一律返回空串。
		 */
		function presetIdOf(session) {
			if (!session || typeof session !== "object") return "";
			const projection = session.projectionValues;
			const candidates = [
				projection && typeof projection === "object" ? projection.agentPreset : undefined,
				session.agentPreset,
			];
			for (const value of candidates) {
				if (typeof value === "string" && value.trim() !== "") return value.trim();
			}
			return "";
		}

		/** 会话自带的预设显示名（若有）；没有就交给 roster。 */
		function sessionPresetNameOf(session) {
			if (!session || typeof session !== "object") return "";
			const projection = session.projectionValues;
			const candidates = [
				session.agentPresetName,
				projection && typeof projection === "object" ? projection.agentPresetName : undefined,
			];
			for (const value of candidates) {
				if (typeof value === "string" && value.trim() !== "") return value.trim();
			}
			return "";
		}

		function isBuiltinPreset(id) {
			return typeof id === "string" && BUILTIN_PRESETS.indexOf(id) !== -1;
		}

		/** 会话 id；客户端行用 id，API 摘要也可能给 sessionId。 */
		function sessionIdOf(session) {
			if (!session || typeof session !== "object") return "";
			for (const value of [session.id, session.sessionId]) {
				if (typeof value === "string" && value.trim() !== "") return value.trim();
			}
			return "";
		}

		/** 直接父会话 id：摘要 parentSessionId / 旧字段 parentSession / subagent.address。 */
		function parentIdOf(session) {
			if (!session || typeof session !== "object") return "";
			const address = session.subagent && typeof session.subagent === "object" ? session.subagent.address : undefined;
			const projection = session.projectionValues;
			const candidates = [
				session.parentSessionId,
				session.parentSession,
				address && typeof address === "object" ? address.parentSessionId : undefined,
				projection && typeof projection === "object" ? projection.parentSessionId : undefined,
			];
			for (const value of candidates) {
				if (typeof value === "string" && value.trim() !== "") return value.trim();
			}
			return "";
		}

		/** 子智能体会话：origin 标记或存在父会话 id。 */
		function isSubagentSession(session) {
			return !!session && typeof session === "object" && (session.origin === "subagent" || parentIdOf(session) !== "");
		}

		/** 普通空白会话不列；子智能体会话即使还没写入内容也要列。 */
		function isListableSession(session) {
			return !!session && typeof session === "object" && (isSubagentSession(session) || !session.blank);
		}

		/** 把 sessions store 的 subagentsByParent 目录摊平成 childId -> {parentId, mode, label}。 */
		function catalogIndex(catalogs) {
			const byChild = new Map();
			if (!catalogs || typeof catalogs !== "object") return byChild;
			for (const [parentSessionId, snapshot] of Object.entries(catalogs)) {
				const entries = snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : [];
				for (const entry of entries) {
					if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
					byChild.set(entry.id, {
						parentSessionId,
						mode: typeof entry.mode === "string" ? entry.mode : "unknown",
						label: typeof entry.label === "string" ? entry.label : "",
					});
				}
			}
			return byChild;
		}

		/** 子会话的 mode：目录优先，其次 open snapshot 里的 address，最后 unknown。 */
		function modeOfChild(session, byChild) {
			const id = sessionIdOf(session);
			const entry = byChild.get(id);
			if (entry && typeof entry.mode === "string" && entry.mode !== "") return entry.mode;
			const address = session && session.subagent && typeof session.subagent === "object" ? session.subagent.address : undefined;
			if (address && typeof address === "object" && typeof address.mode === "string" && address.mode !== "") return address.mode;
			return "unknown";
		}

		/**
		 * 决定任务归到哪个自定义预设。
		 * 自己的 preset 是自定义 → 用它；是内置或缺失 → 沿父链找最近的自定义预设，
		 * 并记录 inherited（自己没有）或 adopted（自己有内置但为了可见性归到父预设）。
		 */
		function resolveGroupPreset(session, allById) {
			const own = presetIdOf(session);
			if (own !== "" && !isBuiltinPreset(own)) {
				return { id: own, inherited: false, adopted: false, own: "" };
			}
			let parent = parentIdOf(session);
			let guard = 0;
			while (parent !== "" && guard < 16) {
				const parentSession = allById.get(parent);
				if (parentSession === undefined) break;
				const parentPreset = presetIdOf(parentSession);
				if (parentPreset !== "" && !isBuiltinPreset(parentPreset)) {
					return { id: parentPreset, inherited: own === "", adopted: own !== "", own };
				}
				parent = parentIdOf(parentSession);
				guard += 1;
			}
			return { id: "", inherited: own === "", adopted: false, own };
		}

		/** parentId -> 直接子会话（仅最近集合，用于“含 N 个子任务”）。 */
		function indexChildren(sessions) {
			const map = new Map();
			for (const session of sessions) {
				const parent = parentIdOf(session);
				if (parent === "") continue;
				if (!map.has(parent)) map.set(parent, []);
				map.get(parent).push(session);
			}
			return map;
		}

		/**
		 * 把一组会话组织成可渲染的树：同组父任务下挂子任务；
		 * 父任务不在本组但在最近集合里，就生成一条不计数量的“父”上下文行。
		 */
		function buildForest(sessions, options) {
			const allById = options.allById;
			const recentById = options.recentById;
			const childrenByParent = options.childrenByParent;
			const inheritedIds = options.inheritedIds || new Set();
			const adoptedById = options.adoptedById || new Map();
			const byChild = options.byChild || new Map();
			const nodes = new Map();
			for (const session of sessions) {
				const id = sessionIdOf(session);
				if (id === "") continue;
				const child = parentIdOf(session) !== "";
				nodes.set(id, {
					id,
					session,
					child,
					context: false,
					inheritedPreset: inheritedIds.has(id),
					adoptedPreset: adoptedById.get(id) || "",
					mode: child ? modeOfChild(session, byChild) : "",
					label: (byChild.get(id)?.label || "").trim(),
					childCount: (childrenByParent.get(id) || []).length,
					children: [],
					depth: 0,
				});
			}
			const roots = [];
			const contexts = new Map();
			for (const node of nodes.values()) {
				const parent = parentIdOf(node.session);
				if (parent === "" || parent === node.id) {
					roots.push(node);
					continue;
				}
				const parentNode = nodes.get(parent);
				if (parentNode !== undefined) {
					parentNode.children.push(node);
					continue;
				}
				const parentSession = recentById.get(parent);
				if (parentSession === undefined) {
					// 父会话已不在 7 天窗口或不可见：子任务仍以“子”行出现，但无嵌套。
					node.child = true;
					roots.push(node);
					continue;
				}
				let context = contexts.get(parent);
				if (context === undefined) {
					context = {
						id: parent,
						session: parentSession,
						child: false,
						context: true,
						inheritedPreset: false,
						adoptedPreset: "",
						mode: "",
						label: "",
						childCount: (childrenByParent.get(parent) || []).length,
						children: [],
						depth: 0,
					};
					contexts.set(parent, context);
					roots.push(context);
				}
				context.children.push(node);
			}
			const seen = new Set();
			const apply = (list, depth) => {
				list.sort((a, b) => {
					const rank = (STATUS_ORDER[statusOf(a.session)] ?? 3) - (STATUS_ORDER[statusOf(b.session)] ?? 3);
					if (rank !== 0) return rank;
					const delta = timeOf(b.session) - timeOf(a.session);
					if (delta !== 0) return delta;
					return String(a.session.title || a.session.displayTitle || a.id).localeCompare(String(b.session.title || b.session.displayTitle || b.id));
				});
				for (const node of list) {
					if (seen.has(node.id)) {
						node.children = [];
						continue;
					}
					seen.add(node.id);
					node.depth = depth;
					apply(node.children, depth + 1);
				}
			};
			apply(roots, 0);
			return roots;
		}

		function timeOf(session) {
			const value = session && session.updatedAt;
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value === "string") {
				const parsed = Date.parse(value);
				if (Number.isFinite(parsed)) return parsed;
			}
			return 0;
		}

		/** updatedAt 是否落在最近 7 天内；缺失或非法时间视为过期。 */
		function isRecentTask(session, now) {
			const stamp = timeOf(session);
			const base = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
			return stamp > 0 && base - stamp <= TASK_WINDOW_MS;
		}

		/** 排序：等待确认 → 运行中 → 出错 → 空闲；同状态按更新时间倒序。 */
		function sortSessions(sessions) {
			const items = (Array.isArray(sessions) ? sessions : []).filter((s) => s && typeof s === "object");
			return items.slice().sort((a, b) => {
				const rank = (STATUS_ORDER[statusOf(a)] ?? 3) - (STATUS_ORDER[statusOf(b)] ?? 3);
				if (rank !== 0) return rank;
				const delta = timeOf(b) - timeOf(a);
				if (delta !== 0) return delta;
				const left = String(a.title || a.id || "");
				const right = String(b.title || b.id || "");
				return left.localeCompare(right);
			});
		}

		/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期。 */
		function relativeTime(value, now) {
			const stamp = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
			if (!Number.isFinite(stamp) || stamp <= 0) return "";
			const base = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
			const delta = Math.max(0, base - stamp);
			const minute = 60 * 1000;
			const hour = 60 * minute;
			const day = 24 * hour;
			if (delta < minute) return "刚刚";
			if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
			if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
			if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
			const date = new Date(stamp);
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const dayOfMonth = String(date.getDate()).padStart(2, "0");
			return `${date.getFullYear()}-${month}-${dayOfMonth}`;
		}

		/** 把 remote.agentPresets.list() 的结果规整成预设数组；失败返回空数组。 */
		function normalizeRoster(result) {
			if (!result || result.ok !== true || !result.value || !Array.isArray(result.value.presets)) return [];
			return result.value.presets.filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.trim() !== "");
		}

		/**
		 * 页面数据模型。
		 * 先纳入子智能体会话并按 7 天窗口过滤；有归属 → 按自定义预设分组；完全没有 → 平铺并提示。
		 * @param {Array<object>} sessions
		 * @param {Array<object>} roster
		 * @param {number} [now] 便于测试的当前时间
		 * @param {object} [catalogs] sessions store 的 subagentsByParent 目录
		 */
		function buildViewModel(sessions, roster, now, catalogs) {
			const byChild = catalogIndex(catalogs);
			// 客户端摘要可能没带 parentSessionId；用父目录补出归属，避免子会话被当成普通行。
			const items = (Array.isArray(sessions) ? sessions : [])
				.filter((s) => s && typeof s === "object")
				.map((session) => {
					const entry = byChild.get(sessionIdOf(session));
					if (entry === undefined || entry.parentSessionId === "" || parentIdOf(session) !== "" || session.origin === "subagent") return session;
					return { ...session, parentSessionId: entry.parentSessionId, origin: "subagent" };
				});
			const allById = new Map();
			for (const session of items) {
				const id = sessionIdOf(session);
				if (id !== "") allById.set(id, session);
			}
			const listable = items.filter(isListableSession);
			if (listable.length === 0) {
				return { mode: "empty", groups: [], sessions: [], trees: [], note: "", builtinCount: 0, unattributed: 0, total: 0 };
			}
			const base = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
			const recent = listable.filter((s) => isRecentTask(s, base));
			const recentById = new Map();
			for (const session of recent) {
				const id = sessionIdOf(session);
				if (id !== "") recentById.set(id, session);
			}
			const childrenByParent = indexChildren(recent);
			const forestOptions = {
				allById,
				recentById,
				childrenByParent,
				byChild,
			};
			// 归属字段在任何一条原始会话上都不存在，才走平铺降级。
			if (!items.some((s) => presetIdOf(s) !== "")) {
				return {
					mode: "flat",
					groups: [],
					sessions: sortSessions(recent),
					trees: buildForest(recent, forestOptions),
					note: FLAT_NOTE,
					builtinCount: 0,
					unattributed: recent.length,
					total: recent.length,
				};
			}
			const rosterById = new Map();
			for (const entry of Array.isArray(roster) ? roster : []) {
				if (entry && typeof entry === "object" && typeof entry.id === "string") rosterById.set(entry.id, entry);
			}
			const map = new Map();
			let builtinCount = 0;
			let unattributed = 0;
			const inheritedIds = new Set();
			const adoptedById = new Map();
			// 先放预设名单里的自定义智能体：没有任务的也要占一行，展开后显示 0。
			for (const entry of rosterById.values()) {
				const id = String(entry.id).trim();
				if (id === "" || isBuiltinPreset(id)) continue;
				const name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name.trim() : id;
				map.set(id, {
					id,
					name,
					broken: typeof entry.broken === "string" ? entry.broken.trim() : "",
					order: Number.isFinite(entry.order) ? entry.order : Number.MAX_SAFE_INTEGER,
					sessions: [],
					trees: [],
				});
			}
			for (const session of recent) {
				const effective = resolveGroupPreset(session, allById);
				if (effective.id === "") {
					if (isBuiltinPreset(effective.own)) builtinCount += 1;
					else unattributed += 1;
					continue;
				}
				if (!map.has(effective.id)) {
					const meta = rosterById.get(effective.id);
					const rosterName = meta && typeof meta.name === "string" && meta.name.trim() !== "" ? meta.name.trim() : "";
					map.set(effective.id, {
						id: effective.id,
						name: sessionPresetNameOf(session) || rosterName || effective.id,
						broken: meta && typeof meta.broken === "string" ? meta.broken.trim() : "",
						order: meta && Number.isFinite(meta.order) ? meta.order : Number.MAX_SAFE_INTEGER,
						sessions: [],
						trees: [],
					});
				}
				const group = map.get(effective.id);
				if (!sessionPresetNameOf(session) && group.name === effective.id) {
					const meta = rosterById.get(effective.id);
					if (meta && typeof meta.name === "string" && meta.name.trim() !== "") group.name = meta.name.trim();
				}
				group.sessions.push(session);
				const sessionId = sessionIdOf(session);
				if (effective.inherited && sessionId !== "") inheritedIds.add(sessionId);
				if (effective.adopted && sessionId !== "") adoptedById.set(sessionId, effective.own);
			}
			const groups = Array.from(map.values()).sort((a, b) => {
				if (a.order !== b.order) return a.order - b.order;
				if (a.name !== b.name) return a.name.localeCompare(b.name);
				return a.id.localeCompare(b.id);
			});
			let total = 0;
			for (const group of groups) {
				group.sessions = sortSessions(group.sessions);
				group.counts = countStatuses(group.sessions);
				group.trees = buildForest(group.sessions, {
					...forestOptions,
					inheritedIds,
					adoptedById,
				});
				total += group.counts.total;
			}
			return {
				mode: "grouped",
				groups,
				sessions: [],
				trees: [],
				note: "",
				builtinCount,
				unattributed,
				total,
			};
		}

		function parseExpanded(raw) {
			try {
				const value = JSON.parse(raw);
				return value && typeof value === "object" && !Array.isArray(value) ? value : {};
			} catch {
				return {};
			}
		}

		function toggleExpansion(current, id) {
			const next = { ...(current && typeof current === "object" ? current : {}) };
			if (next[id] === true) delete next[id];
			else next[id] = true;
			return next;
		}

		function readExpanded() {
			try {
				if (typeof localStorage === "undefined") return {};
				return parseExpanded(localStorage.getItem(STORAGE_KEY));
			} catch {
				return {};
			}
		}

		function writeExpanded(value) {
			try {
				if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
			} catch {
				// 存不了就只保留当前会话内的展开状态。
			}
		}
		//#endregion

		const styles = {
			page: { height: "100%", overflow: "auto", boxSizing: "border-box", padding: "28px 32px 40px" },
			shell: { maxWidth: 880, margin: "0 auto", color: "var(--dsw-alias-label-primary, #e8e8ea)" },
			topbar: { display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 6 },
			heading: { flex: 1, minWidth: 0 },
			title: { fontSize: 20, fontWeight: 600, lineHeight: 1.25 },
			subtitle: { fontSize: 12, opacity: 0.62, marginTop: 4 },
			back: {
				flex: "0 0 auto", padding: "6px 12px", borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.16)", background: "transparent",
				color: "inherit", cursor: "pointer", fontSize: 12,
			},
			note: { fontSize: 12, opacity: 0.62, margin: "10px 0 14px" },
			hint: { fontSize: 12, opacity: 0.55, margin: "0 0 14px" },
			group: {
				border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
				marginBottom: 10, overflow: "hidden",
				background: "var(--dsw-alias-bg-elevated, rgba(255,255,255,0.03))",
			},
			groupHead: {
				display: "flex", alignItems: "center", gap: 10, width: "100%",
				padding: "11px 13px", border: "none", background: "transparent",
				color: "inherit", cursor: "pointer", textAlign: "left", fontSize: 13,
			},
			chevron: { width: 14, flex: "0 0 auto", opacity: 0.65, fontSize: 11 },
			groupName: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			broken: { fontSize: 11, color: "#e5a13a", flex: "0 0 auto" },
			spacer: { flex: 1 },
			badge: {
				flex: "0 0 auto", fontSize: 11, padding: "1px 7px", borderRadius: 999,
				background: "rgba(255,255,255,0.07)", opacity: 0.85,
			},
			childBadge: {
				flex: "0 0 auto", fontSize: 10, padding: "0 5px", borderRadius: 4,
				border: "1px solid rgba(255,255,255,0.18)", opacity: 0.7,
			},
			presetBadge: {
				flex: "0 0 auto", fontSize: 10, padding: "0 5px", borderRadius: 4,
				background: "rgba(255,255,255,0.06)", opacity: 0.6,
			},
			childCount: { flex: "0 0 auto", fontSize: 10, opacity: 0.5 },
			count: { flex: "0 0 auto", fontSize: 11, opacity: 0.55 },
			task: {
				display: "flex", alignItems: "center", gap: 9,
				padding: "9px 13px", borderTop: "1px solid rgba(255,255,255,0.07)",
				cursor: "pointer", fontSize: 13,
			},
			dot: { width: 8, height: 8, borderRadius: 4, flex: "0 0 auto" },
			taskTitle: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
			taskTime: { flex: "0 0 auto", fontSize: 11, opacity: 0.5 },
			empty: { padding: "40px 16px", textAlign: "center", fontSize: 13, opacity: 0.6 },
			emptyTask: { padding: "12px 13px", borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 12, opacity: 0.55 },
		};

		/** 侧栏入口图标（渲染在 16px leading cell 内）。 */
		function AgentDeskIcon(props) {
			const size = props && typeof props.size === "number" && props.size > 0 ? props.size : 16;
			return h("svg", {
				width: size, height: size, viewBox: "0 0 16 16", fill: "none",
				stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round",
				"aria-hidden": "true", style: { display: "block" },
			},
				h("circle", { cx: 6, cy: 5, r: 2.1 }),
				h("path", { d: "M2.4 13.1c0-2.2 1.8-3.8 3.6-3.8s3.6 1.6 3.6 3.8" }),
				h("circle", { cx: 12.2, cy: 4.4, r: 1.5 }),
				h("path", { d: "M10.6 7.2c1.6.2 2.7 1.4 2.7 3" })
			);
		}

		function useNow(intervalMs) {
			const [now, setNow] = React.useState(() => Date.now());
			React.useEffect(() => {
				const timer = setInterval(() => setNow(Date.now()), intervalMs);
				return () => clearInterval(timer);
			}, [intervalMs]);
			return now;
		}

		function useRoster(props) {
			const [roster, setRoster] = React.useState([]);
			React.useEffect(() => {
				let alive = true;
				const load = typeof props.loadAgentPresets === "function"
					? props.loadAgentPresets
					: () => Promise.resolve([]);
				Promise.resolve()
					.then(load)
					.then((rows) => { if (alive) setRoster(Array.isArray(rows) ? rows : []); })
					.catch((error) => {
						console.warn("[dsh-agent-desk] 读取预设名单失败，名称降级为 id", error);
						if (alive) setRoster([]);
					});
				return () => { alive = false; };
			}, []);
			return roster;
		}

		/**
		 * 任务行标题：目录 label > 会话自己的 title > 子任务短 id。
		 * 父标题绝不混进子标题；label 为空时静默降级。
		 */
		function taskTitleOf(node) {
			if (!node || typeof node !== "object") return "未命名会话";
			const label = typeof node.label === "string" ? node.label.trim() : "";
			if (label !== "") return label;
			const session = node.session && typeof node.session === "object" ? node.session : {};
			for (const value of [session.title, session.displayTitle]) {
				if (typeof value === "string" && value.trim() !== "") return value.trim();
			}
			const id = typeof node.id === "string" && node.id !== "" ? node.id : sessionIdOf(session);
			if (id === "") return node.child ? "子任务" : "未命名会话";
			return node.child ? `子任务 ${id.slice(0, 8)}` : id;
		}

		function TaskRow({ node, now, onOpen }) {
			const session = node.session;
			const status = statusOf(session);
			const title = taskTitleOf(node);
			const markers = [];
			if (node.context) markers.push("父");
			else if (node.child) markers.push("子");
			if (node.inheritedPreset) markers.push("继承预设");
			if (node.adoptedPreset !== "") markers.push(`内置 ${node.adoptedPreset}`);
			return h("div", {
				role: "button",
				tabIndex: 0,
				style: {
					...styles.task,
					paddingLeft: 13 + Math.max(0, node.depth) * 18,
					opacity: node.context ? 0.67 : 1,
				},
				title: title,
				onClick: () => onOpen(node),
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onOpen(node);
					}
				},
				onMouseEnter: (event) => { event.currentTarget.style.background = "rgba(255,255,255,0.045)"; },
				onMouseLeave: (event) => { event.currentTarget.style.background = "transparent"; },
			},
				h("span", { style: { ...styles.dot, background: STATUS_COLOR[status] } }),
				markers.map((marker) => h("span", {
					key: marker,
					style: marker === "子" || marker === "父" ? styles.childBadge : styles.presetBadge,
				}, marker)),
				h("span", { style: styles.taskTitle }, title),
				node.childCount > 0 ? h("span", { style: styles.childCount }, `含 ${node.childCount} 个子任务`) : null,
				h("span", { style: styles.taskTime }, relativeTime(session.updatedAt, now)),
				h("span", { style: { fontSize: 11, opacity: 0.55, flex: "0 0 auto" } }, STATUS_TEXT[status])
			);
		}

		/** 把树按前序摊平成行；子任务缩进由 node.depth 决定。 */
		function renderTaskRows(nodes, now, onOpen) {
			const rows = [];
			for (const node of Array.isArray(nodes) ? nodes : []) {
				rows.push(h(TaskRow, { key: node.id, node, now, onOpen }));
				if (node.children.length > 0) rows.push(...renderTaskRows(node.children, now, onOpen));
			}
			return rows;
		}

		function GroupBlock({ group, expanded, now, onToggle, onOpen }) {
			const counts = group.counts || countStatuses(group.sessions);
			return h("div", { style: styles.group },
				h("button", {
					type: "button",
					style: styles.groupHead,
					"aria-expanded": expanded === true,
					onClick: () => onToggle(group.id),
				},
					h("span", { style: styles.chevron }, expanded === true ? "▾" : "▸"),
					h("span", { style: styles.groupName }, group.name || group.id),
					group.broken !== "" ? h("span", { style: styles.broken, title: group.broken }, "不可用") : null,
					h("span", { style: styles.spacer }),
					h("span", { style: styles.badge }, `运行 ${counts.running}`),
					h("span", { style: styles.badge }, `等待 ${counts.waiting}`),
					counts.error > 0 ? h("span", { style: styles.badge }, `出错 ${counts.error}`) : null,
					h("span", { style: styles.count }, `${counts.total} 个任务`)
				),
				expanded === true
					? group.sessions.length === 0
						? h("div", { style: styles.emptyTask }, "这个智能体还没有任务。")
						: renderTaskRows(group.trees, now, onOpen)
					: null
			);
		}

		const selectAllSessions = (state) => state;
		const EMPTY_SESSIONS = [];
		function useEmptySessions() { return EMPTY_SESSIONS; }

		/** 把 sessions store 快照（{ ids, byId }）或旧的数组形态统一成数组。 */
		function sessionsFromSnapshot(snapshot) {
			if (Array.isArray(snapshot)) return snapshot;
			if (!snapshot || typeof snapshot !== "object") return [];
			if (!Array.isArray(snapshot.ids) || !snapshot.byId || typeof snapshot.byId !== "object") return [];
			return snapshot.ids.map((id) => snapshot.byId[id]).filter(Boolean);
		}

		/**
		 * 同时取出会话行与 subagentsByParent 目录。
		 * 目录里的子会话即使不在 ids 里，也从 byId 补进来；旧数组形态没有目录。
		 */
		function snapshotParts(snapshot) {
			const catalogs = snapshot && typeof snapshot === "object" && snapshot.subagentsByParent && typeof snapshot.subagentsByParent === "object"
				? snapshot.subagentsByParent
				: {};
			const sessions = sessionsFromSnapshot(snapshot);
			const byId = snapshot && typeof snapshot === "object" && snapshot.byId && typeof snapshot.byId === "object" ? snapshot.byId : undefined;
			if (byId !== undefined) {
				const seen = new Set(sessions.map(sessionIdOf));
				for (const catalog of Object.values(catalogs)) {
					const entries = catalog && Array.isArray(catalog.entries) ? catalog.entries : [];
					for (const entry of entries) {
						if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
						const row = byId[entry.id];
						if (row && typeof row === "object") {
							sessions.push(row);
							seen.add(entry.id);
						}
					}
				}
			}
			return { sessions, catalogs };
		}

		function AgentDeskPage(props) {
			const useSessionsHook = typeof props.useSessions === "function" ? props.useSessions : useEmptySessions;
			let parts = { sessions: [], catalogs: {} };
			try {
				parts = snapshotParts(useSessionsHook(selectAllSessions));
			} catch (error) {
				console.warn("[dsh-agent-desk] 读取会话列表失败", error);
				parts = { sessions: [], catalogs: {} };
			}
			const now = useNow(60 * 1000);
			const roster = useRoster(props);
			const model = buildViewModel(parts.sessions, roster, undefined, parts.catalogs);
			const [expanded, setExpanded] = React.useState(readExpanded);

			/**
			 * 父任务/普通任务传会话 id；子任务传精确的
			 * { parentSessionId, childSessionId, mode } 地址，交给 uiWorkspace.openSession。
			 */
			const openTask = (node) => {
				if (!node) return;
				let target = node.id;
				if (!node.context && node.child) {
					const parent = parentIdOf(node.session);
					if (parent !== "") {
						const mode = node.mode === "one-shot" || node.mode === "continuable" ? node.mode : "unknown";
						target = {
							parentSessionId: parent,
							childSessionId: node.id,
							mode,
						};
					}
				}
				if (!target) return;
				try {
					// uiWorkspace.openSession 自己会选中会话并切回对话；这里不要再重置面板，
					// 否则导航失败时会退回 mainView 里的旧会话。
					if (typeof props.openSession === "function") props.openSession(target);
				} catch (error) {
					console.warn("[dsh-agent-desk] 打开会话失败", error);
				}
			};
			const toggleGroup = (id) => {
				setExpanded((previous) => {
					const next = toggleExpansion(previous, id);
					writeExpanded(next);
					return next;
				});
			};
			const goBack = () => {
				try {
					if (typeof props.closePanel === "function") props.closePanel();
				} catch (error) {
					console.warn("[dsh-agent-desk] 返回对话失败", error);
				}
			};

			const subtitle = model.mode === "grouped"
				? `${model.groups.length} 个智能体 · ${model.total} 个任务（最近 7 天）`
				: `${model.sessions.length} 个会话（最近 7 天）`;

			return h("div", { style: styles.page },
				h("div", { style: styles.shell },
					h("div", { style: styles.topbar },
						h("div", { style: styles.heading },
							h("div", { style: styles.title }, PANEL_LABEL),
							h("div", { style: styles.subtitle }, subtitle)
						),
						h("button", { type: "button", style: styles.back, onClick: goBack }, "返回对话")
					),
					model.mode === "flat" ? h("div", { style: styles.note }, model.note) : null,
					model.mode === "grouped"
						? h("div", { style: styles.hint },
							"只显示最近 7 天有更新的任务；只列用户自定义预设，内置 standard / minimal / ptc / cordis 已隐藏。"
							+ (model.builtinCount > 0 ? `（已隐藏 ${model.builtinCount} 个内置预设会话）` : "")
							+ (model.unattributed > 0 ? `（另有 ${model.unattributed} 个会话未记录预设，未纳入）` : "")
						)
						: null,
					model.mode === "empty"
						? h("div", { style: styles.empty }, "还没有会话。")
						: model.mode === "flat"
							? model.trees.length === 0
								? h("div", { style: styles.empty }, "最近 7 天没有任务。")
								: renderTaskRows(model.trees, now, openTask)
							: model.groups.length === 0
								? h("div", { style: styles.empty }, "最近 7 天没有任务。")
								: model.groups.map((group) => h(GroupBlock, {
									key: group.id,
									group,
									expanded: expanded[group.id] === true,
									now,
									onToggle: toggleGroup,
									onOpen: openTask,
								}))
				)
			);
		}

		/** 读取已挂载的 agentPresets remote；失败返回空数组，名称降级为 id。 */
		async function loadAgentPresets(ctx) {
			try {
				const remote = typeof ctx.get === "function" ? ctx.get("remote.agentPresets") : undefined;
				if (!remote || typeof remote.list !== "function") return [];
				return normalizeRoster(await remote.list());
			} catch (error) {
				console.warn("[dsh-agent-desk] 预设 remote 不可用", error);
				return [];
			}
		}

		function apply(ctx) {
			try {
				ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 20,
					label: () => PANEL_LABEL,
				}, AgentDeskIcon));
			} catch (error) {
				console.warn("[dsh-agent-desk] 侧栏入口注册失败", error);
			}
			try {
				ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: PANEL_ID,
					inject: () => ({
						// 0.2.2 的 sessions 服务没有 open()；导航由 uiWorkspace.openSession 负责。
						openSession: (id) => { ctx.uiWorkspace.openSession(id); },
						closePanel: () => { ctx.layout.selectPanel(null); },
						loadAgentPresets: () => loadAgentPresets(ctx),
					}),
				}, AgentDeskPage));
			} catch (error) {
				console.warn("[dsh-agent-desk] 主区页面注册失败", error);
			}
		}

		exports.inject = ["slots", "sessions", "layout", "uiWorkspace"];
		exports.apply = apply;
		// 只给本地 node --test 用；浏览器侧不会读取。
		exports.__internals = {
			PANEL_ID,
			BUILTIN_PRESETS,
			FLAT_NOTE,
			TASK_WINDOW_MS,
			AgentDeskPage,
			taskTitleOf,
			statusOf,
			countStatuses,
			sessionIdOf,
			parentIdOf,
			isSubagentSession,
			sessionsFromSnapshot,
			snapshotParts,
			catalogIndex,
			presetIdOf,
			isBuiltinPreset,
			isRecentTask,
			sortSessions,
			relativeTime,
			normalizeRoster,
			buildViewModel,
			parseExpanded,
			toggleExpansion,
		};
		return module.exports;
	},
});
