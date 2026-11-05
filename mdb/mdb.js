/*
* ============================================================
* 买单吧开屏广告拦截（Egern 版，由 Loon 版转换）
* ============================================================
*
* 已验证素材尺寸（抓包确认，iPhone 17）：
* 1242 × 2688 —— 这是广告图片素材的像素尺寸，不等于手机屏幕分辨率。
*
* 判断方式不是写死单一尺寸，而是范围判断（见下方 4 个参数）：
* 宽度 ≥ 1100、高度 ≥ 2200、高宽比在 1.90 ~ 2.40 之间 → 判定为开屏图，
* 命中后返回 204 空响应；其他图片一律放行，任何异常一律放行（fail-open）。
*
* 支持图片格式：JPEG / PNG / WebP / GIF
*
* 不生效时看 Egern 日志里的 [MDB-AD] 行：若开屏图被识别但尺寸超出范围，
* 只改下面 4 个参数即可，不用动解析代码。
* ============================================================
*/


/* ============================================================
* 其他机型需要调整时，只改这 4 个数字
* ============================================================ */

const MIN_SPLASH_WIDTH = 1100; // 最小宽度
const MIN_SPLASH_HEIGHT = 2200; // 最小高度
const MIN_SPLASH_RATIO = 1.90; // 最小 高度÷宽度
const MAX_SPLASH_RATIO = 2.40; // 最大 高度÷宽度


/* ============================================================
* JPEG 尺寸识别
* ============================================================ */

function getJpegSize(b) {

if (
!b ||
b.length < 10 ||
b[0]!== 0xFF ||
b[1]!== 0xD8
) {
return null;
}

let i = 2;

while (i + 9 < b.length) {

if (b[i]!== 0xFF) {
i++;
continue;
}

const marker = b[i + 1];

i += 2;

if (
marker === 0xD8 ||
marker === 0xD9 ||
marker === 0x01 ||
(marker >= 0xD0 && marker <= 0xD7)
) {
continue;
}

if (i + 1 >= b.length) {
break;
}

const len =
(b[i] << 8) |
b[i + 1];

if (
len < 2 ||
i + len > b.length
) {
break;
}

if (
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
marker === 0xCF
) {

return {
format: "JPEG",
width:
(b[i + 5] << 8) |
b[i + 6],
height:
(b[i + 3] << 8) |
b[i + 4]
};
}

i += len;
}

return null;
}


/* ============================================================
* PNG 尺寸识别
* ============================================================ */

function getPngSize(b) {

if (
!b ||
b.length < 24
) {
return null;
}

if (
b[0]!== 0x89 ||
b[1]!== 0x50 ||
b[2]!== 0x4E ||
b[3]!== 0x47 ||
b[4]!== 0x0D ||
b[5]!== 0x0A ||
b[6]!== 0x1A ||
b[7]!== 0x0A
) {
return null;
}

const width =
(
b[16] * 0x1000000 +
b[17] * 0x10000 +
b[18] * 0x100 +
b[19]
) >>> 0;

const height =
(
b[20] * 0x1000000 +
b[21] * 0x10000 +
b[22] * 0x100 +
b[23]
) >>> 0;

return {
format: "PNG",
width: width,
height: height
};
}


/* ============================================================
* GIF 尺寸识别
* ============================================================ */

function getGifSize(b) {

if (
!b ||
b.length < 10
) {
return null;
}

const isGif =
b[0] === 0x47 &&
b[1] === 0x49 &&
b[2] === 0x46 &&
b[3] === 0x38 &&
(
b[4] === 0x37 ||
b[4] === 0x39
) &&
b[5] === 0x61;

if (!isGif) {
return null;
}

return {
format: "GIF",
width:
b[6] |
(b[7] << 8),
height:
b[8] |
(b[9] << 8)
};
}


/* ============================================================
* WebP 尺寸识别（VP8X / VP8L / VP8）
* ============================================================ */

function getWebpSize(b) {

if (
!b ||
b.length < 30
) {
return null;
}

if (
b[0]!== 0x52 ||
b[1]!== 0x49 ||
b[2]!== 0x46 ||
b[3]!== 0x46 ||
b[8]!== 0x57 ||
b[9]!== 0x45 ||
b[10]!== 0x42 ||
b[11]!== 0x50
) {
return null;
}

const type = String.fromCharCode(
b[12],
b[13],
b[14],
b[15]
);

// VP8X
if (
type === "VP8X" &&
b.length >= 30
) {

const width =
1 +
b[24] +
(b[25] << 8) +
(b[26] << 16);

const height =
1 +
b[27] +
(b[28] << 8) +
(b[29] << 16);

return {
format: "WebP",
width: width,
height: height
};
}

// VP8L
if (
type === "VP8L" &&
b.length >= 25 &&
b[20] === 0x2F
) {

const bits =
(
b[21] |
(b[22] << 8) |
(b[23] << 16) |
(b[24] << 24)
) >>> 0;

const width =
(bits & 0x3FFF) + 1;

const height =
((bits >>> 14) & 0x3FFF) + 1;

return {
format: "WebP",
width: width,
height: height
};
}

// VP8
if (
type === "VP8 " &&
b.length >= 30 &&
b[23] === 0x9D &&
b[24] === 0x01 &&
b[25] === 0x2A
) {

const width =
(
b[26] |
(b[27] << 8)
) & 0x3FFF;

const height =
(
b[28] |
(b[29] << 8)
) & 0x3FFF;

return {
format: "WebP",
width: width,
height: height
};
}

return null;
}


/* ============================================================
* 统一识别
* ============================================================ */

function getImageSize(b) {

return (
getJpegSize(b) ||
getPngSize(b) ||
getWebpSize(b) ||
getGifSize(b)
);
}


/* ============================================================
* 主逻辑（Egern http_response）
* ============================================================ */

export default async function (ctx) {

try {

const buf = await ctx.response.arrayBuffer();

if (!buf || buf.byteLength === 0) {

console.log("[MDB-AD] 未取得二进制响应体 -> 放行");
return;

}

const bytes = new Uint8Array(buf);
const img = getImageSize(bytes);

if (!img) {

console.log("[MDB-AD] 未识别图片格式 -> 放行");
return;

}

const ratio =
img.width > 0
? img.height / img.width
: 0;

console.log(
"[MDB-AD] " +
img.format +
" " +
img.width +
"x" +
img.height +
" ratio=" +
ratio.toFixed(3) +
" / " +
bytes.length +
" bytes"
);

const isSplash =
img.width >= MIN_SPLASH_WIDTH &&
img.height >= MIN_SPLASH_HEIGHT &&
ratio >= MIN_SPLASH_RATIO &&
ratio <= MAX_SPLASH_RATIO;

if (isSplash) {

console.log("[MDB-AD] 命中买单吧开屏广告 -> 204");

return {
status: 204,
headers: {},
body: ""
};

}

console.log("[MDB-AD] 普通图片 -> 放行");
return;

} catch (error) {

console.log("[MDB-AD] ❌ ERROR = " + error);

// 出错默认放行
return;

}
}
