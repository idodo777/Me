/*
 * ============================================================
 * 节点阻断检测（Egern 版 v6.0，可视化小组件）
 * ============================================================
 * 原作者：RavelloH（https://github.com/RavelloH）
 * 原版：Quantumult X event-interaction 脚本 block_check.js（同目录存档）
 *
 * 检测逻辑（v6.0 按使用者的思路重构：方向改为「节点出站」）：
 * 这个模块回答一个问题——当前节点（兜底策略选中的出口，或模块里
 * 指定的策略）能不能访问指定国家、延迟多少。检测时让节点自己
 * 主动向六个国家的目标端点各发一次请求，计时即延迟：
 * 1) 节点代理 —— 经策略访问 ip-api.com，通不通、出口是哪；
 * 2) 本机网络 —— 本机直连 ip-api.com，排除本机断网；
 * 3) 远端探测 —— 经同一策略依次请求日本、美国、英国、德国、韩国、
 *    新加坡的目标端点（Google 各国域名的 generate_204，已实测
 *    全部返回 204），逐国给出延迟；请求失败或超时即「中断」，
 *    表示这个节点到达不了那个国家。
 * 结果只有两种：延迟高低，或中断。不存在第三种状态。
 *
 * 与原版（及本模块 v5 以前）的区别：
 * - 原版测的是反方向：让六国探针从外面连进来打节点服务器，所以
 *   必须知道服务器地址，测的也是「服务器的门牌能不能被敲开」。
 *   v6 改成节点出站实测，不再需要服务器地址，也就没有地址填错、
 *   中转入口对不上导致的假阴性（v5 的「未命中」即源于此）。
 * - 随之去掉：check-host 入站探测、Globalping 国内探测、服务器
 *   地址/端口参数。节点本身不可达时只报「节点不可达」，不再细
 *   分是 GFW 阻断还是离线（出站逻辑下无法、也不需要区分）。
 * - 延迟为手机端完整往返（本机 → 节点 → 目标），即实际体感延迟。
 * ============================================================
 */

const IP_API = "http://ip-api.com/json?lang=zh-CN";
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

/* ---------- 基础工具 ---------- */

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

function clock() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/* ---------- 检测 ---------- */

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

// 六国目标端点（顺序按用户指定）：Google 各国域名的 generate_204，
// 2026-11-05 实测六个全部返回 HTTP 204、无响应体、全球稳定。
const PROBE_COUNTRIES = [
    { cc: "JP", name: "日本", url: "https://www.google.co.jp/generate_204" },
    { cc: "US", name: "美国", url: "https://www.google.com/generate_204" },
    { cc: "GB", name: "英国", url: "https://www.google.co.uk/generate_204" },
    { cc: "DE", name: "德国", url: "https://www.google.de/generate_204" },
    { cc: "KR", name: "韩国", url: "https://www.google.co.kr/generate_204" },
    { cc: "SG", name: "新加坡", url: "https://www.google.com.sg/generate_204" },
];

// 经节点向一个国家的端点发请求并计时：拿到响应 = 可达（值为延迟）；
// 抛错/超时 = 中断（这个节点到达不了这个国家）
async function probeCountry(ctx, policy, c) {
    const options = { timeout: TIMEOUT, headers: { "User-Agent": UA }, redirect: "manual" };
    if (policy) options.policy = policy;
    const t0 = Date.now();
    try {
        await ctx.http.get(c.url, options);
        return { cc: c.cc, name: c.name, flag: getFlag(c.cc), ok: true, ms: formatMs(Date.now() - t0) };
    } catch {
        return { cc: c.cc, name: c.name, flag: getFlag(c.cc), ok: false, ms: "中断" };
    }
}

async function detect(ctx, cfg) {
    const target = cfg.policy ? `策略「${cfg.policy}」` : "兜底策略";

    // 三路并行：经节点查出口、直连查本机、经节点测六国
    const [via, direct, items] = await Promise.all([
        checkVia(ctx, cfg.policy),
        checkDirect(ctx),
        Promise.all(PROBE_COUNTRIES.map((c) => probeCountry(ctx, cfg.policy, c))),
    ]);

    const okCount = items.filter((i) => i.ok).length;
    const remote = { items, okCount, allOk: okCount === items.length, anyOk: okCount > 0 };
    const blockedNames = items.filter((i) => !i.ok).map((i) => i.name);

    let conclusion, short;
    if (!direct.ok) {
        conclusion = "⚠️ 本机网络异常"; short = "异常";
    } else if (!via.ok) {
        conclusion = "🚫 节点不可达"; short = "不可达";
    } else if (remote.allOk) {
        conclusion = "✅ 节点正常"; short = "正常";
    } else if (remote.anyOk) {
        conclusion = `⚠️ 部分中断：${blockedNames.join("、")}不可达`; short = "部分中断";
    } else {
        conclusion = "⚠️ 出站异常：六国均中断"; short = "异常";
    }

    return { target, time: clock(), via, direct, remote, conclusion, short };
}

/* ---------- 面板文字（通知与日志共用） ---------- */

function pairsText(items, render) {
    const lines = [];
    for (let i = 0; i < items.length; i += 2) {
        const left = render(items[i]);
        const right = i + 1 < items.length ? render(items[i + 1]) : null;
        lines.push(right ? `${left}    ${right}` : left);
    }
    return lines;
}

function remoteStatusText(m) {
    const r = m.remote;
    if (r.allOk) return "✅ 全部可达";
    if (r.anyOk) return `⚠️ 部分中断（${r.okCount}/6 可达）`;
    return "❌ 全部中断";
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
    lines.push(`远端探测: ${remoteStatusText(m)}`);
    lines.push(...pairsText(m.remote.items, (it) => `${it.flag} ${it.ms}`));
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

// 远端探测状态词（组件用短版）
function remoteStatus(m) {
    if (!m.remote) return null;
    const r = m.remote;
    if (r.allOk) return "✅ 全部可达";
    if (r.anyOk) return `⚠️ ${r.okCount}/6 可达`;
    return "❌ 全部中断";
}

// 探测网格：每格一个 flex 文本，行高写明（flex 行纪律）；中断的格子标红
function gridRows(items, size, cols) {
    const rows = [];
    for (let i = 0; i < items.length; i += cols) {
        const cells = [];
        for (let j = 0; j < cols; j++) {
            const it = items[i + j];
            if (!it) { cells.push({ ...spacer(), flex: 1 }); continue; }
            cells.push({ ...T(`${it.flag} ${it.ms}`, size, it.ok ? C.soft : C.bad, it.ok ? "regular" : "semibold", { minScale: 0.7 }), flex: 1 });
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

// 远端探测卡片：标题行 + 六国网格（大号带一行口径说明）
function probeCard(m, size, cols, withHint) {
    if (!m.remote) return null;
    const els = [sectionRow("远端探测", remoteStatus(m), size + 1)];
    els.push(...gridRows(m.remote.items, size, cols));
    if (withHint) {
        els.push(T("经节点出站实测：请求各国端点的往返延迟，中断 = 节点到达不了该国", size - 1, C.faint, "regular", { minScale: 0.7 }));
    }
    return card(els);
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

/* 大号 / 超大号：完整面板 */
function largeWidget(m) {
    const sec = 15, det = 12.5, concl = 17;
    return root([
        titleRow(m, 14),
        sectionRow("节点代理", m.via.ok ? "✅ 正常" : "❌ 不可达", sec),
        ...viaDetails(m, det),
        sectionRow("本机网络", m.direct.ok ? "✅ 正常" : "❌ 异常", sec),
        probeCard(m, det, 2, true),
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
        case "systemLarge": return largeWidget(m);
        case "systemExtraLarge": return largeWidget(m);
        default: return mediumWidget(m);
    }
}

function errorWidget(family, message) {
    const m = {
        target: "兜底策略", time: clock(),
        via: { ok: false }, direct: { ok: false }, remote: null,
        conclusion: "🛑 检测出错：" + String(message || "").slice(0, 40), short: "出错",
    };
    return widgetFor(family, m);
}


/* ---------- 主入口 ---------- */

export default async function (ctx) {
    const env = ctx.env || {};
    const cfg = {
        policy: String(env.POLICY || "").trim(),
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
