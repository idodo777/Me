// 节点阻断检测（Surge 版，v6.0）
// 原作者：RavelloH（https://github.com/RavelloH）
// 原版：Quantumult X event-interaction 脚本 block_check.js
// Egern 版：blockcheck/block_check_egern.js?v=60（generic 脚本 block-check，update_interval 300、timeout 30，配 1 个 widgets）
// 转换说明：由 Egern 版转换而来，检测逻辑原样保留，仅去掉 Egern 的
//   export default / ctx 环境桥，改接 Surge 原生 API：
//   - ctx.http.get(url, {timeout, headers, policy}) → $httpClient.get（见 surgeGet；
//     timeout 由毫秒换算成秒，policy 原样传给 $httpClient 的 policy 选项，
//     Egern 的 redirect:"manual" 对应 auto-redirect:false）
//   - ctx.env.POLICY → 模块 [Script] 的 argument 字段传入（k=v 形式），开头解析 $argument
//   - ctx.notify({title, body}) → $notification.post(title, "", body)（仅手动运行时发通知）
//   - ctx.widgetFamily 与整段 Egern 小组件 DSL（T/row/col/card/widgetFor 等约 200 行）已删：
//     Surge 没有 WidgetKit 小组件，与之最接近的是 Information Panel（[Panel] 段 +
//     脚本 $done({title, content, style})），本模块按任务要求不写 [Panel]/[Widget] 段；
//     脚本在被面板调用时（$input.purpose === "panel" 或 $trigger 为 auto-interval/button）
//     用 $done({title, content, style}) 返回面板内容，不发通知；手动运行时发通知。
//   - Egern 的 refreshAfter（10 分钟）无对应物：Surge 里刷新间隔由 [Panel] 的
//     update-interval 控制，本模块未写 [Panel] 段，故不带刷新语义。
// 检测逻辑（v6.0，节点出站方向）：当前节点（POLICY 指定，或留空走默认路由）
//   能不能访问指定国家、延迟多少。1) 经策略访问 ip-api.com 查出口；
//   2) 本机直连 ip-api.com 排除本机断网；3) 经同一策略依次请求日本、美国、英国、
//   德国、韩国、新加坡的 Google generate_204，逐国给延迟；失败或超时即「中断」。
// 注意（待实测）：
//   - POLICY 留空时 $httpClient 不带 policy 选项，走 Surge 默认出站；Surge 手册未明说
//     这是否等价于 Egern 的「留空按分流规则（兜底策略）」，需实测确认测到的是哪个出口。
//   - checkDirect 用 policy:"DIRECT"；DIRECT 是 Surge 内置策略名，但手册只说 policy
//     须是「已存在的策略名」，DIRECT 能否这样传未经实测；若被拒，回调走 error，
//     本机网络会被误判为异常（结论变「本机网络异常」）。
//   - POLICY 若指向外部策略组（policy-path）的成员名，按名字引用不到，须用其 identifier
//     作 policy 选项（手册 HTTP API 章）；常规策略组名/单节点名可直接用。
//   - 小组件：Egern 的 systemSmall/Medium/Large 与 accessory 三种渲染在 Surge 里
//     不存在，面板内容为纯文本（panelLines），样式只有 good/info/alert/error 四档。

const IP_API = "http://ip-api.com/json?lang=zh-CN";
const TIMEOUT_MS = 8000;
const TIMEOUT_S = 8; // Surge $httpClient 的 timeout 单位是秒（Egern 是毫秒）
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

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

/* ---------- Surge HTTP 桥（替代 ctx.http.get） ---------- */

// 把回调式 $httpClient.get 包成 Promise。成功回调即视为「拿到响应」
// （与 Egern 语义一致：不抛错 = 可达；HTTP 状态码本身不判失败，
// generate_204 固定返回 204）。网络失败 / 超时 / 策略名不存在时回调带 error。
function surgeGet(url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
        const o = {
            url: url,
            headers: opts.headers || {},
            timeout: TIMEOUT_S,
        };
        if (opts.policy) o.policy = opts.policy;
        if (opts.autoRedirect === false) o["auto-redirect"] = false;
        $httpClient.get(o, (error, response, data) => {
            if (error) {
                reject(new Error(error));
                return;
            }
            resolve({ status: response && response.status, body: data });
        });
    });
}

/* ---------- 检测 ---------- */

// 节点代理：policy 为空时不带 policy 选项 —— Surge 走默认出站
// （是否等价于 Egern 的「跟随分流规则/兜底策略」未经实测，见文件头注意）
async function checkVia(policy) {
    const options = { headers: { "User-Agent": UA } };
    if (policy) options.policy = policy;
    try {
        const res = await surgeGet(IP_API, options);
        const data = JSON.parse(res.body);
        if (!data || data.status === "fail" || !data.query) return { ok: false };
        return { ok: true, info: data };
    } catch (e) {
        return { ok: false };
    }
}

async function checkDirect() {
    try {
        const res = await surgeGet(IP_API, { headers: { "User-Agent": UA }, policy: "DIRECT" });
        const data = JSON.parse(res.body);
        if (!data || data.status === "fail" || !data.query) return { ok: false };
        return { ok: true, info: data };
    } catch (e) {
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
async function probeCountry(policy, c) {
    const options = { headers: { "User-Agent": UA }, autoRedirect: false };
    if (policy) options.policy = policy;
    const t0 = Date.now();
    try {
        await surgeGet(c.url, options);
        return { cc: c.cc, name: c.name, flag: getFlag(c.cc), ok: true, ms: formatMs(Date.now() - t0) };
    } catch (e) {
        return { cc: c.cc, name: c.name, flag: getFlag(c.cc), ok: false, ms: "中断" };
    }
}

async function detect(cfg) {
    const target = cfg.policy ? `策略「${cfg.policy}」` : "兜底策略";

    // 三路并行：经节点查出口、直连查本机、经节点测六国
    const [via, direct, items] = await Promise.all([
        checkVia(cfg.policy),
        checkDirect(),
        Promise.all(PROBE_COUNTRIES.map((c) => probeCountry(cfg.policy, c))),
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

/* ---------- 面板文字（通知与面板内容共用） ---------- */

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

// 面板样式（Surge Information Panel 四档）：正常 good、部分中断 alert、其余 error
function panelStyle(m) {
    if (!m.via.ok || !m.direct.ok) return "error";
    if (m.remote && m.remote.allOk) return "good";
    if (m.remote && m.remote.anyOk) return "alert";
    return "error";
}

/* ---------- 主入口 ---------- */

(async function main() {
    // ---------- Surge 参数解析 ----------
    // $argument 是字符串 "k=v&k=v" 形式（见 SURGE-FORMAT.md §8.4）
    function __parseArg(s) {
        const o = {};
        if (typeof s === "string") {
            s.split("&").forEach((kv) => {
                const i = kv.indexOf("=");
                if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
            });
        } else if (s && typeof s === "object") Object.assign(o, s);
        return o;
    }
    const __arg = __parseArg(typeof $argument !== "undefined" ? $argument : "");
    const cfg = {
        policy: String(__arg.POLICY || "").trim(),
    };

    // 面板调用时（$input.purpose === "panel"，或 $trigger 为 auto-interval/button）
    // 返回面板内容、不发通知，避免面板自动刷新时反复弹通知；手动运行则发通知。
    let isPanel = false;
    try {
        if (typeof $input !== "undefined" && $input && $input.purpose === "panel") isPanel = true;
        if (typeof $trigger !== "undefined" && ($trigger === "auto-interval" || $trigger === "button")) isPanel = true;
    } catch (e) {}

    function finish(title, content, style) {
        if (isPanel) {
            $done({ title: title, content: content, style: style });
        } else {
            $notification.post(title, "", content);
            $done({});
        }
    }

    try {
        const m = await detect(cfg);
        const content = panelLines(m).join("\n");
        console.log("[BLOCK-CHECK]\n" + content);
        finish("🌐 节点阻断检测 " + m.time, content, panelStyle(m));
    } catch (error) {
        console.log("[BLOCK-CHECK] ERROR = " + error);
        finish("🌐 节点阻断检测", "🛑 检测出错：" + error, "error");
    }
})();
