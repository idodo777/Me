export default async function (ctx) {
    console.log("[JD-PROBE] script executed for " + ctx.request.url);
    try {
        ctx.notify("京东脚本探针", "脚本引擎正常，已执行");
    } catch (e) {}
    return;
}
