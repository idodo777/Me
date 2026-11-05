/*
 * ============================================================
 * 节点阻断检测（Egern 版 v3，带可视化小组件）
 * ============================================================
 * 思路源自 RavelloH 的 QuanX 脚本 block_check.js（原版同目录存档）：
 * 对比「经代理出口」和「本机直连」两条路，判断当前上网通道是否正常。
 *
 * 模式照 vfelix7「IP 纯净度」小组件（用户指定参照）：
 * - 零填写可用：什么都不设置时，检测请求不带 policy，跟随 Egern
 *   分流规则，最终走 default 规则的兜底策略 —— 测的就是你当下
 *   实际在用的那个出口。
 * - 唯一参数 POLICY（模块里叫「检测策略」，env_schema 可视化填写）：
 *   填策略组或节点名只测它，留空测兜底。
 * - 双模式输出：作为小组件刷新时（ctx.widgetFamily 存在）返回
 *   小组件 DSL，把结果画出来；在脚本列表里手动运行时发通知。
 * - v1 要求手填服务器地址/端口供海外探针定位阻断来源，用户认为
 *   还要自己查地址太傻，已去掉；代价：经策略不通时只能给出
 *   「节点离线 / 被阻断 / 策略名填错」几种可能，不再细分
 *   GFW 全局阻断还是运营商拦截。
 *
 * 结论：
 *   ✅ 出口正常        经出口能通，附出口 IP / 地区 / 运营商
 *   ⚠️ 经策略不通      本机直连正常，是代理这条路的问题
 *   ❌ 本机网络异常    直连也不通，先查本机网络
 * ============================================================
 */

const IP_API = "http://ip-api.com/json?lang=zh-CN";
const TIMEOUT = 8000;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const REFRESH_MINUTES = 10;

// 小组件配色（浅/深两套，照参照脚本的写法）
const C = {
    bg: { light: "#FFFFFF", dark: "#161B22" },
    ink: { light: "#1F2328", dark: "#E6EDF3" },
    soft: { light: "#59636E", dark: "#8B949E" },
    faint: { light: "#818B98", dark: "#6E7681" },
    good: { light: "#1F9D55", dark: "#48C78E" },
    warn: { light: "#B4600F", dark: "#F0A040" },
    bad: { light: "#D73A49", dark: "#FE6685" },
};

/* ---------- 小工具 ---------- */

function getFlag(countryCode) {
    if (!countryCode) return "🌐";
    const code = countryCode.toUpperCase();
    if (code === "TW") return "🇹🇼";
    if (!/^[A-Z]{2}$/.test(code)) return "🌐";
    return String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0)));
}

function placeOf(info) {
    if (!info) return "";
    const parts = [info.country, info.regionName, info.city]
        .filter((v, i, a) => v && a.indexOf(v) === i);
    return parts.join(" ");
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

/* ---------- 检测并整理成结果模型 ---------- */

async function detect(ctx, policy) {
    const target = policy ? `策略「${policy}」` : "兜底策略";
    const [via, direct] = await Promise.all([
        checkLine(ctx, policy),
        checkLine(ctx, "DIRECT"),
    ]);

    const m = { target, time: clock(), via, direct, advice: "" };

    if (via.ok) {
        m.status = "ok";
        m.title = "出口正常";
        m.short = "正常";
        m.icon = "checkmark.circle.fill";
        m.color = C.good;
    } else if (direct.ok) {
        m.status = "blocked";
        m.title = `经${target}不通`;
        m.short = "不通";
        m.icon = "exclamationmark.triangle.fill";
        m.color = C.warn;
        m.advice = policy
            ? "节点离线、被运营商/GFW 阻断，或策略名填错"
            : "兜底选中的节点离线或被阻断，换个节点再测";
    } else {
        m.status = "down";
        m.title = "本机网络异常";
        m.short = "异常";
        m.icon = "xmark.octagon.fill";
        m.color = C.bad;
        m.advice = "直连也不通，先检查 Wi-Fi / 蜂窝";
    }
    return m;
}

// 通知用的文字行（手动运行时）
function notifyLines(m) {
    const lines = [];
    if (m.status === "ok") {
        const info = m.via.info;
        lines.push(`出口: ${getFlag(info.countryCode)} ${info.query} · ${placeOf(info)}`);
        if (info.isp) lines.push(`运营商: ${info.isp}`);
        lines.push(`耗时: ${m.via.ms}ms`);
    } else if (m.status === "blocked") {
        lines.push(`经${m.target}访问失败（${m.via.ms}ms）`);
        lines.push(`本机直连正常: ${getFlag(m.direct.info.countryCode)} ${m.direct.info.query}${m.direct.info.isp ? " · " + m.direct.info.isp : ""}`);
        lines.push(`可能：${m.advice}`);
    } else {
        lines.push(`经${m.target}失败，本机直连也失败`);
        lines.push(m.advice);
    }
    lines.push(`检测: ${m.target}`);
    return lines;
}

/* ---------- 小组件 DSL（元素写法照参照脚本） ---------- */

function T(text, size, color, weight = "regular", extra = {}) {
    const el = { type: "text", text: String(text), font: { size, weight }, maxLines: 1 };
    if (color) el.textColor = color;
    return { ...el, ...extra };
}

function row(children, extra = {}) {
    return { type: "stack", direction: "row", alignItems: "center", children: children.filter(Boolean), ...extra };
}

function col(children, extra = {}) {
    return { type: "stack", direction: "column", alignItems: "start", children: children.filter(Boolean), ...extra };
}

function spacer(length) {
    return length === undefined ? { type: "spacer" } : { type: "spacer", length };
}

function icon(name, size, color) {
    const el = { type: "image", src: `sf-symbol:${name}`, width: size, height: size };
    if (color) el.color = color;
    return el;
}

function center(child) {
    return row([spacer(), child, spacer()]);
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

function exitLine(m, size) {
    if (m.status !== "ok") return null;
    const info = m.via.info;
    return T(`${getFlag(info.countryCode)} ${info.query}`, size, C.ink, "bold", { minScale: 0.6 });
}

function metaLine(m, size) {
    if (m.status !== "ok") return null;
    const info = m.via.info;
    const text = [placeOf(info), info.isp].filter(Boolean).join(" · ");
    return text ? T(text, size, C.soft, "regular", { minScale: 0.6 }) : null;
}

function footRow(m, size) {
    return row([
        T(`检测：${m.target}`, size, C.faint, "medium", { minScale: 0.7 }),
        spacer(),
        m.status === "ok" ? T(`${m.via.ms}ms`, size, C.faint, "medium") : null,
    ], { gap: 5 });
}

// 顶行照参照效果图：国旗 国家 城市 …… 时间；出口不通时没有出口信息，改放检测目标
function topRow(m, size) {
    if (m.status === "ok") {
        const info = m.via.info;
        return row([
            T(getFlag(info.countryCode), size),
            T(info.country || "", size, C.ink, "semibold"),
            info.city ? T(info.city, size, C.soft, "regular", { minScale: 0.6 }) : null,
            spacer(),
            T(m.time, size - 2, C.faint, "medium"),
        ], { gap: 5 });
    }
    return row([
        T("🌐", size),
        T(m.target, size, C.ink, "semibold"),
        spacer(),
        T(m.time, size - 2, C.faint, "medium"),
    ], { gap: 5 });
}

// 「标签 + 值」一行（照参照脚本 field 的写法）：标签浅灰固定宽，值带 flex 靠左
function fieldRow(label, value, size = 11) {
    return row([
        { type: "stack", direction: "row", width: 34, children: [T(label, size, C.faint, "medium"), spacer()] },
        { ...value, flex: 1 },
    ], { gap: 6 });
}

// 右栏的状态徽：大图标 + 结论词，颜色表达状态（照参照图右侧色条的位置）
function statusBadge(m, iconSize, fontSize) {
    return {
        type: "stack", direction: "column", alignItems: "center",
        children: [
            icon(m.icon, iconSize, m.color),
            spacer(5),
            T(m.title, fontSize, m.color, "semibold", { minScale: 0.6 }),
            m.status === "ok" ? T(`${m.via.ms}ms`, fontSize - 2, C.faint, "medium") : null,
        ].filter(Boolean),
    };
}

// 底行照参照图：左边直连状态（图标着色、文字正文色），右边检测目标
function bottomRow(m, size) {
    const d = m.direct;
    return row([
        icon(d.ok ? "checkmark.seal.fill" : "xmark.seal.fill", size, d.ok ? C.good : C.bad),
        T(d.ok ? "直连正常" : "直连失败", size + 1, C.ink, "medium"),
        spacer(),
        T(m.target, size, C.faint, "medium", { minScale: 0.7 }),
    ], { gap: 4 });
}

// 中号照参照效果图的版式：顶行地区时间；中间左栏大 IP + 标签行，右栏状态徽；底行直连与目标
function mediumWidget(m) {
    const info = m.status === "ok" ? m.via.info : null;
    const left = col([
        info
            ? T(info.query, 20, C.ink, "bold", { minScale: 0.55 })
            : T(m.title, 20, C.ink, "bold", { minScale: 0.6 }),
        spacer(10),
        info
            ? fieldRow("运营商", T(info.isp || "未知", 11, C.ink, "semibold", { minScale: 0.6 }))
            : fieldRow("直连", T(m.direct.ok ? m.direct.info.query : "失败", 11, C.ink, "semibold", { minScale: 0.6 })),
        spacer(6),
        info
            ? fieldRow("出口", T(placeOf(info), 11, C.ink, "semibold", { minScale: 0.6 }))
            : T(m.advice, 11, C.soft, "regular", { maxLines: 2, minScale: 0.7 }),
    ]);
    return root([
        topRow(m, 13),
        spacer(),
        row([{ ...left, flex: 40 }, { ...statusBadge(m, 40, 13), flex: 37 }], { gap: 14, alignItems: "start" }),
        spacer(),
        bottomRow(m, 11),
    ], 14);
}

function smallWidget(m) {
    return root([
        row([icon(m.icon, 16, m.color), T(m.title, 15, C.ink, "bold", { minScale: 0.6 })], { gap: 5 }),
        spacer(8),
        exitLine(m, 13),
        metaLine(m, 11),
        m.status !== "ok" ? T(m.advice, 11, C.soft, "regular", { maxLines: 3, minScale: 0.7 }) : null,
        spacer(),
        footRow(m, 10),
    ], 12);
}

// 大号与中号同版式放大，并把直连明细整行列出
function largeWidget(m) {
    const info = m.status === "ok" ? m.via.info : null;
    const directText = m.direct.ok
        ? `本机直连：${getFlag(m.direct.info.countryCode)} ${m.direct.info.query}${m.direct.info.isp ? " · " + m.direct.info.isp : ""}`
        : "本机直连：失败";
    const left = col([
        info
            ? T(info.query, 24, C.ink, "bold", { minScale: 0.55 })
            : T(m.title, 24, C.ink, "bold", { minScale: 0.6 }),
        spacer(12),
        info ? fieldRow("运营商", T(info.isp || "未知", 13, C.ink, "semibold", { minScale: 0.6 })) : null,
        info ? spacer(7) : null,
        info ? fieldRow("出口", T(placeOf(info), 13, C.ink, "semibold", { minScale: 0.6 })) : null,
        info ? spacer(7) : null,
        info ? fieldRow("耗时", T(`${m.via.ms}ms`, 13, C.ink, "semibold")) : null,
        !info ? T(m.advice, 13, C.soft, "regular", { maxLines: 2, minScale: 0.7 }) : null,
    ]);
    return root([
        topRow(m, 15),
        spacer(),
        row([{ ...left, flex: 40 }, { ...statusBadge(m, 54, 15), flex: 37 }], { gap: 14, alignItems: "start" }),
        spacer(),
        T(directText, 13, C.soft, "regular", { minScale: 0.7 }),
        spacer(8),
        bottomRow(m, 12),
    ], 16);
}

function inlineWidget(m) {
    const ip = m.status === "ok" ? ` ${m.via.info.query}` : "";
    const emoji = m.status === "ok" ? "✅" : m.status === "blocked" ? "⚠️" : "❌";
    return { type: "widget", refreshAfter: refreshAt(), children: [T(`${emoji} ${m.title}${ip}`, 12, null)] };
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
                center(icon(m.icon, 22, null)),
                center(T(m.short, 10, null, "medium")),
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
            row([icon(m.icon, 12, null), T(m.title, 13, null, "semibold", { minScale: 0.6 })], { gap: 4 }),
            m.status === "ok"
                ? T(`${getFlag(m.via.info.countryCode)} ${m.via.info.query}`, 12, null, "regular", { minScale: 0.6 })
                : T(m.advice, 12, null, "regular", { maxLines: 2, minScale: 0.7 }),
            T(`检测：${m.target}`, 11, null, "regular", { minScale: 0.7 }),
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
        status: "down", title: "检测出错", short: "出错",
        icon: "exclamationmark.triangle.fill", color: C.bad,
        target: "兜底策略", time: clock(), advice: String(message || "").slice(0, 60),
        via: { ok: false, ms: 0 }, direct: { ok: false },
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
        console.log("[BLOCK-CHECK] " + m.title + " / " + m.target);
        if (family) return widgetFor(family, m);
        const body = (m.status === "ok" ? "✅ " : m.status === "blocked" ? "⚠️ " : "❌ ")
            + m.title + "\n" + notifyLines(m).join("\n");
        await ctx.notify({ title: "🌐 节点阻断检测", body });
    } catch (error) {
        console.log("[BLOCK-CHECK] ERROR = " + error);
        if (family) return errorWidget(family, error && error.message);
        await ctx.notify({ title: "🌐 节点阻断检测", body: "检测出错：" + error });
    }
}
