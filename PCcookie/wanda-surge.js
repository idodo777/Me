// wanda · Cookie 抓取（Surge 版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/wanda/wanda.cookie.js
// 上游更新日期: 2026-10-19
// 转换说明: 由 Egern 版 wanda.js 转换而来。上游脚本逻辑原样保留，仅去掉 Egern 的
//   export default / ctx 环境桥；Surge 原生提供 $request/$response/$persistentStore/$httpClient/
//   $notification/$environment/$argument/$done，Env 类会自动识别 Surge 环境。
//   开关（WANDA）由模块 [Script] 的 argument 字段传入（k=v 形式），开头解析后判断，
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
  // WANDA 开关关闭时直接放行（http-request/http-response 均原样透传），不抓 Cookie、不通知
  if (__arg.WANDA === "false") { $done({}); return; }

  // ---------- 上游脚本（原样） ----------
const $ = new Env('万达电影 [Cookie]');

const CK_KEY = 'wanda_data';

(function main() {
    if (typeof $request === 'undefined' || !$request) {
        $.log('[ERROR] 该脚本仅作为 http-request 重写脚本运行');
        $.done();
        return;
    }
    if ($request.method === 'OPTIONS') { $.done(); return; }

    try {
        // Loon 的 header key 可能大小写不一,统一小写后取
        const h = {};
        for (const k in $request.headers) h[k.toLowerCase()] = $request.headers[k];

        const token = h['x-ry-token'];
        const user = h['x-ry-user'];
        const shumei = h['shumeiboxid'] || '';

        if (!token || !user) {
            $.log(`[WARN] 缺鉴权头 token=${!!token} user=${!!user},换个页面再试`);
            $.done();
            return;
        }

        const dev = {
            ua: h['user-agent'], model: h['x-ry-model'],
            sysVer: h['x-ry-system-ver'], ver: h['x-ry-version'],
        };
        const data = { token, user, shumei, dev };

        // token 没变就不重复通知,设备信息有变时静默更新
        const old = $.getdata(CK_KEY);
        if (old) {
            try {
                const o = JSON.parse(old);
                if (o.token === token && o.user === user) {
                    if (JSON.stringify(o.dev) !== JSON.stringify(dev) || o.shumei !== shumei) {
                        $.setdata(JSON.stringify(data), CK_KEY);
                        $.log('[INFO] token 未变,已更新设备信息');
                    } else {
                        $.log('[INFO] token 未变,跳过更新');
                    }
                    $.done();
                    return;
                }
            } catch (e) {}
        }

        $.setdata(JSON.stringify(data), CK_KEY);
        $.log(`[INFO] 已更新 token, user=${mask(user)}`);
        $.setdata('', 'wanda_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
        $.msg('万达电影', '✅ 万达电影 Cookie 获取成功', `账号 ${mask(user)}`);
    } catch (e) {
        $.log('[ERROR] cookie 抓取失败: ' + e);
    }

    $.done();
})();

function mask(s) {
    if (!s) return '未知';
    if (s.length <= 4) return s;
    return s.slice(0, 2) + '****' + s.slice(-2);
}

// @Chavy Env
function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== 'undefined';
    this.isQuanX = () => typeof $task !== 'undefined';
    this.isLoon = () => typeof $loon !== 'undefined';
    this.log = (...a) => console.log(a.join('\n'));
    this.msg = (t = this.name, s = '', b = '') => {
        if (typeof $notification !== 'undefined') $notification.post(t, s, b);
        else if (this.isQuanX()) $notify(t, s, b);
        console.log(['', '====📣' + t + '====', s, b].filter(Boolean).join('\n'));
    };
    this.getdata = (k) => {
        if (typeof $persistentStore !== 'undefined') return $persistentStore.read(k);
        if (this.isQuanX()) return $prefs.valueForKey(k);
        return null;
    };
    this.setdata = (v, k) => {
        if (typeof $persistentStore !== 'undefined') return $persistentStore.write(v, k);
        if (this.isQuanX()) return $prefs.setValueForKey(v, k);
        return false;
    };
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}
})();
