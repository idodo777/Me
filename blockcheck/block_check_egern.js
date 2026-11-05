/*
 * ============================================================
 * 节点阻断检测（Egern 版 v4，带可视化小组件）
 * ============================================================
 * 源自 RavelloH 的 QuanX 脚本 block_check.js（原版同目录存档）。
 *
 * 检测方式（零填写）：对比「经代理出口」与「本机直连」两条路。
 * 什么都不设置时，检测请求不带 policy，跟随 Egern 分流规则，
 * 最终走 default 规则的兜底策略 —— 测的就是当下实际在用的出口。
 * 唯一参数 POLICY（模块里叫「检测策略」）：填策略组或节点名只测它。
 *
 * 呈现方式：信息结构按原版在 QuanX 里的 HTML 面板设计 ——
 * 分段报告（节点代理 / 本机网络 / 诊断结论 / 节点），小组件与
 * 手动运行的通知共用同一套内容；小组件的机制与 DSL 写法参照
 * vfelix7「IP 纯净度」模块，版式按本脚本自己的数据设计。
 *
 * v1 曾要求手填服务器地址/端口供海外探针（远端探测、国内探测）
 * 定位阻断来源，用户认为还要自己查地址太傻，已去掉。因此原版
 * 靠远端探测区分的「节点离线」与「被阻断」，在本版合并为
 * 「节点不可达（疑似离线或被阻断）」，不硬下细分结论。
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
};

/* ---------- 小工具 ---------- */

function getFlag(countryCode) {
    if (!countryCode) return "🌐";
    const code = countryCode.toUpperCase();
    if (code === "TW") return "🇹🇼";
    if (!/^[A-Z]{2}$/.test(code)) return "🌐";
    return String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0)));
}

function clock() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/* ---------- 单条线路检测 ---------- */

// policy 为空字符串时不带 policy 选项 —— 跟随分流规则（兜底策略）
async function checkLine(ctx, policy) {
    const start = Date.now();
    const options = { timeout: TIMEOUT, headers: { "User-Agent": UA } };
    if (policy) options.policy = policy;
    try {
        const res = await ctx.http.get(IP_API, options);
        const data = await res.json();
        if (!data || data.status === "fail" || !data.query) {
            return { ok: false, ms: Date.now() - start, error: "接口无有效返回" };
        }
        return { ok: true, ms: Date.now() - start, info: data };
    } catch (e) {
        return { ok: false, ms: Date.now() - start, error: String((e && e.message) || e) };
    }
}

/* ---------- 检测并整理成结果模型（结论用词与原版面板一致） ---------- */

async function detect(ctx, policy) {
    const target = policy ? `策略「${policy}」` : "兜底策略";
    const [via, direct] = await Promise.all([
        checkLine(ctx, policy),
        checkLine(ctx, "DIRECT"),
    ]);

    const m = { target, time: clock(), via, direct, advice: "" };

    if (!direct.ok) {
        m.status = "down";
        m.emoji = "⚠️";
        m.conclusion = "本机网络异常";
        m.short = "异常";
    } else if (via.ok) {
        m.status = "ok";
        m.emoji = "✅";
        m.conclusion = "节点正常";
        m.short = "正常";
    } else {
        m.status = "blocked";
        m.emoji = "🚫";
        m.conclusion = "节点不可达";
        m.short = "不可达";
        m.advice = policy
            ? "疑似节点离线或被运营商/GFW 阻断，也可能是策略名填错"
            : "疑似节点离线或被运营商/GFW 阻断，换个节点再测";
    }
    return m;
}

// 面板式文字行：通知与日志共用，结构同原版（节点代理 / 本机网络 / 诊断结论 / 节点）
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
    lines.push("📋 诊断结论");
    lines.push(`${m.emoji} ${m.conclusion}`);
    if (m.advice) lines.push(m.advice);
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

// 段标题行：加粗标签 + 状态，如「节点代理 ✅ 正常」
function sectionRow(label, status, size) {
    return row([
        T(label, size, C.ink, "bold"),
        spacer(6),
        T(status, size, C.ink, "semibold"),
    ]);
}

// 明细行：缩进的「标签: 值」，如「IP: 1.2.3.4」
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

function viaDetails(m, size) {
    if (!m.via.ok) return [];
    const d = m.via.info;
    return [
        detailRow("IP", d.query, size),
        detailRow("位置", [d.country, d.regionName, d.city].filter(Boolean).join(" - "), size),
        detailRow("ISP", d.isp || "未知", size),
    ];
}

function mediumWidget(m) {
    return root([
        titleRow(m, 13),
        spacer(9),
        sectionRow("节点代理", m.via.ok ? "✅ 正常" : "❌ 不可达", 14),
        ...viaDetails(m, 12).flatMap((el) => [spacer(3), el]),
        spacer(8),
        sectionRow("本机网络", m.direct.ok ? "✅ 正常" : "❌ 异常", 14),
        spacer(8),
        T("📋 诊断结论", 14, C.ink, "bold"),
        spacer(3),
        T(`${m.emoji} ${m.conclusion}`, 17, C.ink, "bold", { minScale: 0.7 }),
        m.advice ? spacer(3) : null,
        m.advice ? T(m.advice, 11, C.faint, "regular", { maxLines: 2, minScale: 0.7 }) : null,
        spacer(),
        nodeRow(m, 12),
    ], 14);
}

function largeWidget(m) {
    const directDetail = m.direct.ok
        ? [spacer(3), detailRow("直连IP", `${m.direct.info.query}${m.direct.info.isp ? " · " + m.direct.info.isp : ""}`, 13)]
        : [];
    return root([
        titleRow(m, 15),
        spacer(11),
        sectionRow("节点代理", m.via.ok ? "✅ 正常" : "❌ 不可达", 16),
        ...viaDetails(m, 13).flatMap((el) => [spacer(4), el]),
        spacer(10),
        sectionRow("本机网络", m.direct.ok ? "✅ 正常" : "❌ 异常", 16),
        ...directDetail,
        spacer(10),
        T("📋 诊断结论", 16, C.ink, "bold"),
        spacer(4),
        T(`${m.emoji} ${m.conclusion}`, 20, C.ink, "bold", { minScale: 0.7 }),
        m.advice ? spacer(4) : null,
        m.advice ? T(m.advice, 13, C.faint, "regular", { maxLines: 2, minScale: 0.7 }) : null,
        spacer(),
        nodeRow(m, 13),
    ], 16);
}

function smallWidget(m) {
    return root([
        titleRow(m, 11),
        spacer(8),
        T(`${m.emoji} ${m.conclusion}`, 16, C.ink, "bold", { minScale: 0.65 }),
        spacer(7),
        sectionRow("节点代理", m.via.ok ? "✅ 正常" : "❌ 不可达", 12),
        spacer(4),
        m.via.ok
            ? T(`${getFlag(m.via.info.countryCode)} ${m.via.info.query}`, 12, C.soft, "regular", { minScale: 0.6 })
            : T(m.advice, 11, C.soft, "regular", { maxLines: 3, minScale: 0.7 }),
        spacer(),
        nodeRow(m, 11),
    ], 12);
}

function inlineWidget(m) {
    return { type: "widget", refreshAfter: refreshAt(), children: [T(`${m.emoji} ${m.conclusion}`, 12, null)] };
}

function circularWidget(m) {
    return {
        type: "widget",
        padding: 0,
        refreshAfter: refreshAt(),
        children: [{
            type: "stack", direction: "column", alignItems: "center", flex: 1,
            children: [
                spacer(),
                row([spacer(), T(m.emoji, 20, null), spacer()]),
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
            T(`${m.emoji} ${m.conclusion}`, 13, null, "semibold", { minScale: 0.6 }),
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
        status: "down", emoji: "🛑", conclusion: "检测出错", short: "出错",
        target: "兜底策略", time: clock(), advice: String(message || "").slice(0, 60),
        via: { ok: false }, direct: { ok: false },
    };
    return widgetFor(family, m);
}

/* ---------- 主入口 ---------- */

export default async function (ctx) {
    const env = ctx.env || {};
    const policy = String(env.POLICY || "").trim();
    const family = ctx.widgetFamily || "";

    try {
        const m = await detect(ctx, policy);
        console.log("[BLOCK-CHECK]\n" + panelLines(m).join("\n"));
        if (family) return widgetFor(family, m);
        await ctx.notify({ title: "🌐 节点阻断检测", body: panelLines(m).join("\n") });
    } catch (error) {
        console.log("[BLOCK-CHECK] ERROR = " + error);
        if (family) return errorWidget(family, error && error.message);
        await ctx.notify({ title: "🌐 节点阻断检测", body: "🛑 检测出错：" + error });
    }
}
