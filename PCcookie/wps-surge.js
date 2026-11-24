// wps · Cookie 抓取（Surge 版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/wps/wps.cookie.js
// 上游更新日期: 2026-06-19
// 转换说明: 由 Egern 版 wps.js 转换而来。上游脚本逻辑原样保留，仅去掉 Egern 的
//   export default / ctx 环境桥；Surge 原生提供 $request/$response/$persistentStore/$httpClient/
//   $notification/$environment/$argument/$done，Env 类会自动识别 Surge 环境。
//   开关（WPS）由模块 [Script] 的 argument 字段传入（k=v 形式），开头解析后判断，
//   关闭时直接 $done({}) 放行，不抓 Cookie、不通知。
(async function main() {
  // ---------- Surge 参数解析与开关判断 ----------
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
  // WPS 开关关闭时直接放行（http-request/http-response 均原样透传），不抓 Cookie、不通知
  if (__arg.WPS === "false") { $done({}); return; }

  // ---------- 上游脚本（原样） ----------
const $ = new Env("WPS [Cookie]");

const CK_KEY = "wps_sid"; // 只存 wps_sid 这一个长效登录态(activity 接口认 wps_sids,值与 wps_sid 相同)

(function main() {
    if (typeof $request === "undefined") {
        $.log("[ERROR] 该脚本仅作为 http-request 重写脚本运行");
        $.done();
        return;
    }
    if ($request.method === "OPTIONS") {
        $.done();
        return;
    }

    try {
        // page_info 请求头里带整套 cookie,从中只取 wps_sid(域 wps.cn 的持久登录态,不轮换、无需刷新)
        const cookie = ($request.headers["Cookie"] || $request.headers["cookie"] || "");
        const m = cookie.match(/(?:^|;\s*)wps_sids?=([^;]+)/);
        if (!m) {
            $.log("[WARN] 请求头里没找到 wps_sid,可能该请求未带登录态,换个活动页重试");
            $.done();
            return;
        }
        const sid = m[1];

        const old = $.getdata(CK_KEY) || "";
        if (old === sid) {
            $.log("[INFO] wps_sid 未变,跳过更新");
            $.done();
            return;
        }

        $.setdata(sid, CK_KEY);
        $.log(`[INFO] 已更新 wps_sid (${maskSid(sid)})`);
        $.setdata("", "wps_status"); // 新 Cookie 待签到验证,先撤掉旧的体检结果
        $.msg("WPS", "✅ WPS Cookie 获取成功", "可去签到脚本验证");
    } catch (e) {
        $.log("[ERROR] cookie 抓取失败: " + e);
    }

    $.done();
})();

function maskSid(s) {
    if (!s || s.length < 12) return "已获取";
    return s.slice(0, 6) + "***" + s.slice(-4);
}

function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== "undefined";
    this.isQuanX = () => typeof $task !== "undefined";
    this.isLoon = () => typeof $loon !== "undefined";
    this.log = (...a) => console.log(a.join("\n"));
    this.msg = (t = this.name, s = "", b = "") => {
        if (this.isSurge() || this.isLoon()) $notification.post(t, s, b);
        else if (this.isQuanX()) $notify(t, s, b);
        console.log(["", "====📣" + t + "====", s, b].filter(Boolean).join("\n"));
    };
    this.getdata = (k) => {
        if (this.isSurge() || this.isLoon()) return $persistentStore.read(k);
        if (this.isQuanX()) return $prefs.valueForKey(k);
        return null;
    };
    this.setdata = (v, k) => {
        if (this.isSurge() || this.isLoon()) return $persistentStore.write(v, k);
        if (this.isQuanX()) return $prefs.setValueForKey(v, k);
        return false;
    };
    this.done = (v = {}) => { if (typeof $done !== "undefined") $done(v); };
}
})();
