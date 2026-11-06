export default async function (ctx) {
    try {
        ctx.notify({ title: "京东脚本探针", body: "脚本引擎正常，已执行" });
    } catch (e) {}
    return;
}
