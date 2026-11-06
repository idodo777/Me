export default async function(ctx) {
  const url = (ctx.request && ctx.request.url) || "";
  if (url.indexOf("functionId=welcomeHome") !== -1) {
    try { ctx.notify({ title: "京东探针", body: "已掐断 welcomeHome" }); } catch (e) {}
    return ctx.abort();
  }
  return {};
}
