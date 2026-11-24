// nodeseek · Cookie 抓取（Surge 版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/nodeseek/nodeseek.cookie.js
// 上游更新日期: 2026-10-16
// 转换说明: 由 Egern 版 nodeseek.js 转换而来。上游脚本逻辑原样保留，仅去掉 Egern 的
//   export default / ctx 环境桥；Surge 原生提供 $request/$response/$persistentStore/$httpClient/
//   $notification/$environment/$argument/$done，Env 类会自动识别 Surge 环境。
//   开关（NODESEEK）由模块 [Script] 的 argument 字段传入（k=v 形式），开头解析后判断，
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
  // NODESEEK 开关关闭时直接放行（http-request/http-response 均原样透传），不抓 Cookie、不通知
  if (__arg.NODESEEK === "false") { $done({}); return; }

  // ---------- 上游脚本（原样） ----------
const $ = new Env("NodeSeek [Cookie]");

const CK_KEY = "nodeseek_cookie";
const UA_KEY = "nodeseek_ua";

(function main() {
    const cookie = ($request.headers["Cookie"] || $request.headers["cookie"] || "").trim();
    if (!cookie.includes("pjwt")) {
        $.done(); return;
    }

    const ua      = ($request.headers["User-Agent"] || $request.headers["user-agent"] || "").trim();
    const old     = $.getdata(CK_KEY) || "";
    const oldPjwt = (old.match(/pjwt=([^;]+)/)    || [])[1] || "";
    const newPjwt = (cookie.match(/pjwt=([^;]+)/) || [])[1] || "";

    // 签到请求要和浏览器用同一个 UA + Cookie,有变化就跟随保存
    if (ua && ua !== $.getdata(UA_KEY)) $.setdata(ua, UA_KEY);
    if (cookie !== old) $.setdata(cookie, CK_KEY);

    // pjwt 未变则静默,避免每次刷页都弹通知
    if (oldPjwt === newPjwt) {
        $.done(); return;
    }

    $.setdata("", "nodeseek_status"); // 新 Cookie 待签到验证,先撤掉旧的体检结果
    $.msg("NodeSeek", "✅ NodeSeek Cookie 获取成功", "");
    $.done();
})();

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
