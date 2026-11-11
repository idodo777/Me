// 吾爱破解 · 抓取 Cookie（Egern 原生版）
// 命中 home.php 请求时读取 Cookie 头，含 _auth 才保存；抓到后请关掉模块里的抓取开关。
(() => {
  try {
    const ck = ctx.request.headers.get('cookie') || '';
    if (ck && ck.includes('_auth=')) {
      const old = ctx.storage.get('wuai_cookie');
      if (old !== ck) ctx.storage.set('wuai_cookie', ck);
      const last = Number(ctx.storage.get('wuai_ck_time') || 0);
      const now = Date.now();
      if (old !== ck || now - last >= 6 * 3600 * 1000) {
        ctx.storage.set('wuai_ck_time', String(now));
        ctx.notify({ title: '吾爱破解', body: '✅ Cookie 抓取成功，可以关掉抓取开关了' });
      }
    }
  } catch (e) {}
})();
