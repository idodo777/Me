// ======================================================
// 浦大喜奔开屏广告尺寸拦截（Egern 版）
//
// 目标：
// 仅拦截实际分辨率为 1125 x 1931 的图片。
// 该尺寸是浦大喜奔服务器下发的开屏图实际像素（2026-11-05 清缓存抓包实测，
// 与手机型号/屏幕分辨率无关，服务器对所有设备下发同一尺寸）。
//
// 支持：
// JPEG / JPG / PNG / GIF
//
// 其他尺寸、其他格式全部放行；任何异常一律放行（fail-open）。
//
// 必须配合（已在模块的 scripting 条目中设置）：
// body_required = true
// binary_body = true
// ======================================================

const TARGET_WIDTH = 1125;
const TARGET_HEIGHT = 1931;


// ==========================
// 读取大端 32 位整数
// ==========================

function readBE32(bytes, offset) {
    return (
        ((bytes[offset] << 24) >>> 0) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]
    ) >>> 0;
}


// ==========================
// PNG
// ==========================

function getPNGSize(bytes) {

    if (bytes.length < 24) {
        return null;
    }

    const isPNG =
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4E &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0D &&
        bytes[5] === 0x0A &&
        bytes[6] === 0x1A &&
        bytes[7] === 0x0A;

    if (!isPNG) {
        return null;
    }

    return {
        type: "PNG",
        width: readBE32(bytes, 16),
        height: readBE32(bytes, 20)
    };
}


// ==========================
// GIF
// ==========================

function getGIFSize(bytes) {

    if (bytes.length < 10) {
        return null;
    }

    const isGIF =
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61;

    if (!isGIF) {
        return null;
    }

    return {
        type: "GIF",
        width: bytes[6] | (bytes[7] << 8),
        height: bytes[8] | (bytes[9] << 8)
    };
}


// ==========================
// JPEG / JPG
// ==========================

function getJPEGSize(bytes) {

    if (
        bytes.length < 4 ||
        bytes[0] !== 0xFF ||
        bytes[1] !== 0xD8
    ) {
        return null;
    }

    let pos = 2;

    while (pos + 8 < bytes.length) {

        if (bytes[pos] !== 0xFF) {
            pos++;
            continue;
        }

        while (
            pos < bytes.length &&
            bytes[pos] === 0xFF
        ) {
            pos++;
        }

        if (pos >= bytes.length) {
            break;
        }

        const marker = bytes[pos++];

        // 无长度字段的 Marker
        if (
            marker === 0xD8 ||
            marker === 0xD9 ||
            marker === 0x01 ||
            (marker >= 0xD0 && marker <= 0xD7)
        ) {
            continue;
        }

        if (pos + 1 >= bytes.length) {
            break;
        }

        const segmentLength =
            (bytes[pos] << 8) |
            bytes[pos + 1];

        if (
            segmentLength < 2 ||
            pos + segmentLength > bytes.length
        ) {
            break;
        }

        const isSOF =
            marker === 0xC0 ||
            marker === 0xC1 ||
            marker === 0xC2 ||
            marker === 0xC3 ||
            marker === 0xC5 ||
            marker === 0xC6 ||
            marker === 0xC7 ||
            marker === 0xC9 ||
            marker === 0xCA ||
            marker === 0xCB ||
            marker === 0xCD ||
            marker === 0xCE ||
            marker === 0xCF;

        if (isSOF && segmentLength >= 7) {

            const height =
                (bytes[pos + 3] << 8) |
                bytes[pos + 4];

            const width =
                (bytes[pos + 5] << 8) |
                bytes[pos + 6];

            return {
                type: "JPEG",
                width: width,
                height: height
            };
        }

        pos += segmentLength;
    }

    return null;
}


// ==========================
// 主逻辑（Egern http_response）
// ==========================

export default async function (ctx) {

    try {

        console.log("[SPDB] =========================");
        console.log("[SPDB] 脚本进入");
        console.log("[SPDB] URL = " + ctx.request.url);

        const buf = await ctx.response.arrayBuffer();

        if (!buf || buf.byteLength === 0) {

            console.log("[SPDB] Body 为空 → 放行");
            return;

        }

        const body = new Uint8Array(buf);

        console.log("[SPDB] Body 大小 = " + body.length + " bytes");

        const info =
            getPNGSize(body) ||
            getGIFSize(body) ||
            getJPEGSize(body);

        if (!info) {

            console.log("[SPDB] 未识别图片格式 → 放行");
            return;

        }

        console.log(
            "[SPDB] 图片 = " +
            info.type +
            " " +
            info.width +
            "x" +
            info.height
        );

        if (
            info.width === TARGET_WIDTH &&
            info.height === TARGET_HEIGHT
        ) {

            console.log(
                "[SPDB] ★★★ 命中开屏广告 " +
                TARGET_WIDTH +
                "x" +
                TARGET_HEIGHT +
                " → HARD DROP ★★★"
            );

            // 直接终止响应，不向 App 返回原始广告图片
            return ctx.abort();

        }

        console.log(
            "[SPDB] 正常图片 " +
            info.width +
            "x" +
            info.height +
            " → 放行"
        );

        return;

    } catch (error) {

        console.log("[SPDB] ❌ ERROR = " + error);

        // 出错默认放行
        return;

    }
}
