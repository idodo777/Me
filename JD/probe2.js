// 回传验证探针：与京东 App 无关，只验证 Egern 是否采用脚本回传的 body。
// example.com -> 回传字符串；example.org -> 回传对象。两者都发通知证明脚本运行过。
export default async function (ctx) {
  const url = ctx.request.url;
  try {
    if (url.includes("example.com")) {
      try { ctx.notify({ title: "探针2·字符串", body: "已运行并回传字符串 body" }); } catch (e) {}
      return { body: "EGERN-STRING-BODY-APPLIED" };
    }
    if (url.includes("example.org")) {
      try { ctx.notify({ title: "探针2·对象", body: "已运行并回传对象 body" }); } catch (e) {}
      return { body: { egern: "EGERN-OBJECT-BODY-APPLIED" } };
    }
  } catch (e) {}
  return;
}
