/*
 * ============================================================
 * 节点阻断检测（Egern 版 v2）
 * ============================================================
 * 思路源自 RavelloH 的 QuanX 脚本 block_check.js（原版同目录存档）：
 * 对比「经代理出口」和「本机直连」两条路，判断当前上网通道是否正常。
 *
 * v2 按 vfelix7「IP 纯净度」模块的模式重写（用户指定参照）：
 * - 零填写可用：什么都不设置时，检测请求不带 policy，跟随 Egern
 *   分流规则，最终走 default 规则的兜底策略 —— 测的就是你当下
 *   实际在用的那个出口。
 * - 唯一参数 POLICY（模块里叫「检测策略」，env_schema 可视化填写）：
 *   填策略组或节点名，只测它；留空测兜底。
 * - v1 要求手填服务器地址/端口供海外探针定位阻断来源，用户认为
 *   还要自己查地址太傻，已去掉；代价：经策略不通时只能给出
 *   「节点离线 / 被阻断 / 策略名填错」几种可能，不再细分
 *   GFW 全局阻断还是运营商拦截。
 *
 * 结论（通知第一行）：
 *   ✅ 出口正常        经出口能通，附出口 IP / 地区 / 运营商
 *   ⚠️ 经策略不通      本机直连正常，是代理这条路的问题
 *   ❌ 本机网络异常    直连也不通，先查本机网络
 * ============================================================
 */

const IP_API = "http://ip-api.com/json?lang=zh-CN";
const TIMEOUT = 8000;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/* ---------- 小工具（旗帜沿用原版写法） ---------- */

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

/* ---------- 主入口（Egern generic，手动触发） ---------- */

export default async function (ctx) {
    const env = ctx.env || {};
    const policy = String(env.POLICY || "").trim();
    const target = policy ? `策略「${policy}」` : "兜底策略";

    try {
        const [via, direct] = await Promise.all([
            checkLine(ctx, policy),
            checkLine(ctx, "DIRECT"),
        ]);

        let conclusion;
        const lines = [];

        if (via.ok) {
            conclusion = "✅ 出口正常";
            const info = via.info;
            lines.push(`出口: ${getFlag(info.countryCode)} ${info.query} · ${placeOf(info)}`);
            if (info.isp) lines.push(`运营商: ${info.isp}`);
            lines.push(`耗时: ${via.ms}ms`);
        } else if (direct.ok) {
            conclusion = `⚠️ 经${target}不通`;
            lines.push(`经${target}访问失败（${via.ms}ms）`);
            lines.push(`本机直连正常: ${getFlag(direct.info.countryCode)} ${direct.info.query}${direct.info.isp ? " · " + direct.info.isp : ""}`);
            lines.push(policy
                ? "可能：节点离线、被运营商/GFW 阻断，或策略名填错"
                : "可能：兜底策略选中的节点离线或被阻断，去策略组里换个节点再测");
        } else {
            conclusion = "❌ 本机网络异常";
            lines.push(`经${target}失败，本机直连也失败`);
            lines.push("先检查本机网络（Wi-Fi / 蜂窝）再重试");
        }

        lines.push(`检测: ${target}`);
        const body = conclusion + "\n" + lines.join("\n");
        console.log("[BLOCK-CHECK]\n" + body);
        await ctx.notify({ title: "🌐 节点阻断检测", body });
    } catch (error) {
        console.log("[BLOCK-CHECK] ERROR = " + error);
        await ctx.notify({ title: "🌐 节点阻断检测", body: "检测出错：" + error });
    }
}
