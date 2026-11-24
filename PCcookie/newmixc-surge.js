// newmixc · Cookie 抓取（Surge 版）
// 原作: MaYIHEI
// 上游来源: https://raw.githubusercontent.com/MaYIHEI/paperclip/refs/heads/main/app/newmixc/newmixc.cookie.js
// 上游更新日期: 2026-05-23
// 转换说明: 由 Egern 版 newmixc.js 转换而来。上游脚本逻辑原样保留，仅去掉 Egern 的
//   export default / ctx 环境桥；Surge 原生提供 $request/$response/$persistentStore/$httpClient/
//   $notification/$environment/$argument/$done，Env 类会自动识别 Surge 环境。
//   开关（NEWMIXC）由模块 [Script] 的 argument 字段传入（k=v 形式），开头解析后判断，
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
  // NEWMIXC 开关关闭时直接放行（http-request/http-response 均原样透传），不抓 Cookie、不通知
  if (__arg.NEWMIXC === "false") { $done({}); return; }

  // ---------- 上游脚本（原样） ----------
const $ = new Env("一点万象 [Cookie]");

const CK_KEY = 'newmixc_data';

(function main() {
    if (!$request) {
        $.log('[ERROR] 该脚本仅作为 http-request 重写脚本运行');
        $.done();
        return;
    }
    if ($request.method === 'OPTIONS') {
        $.done();
        return;
    }

    try {
        const url = $request.url;
        // 从 URL query 抠所有需要的字段
        const need = ['token', 'mallNo', 'imei', 'deviceParams', 'appVersion', 'osVersion'];
        const got = {};
        for (const k of need) {
            const m = url.match(new RegExp('[?&]' + k + '=([^&]+)'));
            if (m) got[k] = decodeURIComponent(m[1]);
        }

        const missing = need.filter(k => !got[k]);
        if (missing.length) {
            $.log(`[WARN] 缺字段: ${missing.join(',')}`);
            $.done();
            return;
        }

        // 解 deviceParams 拿手机号(显示用)
        let phone = '';
        try {
            const dpJson = JSON.parse(decodeBase64(got.deviceParams));
            phone = dpJson.phone || '';
        } catch (e) {
            $.log('[WARN] deviceParams 解析失败: ' + e);
        }

        const data = {
            token: got.token,
            mallNo: got.mallNo,
            imei: got.imei,
            deviceParams: got.deviceParams,
            appVersion: got.appVersion,
            osVersion: got.osVersion,
            phone: phone,
        };

        const old = $.getdata(CK_KEY) || '';
        if (old) {
            try {
                const oldObj = JSON.parse(old);
                if (oldObj.token === data.token && oldObj.mallNo === data.mallNo) {
                    $.log('[INFO] Token 未变,跳过更新');
                    $.done();
                    return;
                }
            } catch (e) {}
        }

        $.setdata(JSON.stringify(data), CK_KEY);
        $.log(`[INFO] 已更新 token, phone=${maskPhone(phone)}, mallNo=${data.mallNo}`);
        $.setdata('', 'newmixc_status'); // 新 Cookie 待签到验证,先撤掉旧的体检结果
        $.msg('一点万象', '✅ 一点万象 Cookie 获取成功', `账号 ${maskPhone(phone)} · 商场 ${data.mallNo}`);
    } catch (e) {
        $.log('[ERROR] cookie 抓取失败: ' + e);
    }

    $.done();
})();

function maskPhone(p) {
    if (!p || p.length !== 11) return p || '未知';
    return p.slice(0, 3) + '****' + p.slice(7);
}

function decodeBase64(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(s, 'base64').toString('utf-8');
    }
    // 浏览器/QX 环境 atob
    return decodeURIComponent(escape(atob(s)));
}

function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== 'undefined';
    this.isQuanX = () => typeof $task !== 'undefined';
    this.isLoon = () => typeof $loon !== 'undefined';
    this.log = (...a) => console.log(a.join('\n'));
    this.msg = (t = this.name, s = '', b = '') => {
        if (this.isSurge() || this.isLoon()) $notification.post(t, s, b);
        else if (this.isQuanX()) $notify(t, s, b);
        console.log(['', '====📣' + t + '====', s, b].filter(Boolean).join('\n'));
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
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}
})();
