// 吾爱破解 · 每日签到（Egern 原生版）
// 机制：带 Cookie 领取 Discuz 签到任务 home.php?mod=task&do=apply&id=2，按返回文案判读结果；任何结果都发通知。
(async () => {
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
    if (/恭喜|已完成|签到成功/.test(body)) {
      msg = '✅ 签到成功';
    } else if (/下期再来|已经签到|已签到|今日已签/.test(body)) {
      msg = '⚠️ 今天已经签过了';
    } else if (/先登录|需要登录|尚未登录/.test(body)) {
      msg = '❌ Cookie 已失效，重新抓一次';
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
})();
