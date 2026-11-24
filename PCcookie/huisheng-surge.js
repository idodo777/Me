// huisheng · Cookie 抓取（Surge 版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/miniprogram/huisheng/huisheng.cookie.js
// 上游更新日期: 2026-05-18
// 转换说明: 由 Egern 版 huisheng.js 转换而来。上游脚本逻辑原样保留，仅去掉 Egern 的
//   export default / ctx 环境桥；Surge 原生提供 $request/$response/$persistentStore/$httpClient/
//   $notification/$environment/$argument/$done，Env 类会自动识别 Surge 环境。
//   开关（HUISHENG）由模块 [Script] 的 argument 字段传入（k=v 形式），开头解析后判断，
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
  // HUISHENG 开关关闭时直接放行（http-request/http-response 均原样透传），不抓 Cookie、不通知
  if (__arg.HUISHENG === "false") { $done({}); return; }

  // ---------- 上游脚本（原样） ----------
const $ = new Env("惠省 [Cookie]");

const KEY_HEADERS = 'huisheng_headers';
const KEY_LIST_BODY = 'huisheng_list_body';

(function main() {
    if (!$request) { $.log('[ERROR] 仅作为 http-request 重写脚本运行'); $.done(); return; }
    if ($request.method === 'OPTIONS') { $.done(); return; }

    try {
        const headers = $request.headers || {};
        let body = $request.body || '';

        // 保存
        const okH = $.setdata(JSON.stringify(headers), KEY_HEADERS);
        let okB = true;
        if (body && body.length > 10) okB = $.setdata(body, KEY_LIST_BODY);

        // 读回校验
        const verifyH = ($.getdata(KEY_HEADERS) || '').length;
        const verifyB = ($.getdata(KEY_LIST_BODY) || '').length;

        $.log(`[OK] headers ${Object.keys(headers).length} 个,body ${body.length} 字符;写入返回 H=${okH} B=${okB};读回验证 H=${verifyH} B=${verifyB}`);

        if (verifyH > 0 && verifyB > 0) {
            $.setdata('', 'huisheng_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
            $.msg('惠省', '✅ 惠省 Cookie 获取成功', `headers ${verifyH} 字符 / body ${verifyB} 字符\n可关闭本脚本,主脚本可跑`);
        } else {
            $.msg('惠省', '⚠️ 写入异常', `存储读回为空 (H=${verifyH} B=${verifyB})\n检查 Loon 持久化存储权限`);
        }
    } catch (e) {
        $.log('[ERROR] ' + e);
        $.msg('惠省', '❌ 抓取异常', String(e));
    }
    $.done();
})();


function Env(s) {
    this.name = s;
    // 注意:Loon http-request 重写脚本里 $httpClient 是 undefined,只有 $persistentStore / $notification / $done
    // 所以用 $persistentStore 判断存储能力,而不是 $httpClient
    this.hasStore = () => typeof $persistentStore !== 'undefined';
    this.isQuanX = () => typeof $prefs !== 'undefined';
    this.log = (...a) => console.log(a.join('\n'));
    this.msg = (t = this.name, s = '', b = '') => {
        if (typeof $notification !== 'undefined') $notification.post(t, s, b);
        else if (typeof $notify !== 'undefined') $notify(t, s, b);
        console.log(['', '====📣' + t + '====', s, b].filter(Boolean).join('\n'));
    };
    this.getdata = (k) => {
        if (this.hasStore()) return $persistentStore.read(k);
        if (this.isQuanX()) return $prefs.valueForKey(k);
        return null;
    };
    this.setdata = (v, k) => {
        if (this.hasStore()) return $persistentStore.write(v, k);
        if (this.isQuanX()) return $prefs.setValueForKey(v, k);
        return false;
    };
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}
})();
