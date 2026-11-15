// 吾爱破解 · 每日签到（Egern 原生版 v4）
// 机制：带完整 Cookie 领取 Discuz 签到任务 home.php?mod=task&do=apply&id=2，按返回文案判读结果；任何结果都发通知。
// 注意：Cookie 必须原样全发——站点防护会在浏览器里写验证 Cookie，只发 _auth/_saltkey 会被防护直接 400 拦掉（上游脚本的过滤写法已实锤 400）。
// 另：签到接口受站点防护（waf_zw_verify）保护，撞上验证页/400 时按通知里的办法在浏览器里过验证后重新抓 Cookie。
export default async function (ctx) {
  const TITLE = '吾爱破解签到';
  try {
    const ck = ctx.storage.get('wuai_cookie');
    if (!ck || !String(ck).includes('_auth=')) {
      ctx.notify({ title: TITLE, body: '❌ 还没有可用的 Cookie：打开模块的抓取开关，去吾爱破解刷新一次主页，抓到后再关掉开关' });
      return;
    }
    const resp = await ctx.http.get('https://www.52pojie.cn/home.php?mod=task&do=apply&id=2', {
      headers: {
        'Cookie': String(ck),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:101.0) Gecko/20100101 Firefox/101.0',
        'Referer': 'https://www.52pojie.cn/home.php'
      },
      timeout: 30000
    });
    const body = await resp.text();
    let msg;
    if (/waf_zw_verify|zw_verify/.test(body)) {
      msg = '🛡️ 站点弹了人机验证（waf）：去浏览器打开吾爱破解过一次验证，再开抓取开关刷新主页重新抓 Cookie，之后定时签到才会通';
    } else if (/暂停签到|开放注册/.test(body)) {
      msg = '⏸️ 吾爱开放注册期间暂停签到，站点恢复后会自动继续，不用管';
    } else if (/恭喜|已完成|签到成功/.test(body)) {
      msg = '✅ 签到成功';
    } else if (/下期再来|已经签到|已签到|今日已签/.test(body)) {
      msg = '⚠️ 今天已经签过了';
    } else if (/先登录|需要登录|尚未登录/.test(body)) {
      msg = '❌ Cookie 已失效，重新抓一次';
    } else if (resp.status === 400) {
      msg = '🛡️ 请求被站点防护拦了（400）：去浏览器打开吾爱破解，确认能正常打开、过掉验证，再开抓取开关刷新主页重新抓 Cookie';
    } else if (resp.status === 403) {
      msg = '⚠️ 服务器暂停签到（403）';
    } else {
      const snippet = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      msg = '❓ 服务器返回未识别（HTTP ' + resp.status + '）：' + snippet;
    }
    ctx.notify({ title: TITLE, body: msg });
  } catch (e) {
    ctx.notify({ title: TITLE, body: '❌ 签到出错：' + (e && e.message ? e.message : String(e)) });
  }
}
