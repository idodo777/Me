/*
 * ============================================================
 * 节点阻断检测（Egern 版 v5.5，功能与原版对齐 + 可视化小组件）
 * ============================================================
 * 原作者：RavelloH（https://github.com/RavelloH）
 * 原版：Quantumult X event-interaction 脚本 block_check.js（同目录存档）
 * 功能：检测节点是真挂了，还是被 GFW / 运营商屏蔽。
 *
 * 检测方法（与原版一致，多方交叉验证）：
 * 1) 节点代理 —— 经策略访问 ip-api.com，通不通、出口是哪；
 * 2) 本机网络 —— 本机直连 ip-api.com，排除本机断网；
 * 3) 远端探测 —— 固定六国探针 TCP 探测节点服务器地址，逐国列出
 *    延迟（哪国线路不通一目了然）：日本、美国、英国、德国、韩国、
 *    新加坡。五国用 check-host 指定探针；check-host 没有韩国探针，
 *    韩国用 Globalping 的韩国探针补齐；
 * 4) 国内探测 —— 仅当「海外可达 + 国内经节点不通」时触发：
 *    Globalping 国内电信/联通/移动探针定位阻断来源
 *    （三家全不通 = GFW 全局阻断；某家不通 = 运营商级拦截；
 *      三家全通 = 非拦截，查客户端配置）。
 * 结论树与原版一致：节点正常 / 节点离线 / 疑似被运营商/GFW 阻断 /
 * 本机网络异常 / 数据不完整（+ 国内探测的三种细分结论）。
 *
 * 与原版的差异（平台机制所限，已尽量等价）：
 * - 原版靠「长按节点」自动拿到服务器地址；Egern 没有读节点配置的
 *   接口（API 已逐项核对）。本版用三级来源自动凑目标：手动填的
 *   地址优先；没填时用本次出口 IP + 443 自动探测（机场节点多为
 *   服务器即出口、端口 443）；节点挂了则用上次成功缓存的出口 IP。
 *   自动模式防误报：节点通而六国全不通 = 自动目标不对（中转入口
 *   或非 443 端口），标「未命中」且不参与结论，不误报被墙。
 *   只有「出口从未成功过又没填地址」时远端探测才显示未设置。
 * - 原版结果是 QuanX 的 HTML 面板；本版呈现为同结构文字面板
 *   （通知）与 Egern 小组件，段落、顺序、用词都按原版面板。
 * - 移植时修掉原版一个 bug：check-host 对探测失败的节点返回
 *   [null]，原版读 nr[0].time 会抛错且无人接住，脚本无声卡死
 *   （恰好发生在「节点离线」场景）；本版已加空值守卫。
 * - check-host / Globalping 请求加浏览器 UA，避免被机器人过滤误拦。
 * ============================================================
 */

const IP_API = "http://ip-api.com/json?lang=zh-CN";
const CHECK_HOST = "https://check-host.net";
const GP_API = "https://api.globalping.io/v1/measurements";
const TIMEOUT = 8000;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const REFRESH_MINUTES = 10;

const C = {
    bg: { light: "#FFFFFF", dark: "#161B22" },
    ink: { light: "#1F2328", dark: "#E6EDF3" },
    soft: { light: "#59636E", dark: "#8B949E" },
    faint: { light: "#818B98", dark: "#6E7681" },
    link: { light: "#467fcf", dark: "#6ea8fe" },
    card: { light: "#F2F5F9", dark: "#1D2530" },
    good: { light: "#1F9D55", dark: "#48C78E" },
    bad: { light: "#D73A49", dark: "#FE6685" },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- 与原版逐字一致的纯逻辑 ---------- */

function getFlag(cc) {
    if (!cc || cc.length !== 2) return "🌍";
    const cp = cc.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0));
    return String.fromCodePoint(...cp);
}

function formatMs(ms) {
    if (ms >= 10000) {
        return Math.floor(ms) + "ms";
    } else if (ms >= 1000) {
        return Math.floor(ms).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "ms";
    } else if (ms >= 100) {
        return ms.toFixed(1) + "ms";
    } else if (ms >= 10) {
        return ms.toFixed(2) + "ms";
    } else if (ms <= 0) {
        return "0.00ms";
    } else {
        return ms.toFixed(3) + "ms";
    }
}

function classifyISP(network) {
    const n = String(network || "").toLowerCase();
    if (n.indexOf("unicom") !== -1 || n.indexOf("china unicom") !== -1) return "中国联通";
    if (n.indexOf("chinanet") !== -1 || n.indexOf("telecom") !== -1 || n.indexOf("china telecom") !== -1) return "中国电信";
    if (n.indexOf("mobile") !== -1 || n.indexOf("china mobile") !== -1) return "中国移动";
    return null;
}

function cnCity(en) {
    const map = {
        "Beijing": "北京", "Shanghai": "上海", "Guangzhou": "广州",
        "Shenzhen": "深圳", "Chengdu": "成都", "Hangzhou": "杭州",
        "Wuhan": "武汉", "Nanjing": "南京", "Tianjin": "天津",
        "Xi'an": "西安", "Changsha": "长沙", "Zhengzhou": "郑州",
        "Jinan": "济南", "Qingdao": "青岛", "Dalian": "大连",
        "Xiamen": "厦门", "Fuzhou": "福州", "Kunming": "昆明",
        "Hefei": "合肥", "Ningbo": "宁波", "Suzhou": "苏州",
        "Wuxi": "无锡", "Changzhou": "常州", "Guilin": "桂林",
        "Nanning": "南宁", "Haikou": "海口", "Sanya": "三亚",
        "Guiyang": "贵阳", "Lanzhou": "兰州", "Urumqi": "乌市",
        "Hohhot": "呼市", "Harbin": "哈市", "Changchun": "长春",
        "Shenyang": "沈阳", "Shijiazhuang": "石市", "Taiyuan": "太原",
        "Xuzhou": "徐州", "Yancheng": "盐城", "Taishan": "台山",
        "Nanchang": "南昌", "Foshan": "佛山", "Dongguan": "东莞",
        "Zhuhai": "珠海", "Zhongshan": "中山", "Huizhou": "惠州",
    };
    return map[en] || en;
}

function analyzeBlockSource(gpData) {
    const results = gpData && gpData.results;
    if (!results) return null;

    const ispGroups = {};
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const isp = classifyISP(r.probe.network);
        if (!isp) continue;

        if (!ispGroups[isp]) ispGroups[isp] = { probes: [], reachable: false };

        const res = r.result || {};
        let ok = false;
        let ms = "--.--ms";
        const stats = res.stats;
        if (res.status === "finished" && stats) {
            ok = stats.rcv > 0;
            ms = ok ? formatMs(stats.avg || 0) : "--.--ms";
        }
        if (ok) ispGroups[isp].reachable = true;

        ispGroups[isp].probes.push({ city: cnCity(r.probe.city), ok, ms });
    }

    const reachableIsps = [], blockedIsps = [];
    for (const key of Object.keys(ispGroups)) {
        const g = ispGroups[key];
        if (g.probes.length === 0) continue;
        if (g.reachable) reachableIsps.push(key); else blockedIsps.push(key);
    }

    let conclusion;
    if (reachableIsps.length === 0 && blockedIsps.length === 0) {
        return { ispGroups, conclusion: null };
    } else if (reachableIsps.length === 0) {
        conclusion = "🚫 GFW 全局阻断 — 国内三大运营商均无法访问";
    } else if (blockedIsps.length > 0) {
        conclusion = "🚫 运营商级拦截 — " + blockedIsps.join("、") + " 不可达，" + reachableIsps.join("、") + " 正常";
    } else {
        conclusion = "✅ 国内三大运营商全部可达，非 GFW 或运营商拦截，请检查客户端配置";
    }

    return { ispGroups, conclusion };
}

/* ---------- 网络小工具 ---------- */

async function fetchJSON(ctx, url, options = {}) {
    try {
        const method = (options.method || "GET").toUpperCase();
        const opts = { timeout: TIMEOUT, headers: options.headers || {}, body: options.body };
        const res = method === "POST" ? await ctx.http.post(url, opts) : await ctx.http.get(url, opts);
        return await res.json();
    } catch {
        return null;
    }
}

function clock() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/* ---------- 四路检测 ---------- */

// 节点代理：policy 为空时不带 policy 选项 —— 跟随分流规则（兜底策略）
async function checkVia(ctx, policy) {
    const options = { timeout: TIMEOUT, headers: { "User-Agent": UA } };
    if (policy) options.policy = policy;
    try {
        const res = await ctx.http.get(IP_API, options);
        const data = await res.json();
        if (!data || data.status === "fail" || !data.query) return { ok: false };
        return { ok: true, info: data };
    } catch {
        return { ok: false };
    }
}

async function checkDirect(ctx) {
    try {
        const res = await ctx.http.get(IP_API, { timeout: TIMEOUT, headers: { "User-Agent": UA }, policy: "DIRECT" });
        const data = await res.json();
        if (!data || data.status === "fail" || !data.query) return { ok: false };
        return { ok: true, info: data };
    } catch {
        return { ok: false };
    }
}

// 远端探测的固定国家阵容（顺序按用户指定）：日本、美国、英国、德国、韩国、新加坡。
// 五国用 check-host 的指定探针；check-host 没有韩国探针（2026-11-05 实测
// 其 55 个探针无 KR），韩国改用 Globalping 的韩国探针补齐，延迟口径一致。
const REMOTE_COUNTRIES = [
    { cc: "JP", node: "jp1.node.check-host.net" },  // 东京
    { cc: "US", node: "us1.node.check-host.net" },  // 洛杉矶
    { cc: "GB", node: "uk1.node.check-host.net" },  // 伦敦
    { cc: "DE", node: "de4.node.check-host.net" },  // 法兰克福
    { cc: "KR", node: null },                        // Globalping 韩国探针
    { cc: "SG", node: "sg1.node.check-host.net" },  // 新加坡
];

// check-host 提交：优先指定探针（POST nodes[]），不被接受时退回原版随机 10 探针
async function submitCheckHost(ctx, target, headers) {
    const chNodes = REMOTE_COUNTRIES.filter((c) => c.node).map((c) => c.node);
    const form = "host=" + encodeURIComponent(target)
        + chNodes.map((n, i) => `&nodes[${i}]=${encodeURIComponent(n)}`).join("");
    const d = await fetchJSON(ctx, `${CHECK_HOST}/check-tcp`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
    });
    if (d && d.ok && d.request_id) return d;
    const legacy = await fetchJSON(ctx, `${CHECK_HOST}/check-tcp?host=${encodeURIComponent(target)}&max_nodes=10`, { headers });
    return legacy && legacy.ok && legacy.request_id ? legacy : null;
}

// 远端探测：六国探针 TCP 探测 host:port，逐国给出延迟（原版流程 + [null] 守卫）
async function checkRemote(ctx, host, port) {
    const headers = { "Accept": "application/json", "User-Agent": UA };
    const target = host + ":" + port;

    // check-host 提交与 Globalping 韩国测量同时发起，并行等结果
    const [d, krSubmit] = await Promise.all([
        submitCheckHost(ctx, target, headers),
        fetchJSON(ctx, GP_API, {
            method: "POST",
            headers: { "Content-Type": "application/json", "User-Agent": UA },
            body: JSON.stringify({
                type: "ping", target: host,
                measurementOptions: { port: parseInt(port, 10), protocol: "TCP" },
                locations: [{ country: "KR" }], limit: 2,
            }),
        }),
    ]);
    await sleep(6000);

    // check-host 结果按国家归拢（原版读 nr[0].time 未防 [null] 会卡死，已加守卫）
    const msByCc = {};
    if (d) {
        const res = await fetchJSON(ctx, `${CHECK_HOST}/check-result/${d.request_id}`, { headers });
        if (res) {
            const nodeList = d.nodes || {};
            for (const n of Object.keys(nodeList)) {
                const info = nodeList[n];
                let cc = info && info.length >= 1 ? String(info[0]).toUpperCase() : "";
                if (cc === "UK") cc = "GB";
                if (!cc || msByCc[cc]) continue;
                const nr = res[n];
                if (nr && Array.isArray(nr) && nr.length > 0 && nr[0] && nr[0].time !== undefined) {
                    msByCc[cc] = formatMs(nr[0].time * 1000);
                }
            }
        }
    }

    // Globalping 韩国探针结果
    if (krSubmit && krSubmit.id) {
        const g = await fetchJSON(ctx, `${GP_API}/${krSubmit.id}`, { headers });
        const r0 = g && g.results && g.results[0];
        if (r0 && r0.result && r0.result.status === "finished" && r0.result.stats && r0.result.stats.rcv > 0) {
            msByCc.KR = formatMs(r0.result.stats.avg || 0);
        }
    }

    let reachable = false;
    const items = REMOTE_COUNTRIES.map((c) => {
        const ms = msByCc[c.cc];
        if (ms) reachable = true;
        return { flag: getFlag(c.cc), ms: ms || "--.--ms" };
    });
    return { ok: reachable, items, configured: true };
}

// 国内探测：Globalping 国内三网探针（原版请求体一致）
async function fetchGlobalping(ctx, host, port) {
    const body = {
        type: "ping",
        target: host,
        measurementOptions: { port: parseInt(port, 10), protocol: "TCP" },
        locations: [{ country: "CN", tags: ["eyeball-network"] }],
        limit: 12,
    };
    const headers = { "Content-Type": "application/json", "User-Agent": UA };
    const d = await fetchJSON(ctx, GP_API, { method: "POST", headers, body: JSON.stringify(body) });
    if (!d || !d.id) return null;
    await sleep(6000);
    return fetchJSON(ctx, `${GP_API}/${d.id}`, { headers: { "Accept": "application/json", "User-Agent": UA } });
}

/* ---------- 汇总与结论（结论树与原版一致） ---------- */

const STORE_KEY = "blockcheck_last_exit";

// 读上次成功时的出口 IP（节点挂掉时远端探测就靠它兜底）
function loadLastExit(ctx) {
    try {
        if (ctx.storage && typeof ctx.storage.getJSON === "function") {
            const v = ctx.storage.getJSON(STORE_KEY);
            if (v && v.ip) return v;
        }
    } catch { /* 存储不可用就当没有 */ }
    return null;
}

function saveLastExit(ctx, ip, policy) {
    try {
        if (ctx.storage && typeof ctx.storage.setJSON === "function") {
            ctx.storage.setJSON(STORE_KEY, { ip, policy: policy || "", ts: Date.now() });
        }
    } catch { /* 存储失败不影响检测 */ }
}

async function detect(ctx, cfg) {
    const target = cfg.policy ? `策略「${cfg.policy}」` : "兜底策略";

    const [via, direct] = await Promise.all([
        checkVia(ctx, cfg.policy),
        checkDirect(ctx),
    ]);
    if (via.ok) saveLastExit(ctx, via.info.query, cfg.policy);

    /* 远端探测目标，三级来源（智能化：能自动就不手动）：
     * 1) 手动填的服务器地址+端口 —— 精确；
     * 2) 自动：本次出口 IP（节点通时 ip-api 直接给出）+ 443 —— 大多数机场
     *    节点（VLESS/TLS/Reality）服务器即出口机、端口 443，探测真实有效；
     * 3) 自动兜底：上次成功缓存的出口 IP + 443 —— 节点这次挂了也能测。
     * 自动模式带防误报：节点明明通、六国却全测不通，多半是中转入口或非 443
     * 端口（自动目标不对），标「未命中」且不参与结论，不会误报成被墙。 */
    let host = cfg.host, port = cfg.port, auto = false;
    if (!host || !port) {
        const exitIp = via.ok ? via.info.query : (loadLastExit(ctx) || {}).ip;
        if (exitIp) {
            host = host || exitIp;
            port = port || "443";
            auto = true;
        }
    }

    const probed = host && port ? await checkRemote(ctx, host, port) : null;
    // 远端探测常驻：实在没有目标时给占位结果（六国旗帜 + --.--ms），面板上标
    // 「未设置」，不再整段消失 —— 整段缺失会被误读成脚本把功能藏了
    const remote = probed || {
        ok: false, configured: false,
        items: REMOTE_COUNTRIES.map((c) => ({ flag: getFlag(c.cc), ms: "--.--ms" })),
    };
    if (probed) {
        remote.auto = auto;
        remote.target = `${host}:${port}`;
        remote.miss = Boolean(auto && via.ok && !remote.ok);
    }

    let gpData = null;
    if (direct.ok && remote && remote.ok && !via.ok) {
        gpData = await fetchGlobalping(ctx, host, port);
    }
    const analysis = gpData ? analyzeBlockSource(gpData) : null;

    // 国内探针按 电信 → 联通 → 移动 排序摊平（与原版面板一致）
    const domestic = [];
    if (analysis) {
        const abbr = { "中国电信": "电信", "中国联通": "联通", "中国移动": "移动" };
        for (const key of ["中国电信", "中国联通", "中国移动"]) {
            const group = analysis.ispGroups[key];
            if (!group) continue;
            for (const p of group.probes) domestic.push({ label: `${abbr[key]}·${p.city}`, ms: p.ms, ok: p.ok });
        }
    }

    const nOk = via.ok, dOk = direct.ok, rKnown = remote.configured === true && !remote.miss, rOk = remote.ok;
    let conclusion, short;
    if (!dOk) {
        conclusion = "⚠️ 本机网络异常"; short = "异常";
    } else if (nOk && (!rKnown || rOk)) {
        conclusion = "✅ 节点正常"; short = "正常";
    } else if (!nOk && !rKnown) {
        conclusion = "🚫 节点不可达"; short = "不可达";
    } else if (!nOk && rOk && dOk) {
        if (analysis && analysis.conclusion) {
            conclusion = analysis.conclusion;
            short = conclusion.startsWith("✅") ? "可达" : "阻断";
        } else {
            conclusion = "🚫 疑似被运营商/GFW 阻断"; short = "阻断";
        }
    } else if (!nOk && rKnown && !rOk && dOk) {
        conclusion = "💤 节点离线"; short = "离线";
    } else {
        conclusion = "❓ 数据不完整"; short = "未知";
    }

    return { target, time: clock(), via, direct, remote, domestic, analysis, conclusion, short };
}

/* ---------- 面板文字（通知与日志共用，结构同原版） ---------- */

function pairsText(items, render) {
    const lines = [];
    for (let i = 0; i < items.length; i += 2) {
        const left = render(items[i]);
        const right = i + 1 < items.length ? render(items[i + 1]) : null;
        lines.push(right ? `${left}    ${right}` : left);
    }
    return lines;
}

function panelLines(m) {
    const lines = [];
    lines.push(`节点代理: ${m.via.ok ? "✅ 正常" : "❌ 不可达"}`);
    if (m.via.ok) {
        const d = m.via.info;
        lines.push(`IP: ${d.query}`);
        lines.push(`位置: ${[d.country, d.regionName, d.city].filter(Boolean).join(" - ")}`);
        lines.push(`ISP: ${d.isp || "未知"}`);
    }
    lines.push(`本机网络: ${m.direct.ok ? "✅ 正常" : "❌ 异常"}`);
    if (m.remote) {
        if (m.remote.configured === false) {
            lines.push("远端探测: ⚠️ 未设置");
            lines.push(...pairsText(m.remote.items, (it) => `${it.flag} ${it.ms}`));
            lines.push("（节点出口未知：在模块里填服务器地址和端口后启用）");
        } else {
            lines.push(`远端探测: ${m.remote.miss ? "⚠️ 未命中" : (m.remote.ok ? "✅ 可达" : "❌ 不可达")}`);
            if (m.remote.items && m.remote.items.length > 0) {
                lines.push(...pairsText(m.remote.items, (it) => `${it.flag} ${it.ms}`));
            } else if (m.remote.error) {
                lines.push(m.remote.error);
            }
            if (m.remote.auto) {
                lines.push(`（自动探测 ${m.remote.target}：出口 IP + 443${m.remote.miss ? "；未命中多半是中转入口或非 443 端口，填地址可精确测" : ""}）`);
            }
        }
    }
    if (m.analysis && m.domestic.length > 0) {
        lines.push(`国内探测: ${m.domestic.some((p) => p.ok) ? "✅ 可达" : "❌ 不可达"}`);
        lines.push(...pairsText(m.domestic, (p) => `${p.label} ${p.ms} ${p.ok ? "✓" : "✗"}`));
    }
    lines.push("📋 诊断结论");
    lines.push(m.conclusion);
    lines.push(`节点: ${m.target}`);
    return lines;
}

/* ---------- 小组件 DSL ---------- */
/*
 * 排版方法（综合两个真机验证过的参照：vfelix7 IP 纯净度 + moyuzaime 中国广电）：
 * - 组合用「粗粒度积木」：页头行 + 若干内容块 + 结论 + 页脚行，根容器用 gap 统一节奏；
 * - 文本行不写 height，靠内容自然撑高（广电写法）；只有含 flex 子元素的行/卡片
 *   才写明 height（纯净度脚本的真机教训：flex 元素横竖都会撑满，会把所在行拉高）；
 * - 行内间距用 gap / padding，不用定长 spacer（它在交叉轴会撑满）；spacer() 只用于
 *   行内推右对齐，以及大号列尾吸收余量（紧张时压成 0，不会顶出卡片）；
 * - 探测网格装进浅底圆角卡片（广电的数据卡片式），成块呈现而不是散行。
 */

const LH = (size) => Math.ceil(size * 1.4);

function T(text, size, color, weight = "regular", extra = {}) {
    const el = { type: "text", text: String(text), font: { size, weight }, maxLines: 1 };
    if (color) el.textColor = color;
    return { ...el, ...extra };
}

function row(children, extra = {}) {
    return { type: "stack", direction: "row", alignItems: "center", children: children.filter(Boolean), ...extra };
}

function col(children, extra = {}) {
    return { type: "stack", direction: "column", children: children.filter(Boolean), ...extra };
}

function spacer(length) {
    return length === undefined ? { type: "spacer" } : { type: "spacer", length };
}

function refreshAt() {
    return new Date(Date.now() + REFRESH_MINUTES * 60000).toISOString();
}

function root(children, padding, gap) {
    return {
        type: "widget",
        backgroundColor: C.bg,
        padding,
        gap,
        refreshAfter: refreshAt(),
        children: children.filter(Boolean),
    };
}

// 页头：标题 + 右侧时间（广电页头式）
function titleRow(m, size) {
    return row([
        T("🌐 节点阻断检测", size, C.soft, "semibold"),
        spacer(),
        T(m.time, size - 2, C.faint, "medium"),
    ], { gap: 5 });
}

// 段标题行：加粗标签 + 状态，如「节点代理 ✅ 正常」
function sectionRow(label, status, size) {
    return row([
        T(label, size, C.ink, "bold"),
        T(status, size, C.ink, "semibold"),
    ], { gap: 6 });
}

// 明细行：「标签: 值」，缩进用 padding
function detailRow(label, value, size) {
    return row([
        T(label, size, C.soft, "bold"),
        T(`: ${value}`, size, C.soft, "regular", { minScale: 0.6 }),
    ], { padding: [0, 0, 0, 10] });
}

function nodeRow(m, size, withTime = false) {
    return row([
        T("节点", size, C.soft, "bold"),
        T(`: ${m.target}`, size, C.link, "regular", { minScale: 0.7 }),
        withTime ? spacer() : null,
        withTime ? T(m.time, size - 1, C.faint, "medium") : null,
    ], { gap: 0 });
}

// 远端探测状态词：未填地址时是「未设置」，与真不通区分开
function remoteStatus(m) {
    if (!m.remote) return null;
    if (m.remote.configured === false) return "⚠️ 未设置";
    if (m.remote.miss) return "⚠️ 未命中";
    return m.remote.ok ? "✅ 可达" : "❌ 不可达";
}

// 探测网格：每格一个 flex 文本，行高写明（flex 行纪律）；colored 时延迟按通断着色
function gridRows(items, size, cols, colored) {
    const rows = [];
    for (let i = 0; i < items.length; i += cols) {
        const cells = [];
        for (let j = 0; j < cols; j++) {
            const it = items[i + j];
            if (!it) { cells.push({ ...spacer(), flex: 1 }); continue; }
            if (colored) {
                cells.push({
                    type: "stack", direction: "row", alignItems: "center", flex: 1, height: LH(size),
                    children: [T(it.label, size, C.soft, "regular"), T(` ${it.ms}`, size, it.ok ? C.good : C.bad, "semibold")],
                });
            } else {
                cells.push({ ...T(`${it.flag} ${it.ms}`, size, C.soft, "regular", { minScale: 0.7 }), flex: 1 });
            }
        }
        rows.push(row(cells, { gap: 6, height: LH(size) }));
    }
    return rows;
}

// 浅底圆角卡片：把一段内容成块呈现（广电数据卡片式）
function card(children) {
    return col(children, {
        padding: [7, 9],
        gap: 4,
        borderRadius: 12,
        backgroundColor: C.card,
    });
}

// 远端探测卡片：标题行 + 六国网格（+ 未设置时的启用提示）
function probeCard(m, size, cols, withHint) {
    if (!m.remote) return null;
    const els = [sectionRow("远端探测", remoteStatus(m), size + 1)];
    if (m.remote.items && m.remote.items.length > 0) {
        els.push(...gridRows(m.remote.items, size, cols, false));
    } else if (m.remote.error) {
        els.push(T(m.remote.error, size, C.faint, "regular"));
    }
    if (withHint && m.remote.configured === false) {
        els.push(T("节点出口未知：在模块里填服务器地址和端口后启用", size - 1, C.faint, "regular", { minScale: 0.7 }));
    } else if (withHint && m.remote.auto) {
        els.push(T(`自动探测 ${m.remote.target}（出口IP+443）${m.remote.miss ? "：未命中多半是中转或非 443 端口" : ""}`, size - 1, C.faint, "regular", { minScale: 0.7 }));
    }
    return card(els);
}

// 国内探测卡片：标题行 + 三网网格（延迟着色）
function domesticCard(m, size, cells) {
    if (!m.analysis || !m.domestic.length) return null;
    return card([
        sectionRow("国内探测", m.domestic.some((p) => p.ok) ? "✅ 可达" : "❌ 不可达", size + 1),
        ...gridRows(cells.map((p) => ({ label: p.label, ms: p.ms, ok: p.ok })), size, 2, true),
    ]);
}

function viaDetails(m, size) {
    if (!m.via.ok) return [];
    const d = m.via.info;
    return [
        detailRow("IP", d.query, size),
        detailRow("位置", [d.country, d.regionName, d.city].filter(Boolean).join(" - "), size),
        detailRow("ISP", d.isp || "未知", size),
    ];
}

/* 大号 / 超大号：完整面板（段落、顺序、用词同原版）。
 * 国内网格：大号每家运营商一个代表探针，超大号放宽到 6 格；全量在通知面板里。 */
function largeWidget(m, xl = false) {
    const sec = 15, det = 12.5, concl = 17;
    let domesticCells = [];
    if (m.analysis && m.domestic.length > 0) {
        if (xl) {
            domesticCells = m.domestic.slice(0, 6);
        } else {
            const seen = new Set();
            domesticCells = m.domestic.filter((p) => {
                const isp = p.label.split("·")[0];
                if (seen.has(isp)) return false;
                seen.add(isp);
                return true;
            });
        }
    }
    return root([
        titleRow(m, 14),
        sectionRow("节点代理", m.via.ok ? "✅ 正常" : "❌ 不可达", sec),
        ...viaDetails(m, det),
        sectionRow("本机网络", m.direct.ok ? "✅ 正常" : "❌ 异常", sec),
        probeCard(m, det, 2, true),
        domesticCard(m, det, domesticCells),
        T("📋 诊断结论", sec, C.ink, "bold"),
        T(m.conclusion, concl, C.ink, "bold", { maxLines: 2, minScale: 0.65 }),
        spacer(),
        nodeRow(m, 12.5),
    ], [12, 14], 6);
}

/* 中号：精简版面板 —— 页头 + 节点代理（右侧出口 IP）+ 本机网络
 * + 远端探测卡片（六国旗帜 3 列 × 2 行）+ 单行结论 + 节点行。 */
function mediumWidget(m) {
    const sec = 12.5, det = 11, concl = 14;
    return root([
        titleRow(m, 12),
        row([
            T("节点代理", sec, C.ink, "bold"),
            T(m.via.ok ? "✅ 正常" : "❌ 不可达", sec, C.ink, "semibold"),
            spacer(),
            m.via.ok ? T(m.via.info.query, det, C.soft, "medium", { minScale: 0.6 }) : null,
        ], { gap: 6 }),
        sectionRow("本机网络", m.direct.ok ? "✅ 正常" : "❌ 异常", sec),
        probeCard(m, 10.5, 3, false),
        T(m.conclusion, concl, C.ink, "bold", { maxLines: 1, minScale: 0.55 }),
        nodeRow(m, det, true),
    ], [10, 12], 5);
}

function smallWidget(m) {
    return root([
        titleRow(m, 11),
        T(m.conclusion, 15, C.ink, "bold", { maxLines: 2, minScale: 0.65 }),
        sectionRow("节点代理", m.via.ok ? "✅ 正常" : "❌ 不可达", 12),
        m.via.ok ? T(`${getFlag(m.via.info.countryCode)} ${m.via.info.query}`, 12, C.soft, "regular", { minScale: 0.6 }) : null,
        m.remote ? sectionRow("远端探测", remoteStatus(m), 12) : null,
        spacer(),
        nodeRow(m, 11),
    ], [10, 12], 4);
}

function inlineWidget(m) {
    return { type: "widget", refreshAfter: refreshAt(), children: [T(m.conclusion, 12, null)] };
}

function circularWidget(m) {
    const emoji = m.conclusion.split(" ")[0];
    return {
        type: "widget",
        padding: 0,
        refreshAfter: refreshAt(),
        children: [{
            type: "stack", direction: "column", alignItems: "center", flex: 1,
            children: [
                spacer(),
                row([spacer(), T(emoji, 20, null), spacer()]),
                row([spacer(), T(m.short, 10, null, "medium"), spacer()]),
                spacer(),
            ],
        }],
    };
}

function rectangularWidget(m) {
    return {
        type: "widget",
        gap: 2,
        refreshAfter: refreshAt(),
        children: [
            T(m.conclusion, 13, null, "semibold", { maxLines: 2, minScale: 0.6 }),
            T(`节点代理: ${m.via.ok ? "✅ 正常" : "❌ 不可达"}`, 12, null, "regular", { minScale: 0.7 }),
            T(`节点: ${m.target}`, 11, null, "regular", { minScale: 0.7 }),
        ],
    };
}

function widgetFor(family, m) {
    switch (family) {
        case "accessoryInline": return inlineWidget(m);
        case "accessoryCircular": return circularWidget(m);
        case "accessoryRectangular": return rectangularWidget(m);
        case "systemSmall": return smallWidget(m);
        case "systemLarge": return largeWidget(m, false);
        case "systemExtraLarge": return largeWidget(m, true);
        default: return mediumWidget(m);
    }
}

function errorWidget(family, message) {
    const m = {
        target: "兜底策略", time: clock(),
        via: { ok: false }, direct: { ok: false }, remote: null, domestic: [], analysis: null,
        conclusion: "🛑 检测出错：" + String(message || "").slice(0, 40), short: "出错",
    };
    return widgetFor(family, m);
}


/* ---------- 主入口 ---------- */

export default async function (ctx) {
    const env = ctx.env || {};
    const cfg = {
        policy: String(env.POLICY || "").trim(),
        host: String(env.HOST || "").trim(),
        port: String(env.PORT || "").trim(),
    };
    const family = ctx.widgetFamily || "";

    try {
        const m = await detect(ctx, cfg);
        console.log("[BLOCK-CHECK]\n" + panelLines(m).join("\n"));
        if (family) return widgetFor(family, m);
        await ctx.notify({ title: "🌐 节点阻断检测", body: panelLines(m).join("\n") });
    } catch (error) {
        console.log("[BLOCK-CHECK] ERROR = " + error);
        if (family) return errorWidget(family, error && error.message);
        await ctx.notify({ title: "🌐 节点阻断检测", body: "🛑 检测出错：" + error });
    }
}
