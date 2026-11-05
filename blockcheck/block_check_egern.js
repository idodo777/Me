/*
 * ============================================================
 * 节点阻断检测（Egern 版 v5，功能与原版对齐 + 可视化小组件）
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
 * - 原版靠「长按节点」自动拿到服务器地址；Egern 没有这个接口。
 *   检测分两档：什么都不填 —— 只测节点代理与本机网络（经兜底
 *   策略，即 default 规则选中的出口）；在模块里再填上该节点的
 *   服务器地址与端口 —— 远端探测、国内探测自动启用，功能完整。
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
    return { ok: reachable, items };
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

async function detect(ctx, cfg) {
    const target = cfg.policy ? `策略「${cfg.policy}」` : "兜底策略";
    const hasAddr = Boolean(cfg.host && cfg.port);

    const [via, direct, remote] = await Promise.all([
        checkVia(ctx, cfg.policy),
        checkDirect(ctx),
        hasAddr ? checkRemote(ctx, cfg.host, cfg.port) : Promise.resolve(null),
    ]);

    let gpData = null;
    if (direct.ok && remote && remote.ok && !via.ok) {
        gpData = await fetchGlobalping(ctx, cfg.host, cfg.port);
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

    const nOk = via.ok, dOk = direct.ok, rKnown = remote !== null, rOk = remote ? remote.ok : false;
    let conclusion, short;
    if (!dOk) {
        conclusion = "⚠️ 本机网络异常"; short = "异常";
    } else if (nOk && (!rKnown || rOk)) {
        conclusion = "✅ 节点正常"; short = "正常";
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
        lines.push(`远端探测: ${m.remote.ok ? "✅ 可达" : "❌ 不可达"}`);
        if (m.remote.items && m.remote.items.length > 0) {
            lines.push(...pairsText(m.remote.items, (it) => `${it.flag} ${it.ms}`));
        } else if (m.remote.error) {
            lines.push(m.remote.error);
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

function T(text, size, color, weight = "regular", extra = {}) {
    const el = { type: "text", text: String(text), font: { size, weight }, maxLines: 1 };
    if (color) el.textColor = color;
    return { ...el, ...extra };
}

function row(children, extra = {}) {
    return { type: "stack", direction: "row", alignItems: "center", children: children.filter(Boolean), ...extra };
}

function spacer(length) {
    return length === undefined ? { type: "spacer" } : { type: "spacer", length };
}

function refreshAt() {
    return new Date(Date.now() + REFRESH_MINUTES * 60000).toISOString();
}

function root(children, padding) {
    return {
        type: "widget",
        backgroundColor: C.bg,
        padding,
        gap: 0,
        refreshAfter: refreshAt(),
        children: children.filter(Boolean),
    };
}

function sectionRow(label, status, size) {
    return row([T(label, size, C.ink, "bold"), spacer(6), T(status, size, C.ink, "semibold")]);
}

function detailRow(label, value, size) {
    return row([
        spacer(10),
        T(label, size, C.soft, "bold"),
        T(`: ${value}`, size, C.soft, "regular", { minScale: 0.6 }),
    ]);
}

function titleRow(m, size) {
    return row([
        T("🌐 节点阻断检测", size, C.soft, "semibold"),
        spacer(),
        T(m.time, size - 2, C.faint, "medium"),
    ], { gap: 5 });
}

function nodeRow(m, size) {
    return row([
        T("节点", size, C.soft, "bold"),
        T(`: ${m.target}`, size, C.link, "regular", { minScale: 0.7 }),
    ]);
}

// 两列网格（远端/国内探测）：每格「旗帜/标签 + 延迟」，国内探测的延迟按通断着色
function gridRows(items, size, colored) {
    const rows = [];
    for (let i = 0; i < items.length; i += 2) {
        const cell = (it) => colored
            ? row([T(it.label, size, C.soft, "regular"), spacer(4), T(it.ms, size, it.ok ? C.good : C.bad, "semibold")], { flex: 1 })
            : { ...T(`${it.flag} ${it.ms}`, size, C.soft, "regular"), flex: 1 };
        const left = cell(items[i]);
        const right = i + 1 < items.length ? cell(items[i + 1]) : { ...spacer(), flex: 1 };
        rows.push(row([left, right], { gap: 8 }));
    }
    return rows;
}

function withGaps(elements, gap) {
    const out = [];
    elements.forEach((el, i) => { if (i > 0) out.push(spacer(gap)); out.push(el); });
    return out;
}

// 面板段落（中/大号共用，size 控制字号档位）
function panelSections(m, size, detailSize) {
    const els = [];
    els.push(sectionRow("节点代理", m.via.ok ? "✅ 正常" : "❌ 不可达", size));
    if (m.via.ok) {
        const d = m.via.info;
        els.push(detailRow("IP", d.query, detailSize));
        els.push(detailRow("位置", [d.country, d.regionName, d.city].filter(Boolean).join(" - "), detailSize));
        els.push(detailRow("ISP", d.isp || "未知", detailSize));
    }
    els.push(sectionRow("本机网络", m.direct.ok ? "✅ 正常" : "❌ 异常", size));
    if (m.remote) {
        els.push(sectionRow("远端探测", m.remote.ok ? "✅ 可达" : "❌ 不可达", size));
        if (m.remote.items && m.remote.items.length > 0) {
            els.push(...gridRows(m.remote.items, detailSize, false));
        } else if (m.remote.error) {
            els.push(T(m.remote.error, detailSize, C.faint, "regular"));
        }
    }
    if (m.analysis && m.domestic.length > 0) {
        els.push(sectionRow("国内探测", m.domestic.some((p) => p.ok) ? "✅ 可达" : "❌ 不可达", size));
        els.push(...gridRows(m.domestic.map((p) => ({ label: p.label, ms: p.ms, ok: p.ok })), detailSize, true));
    }
    els.push(T("📋 诊断结论", size, C.ink, "bold"));
    els.push(T(m.conclusion, size + 3, C.ink, "bold", { maxLines: 2, minScale: 0.65 }));
    return els;
}

// 注意：根节点不要加 flex 撑满的 spacer 把末行顶到底边——内容略高时
// 最后一行会被卡片边缘截断（v5 真机截图「节点：兜底策略」被切一半）。
// 末行紧跟内容自然排布，并收紧行距给内容留余量。
function mediumWidget(m) {
    return root([
        titleRow(m, 13),
        spacer(7),
        ...withGaps(panelSections(m, 14, 12), 4),
        spacer(6),
        nodeRow(m, 12),
    ], 12);
}

function largeWidget(m) {
    return root([
        titleRow(m, 15),
        spacer(9),
        ...withGaps(panelSections(m, 16, 13), 5),
        spacer(7),
        nodeRow(m, 13),
    ], 14);
}

function smallWidget(m) {
    const els = [
        titleRow(m, 11),
        spacer(8),
        sectionRow("节点代理", m.via.ok ? "✅ 正常" : "❌ 不可达", 12),
        spacer(4),
        sectionRow("本机网络", m.direct.ok ? "✅ 正常" : "❌ 异常", 12),
    ];
    if (m.remote) {
        els.push(spacer(4), sectionRow("远端探测", m.remote.ok ? "✅ 可达" : "❌ 不可达", 12));
    }
    els.push(
        spacer(8),
        T(m.conclusion, 14, C.ink, "bold", { maxLines: 2, minScale: 0.65 }),
        spacer(),
        nodeRow(m, 11),
    );
    return root(els, 12);
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
        case "systemLarge":
        case "systemExtraLarge": return largeWidget(m);
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
