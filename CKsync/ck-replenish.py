#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CK 补货脚本（青龙定时任务，每天 08:00 跑一次）
改版自研，只留改版：配合 Egern 抓 CK 改版脚本（抓到即 POST /ck 全量上传到接收器 vault）使用。

流程：
  1. 从接收器取 vault（手机抓到的全部 CK，先存着，不直接进青龙）；
  2. 扫描青龙 /ql/data/scripts 里各脚本真正读的环境变量名，算出“青龙在跑脚本需要的 CK”；
  3. vault 里有、青龙又缺（没有 / 为空 / 被禁用）的才补进去；青龙里没有对应脚本的 CK 只留 vault，不新建 env、不硬塞；
  4. 青龙里已有不同值的，不覆盖，只记日志（等人工确认）。

京东 wskey 不走这里：它走接收器 /jd-wskey 直写 JD_WSCK + 触发转换（任务 413/414/415）。

环境变量（在青龙“环境变量”里配一次即可）：
  CK_SYNC_TOKEN    同步口令（与 Egern 模块设置里填的同一个，接收器 /opt/ck-sync/token）
  CK_SYNC_RECEIVER 接收器地址，默认 http://172.17.0.1:8899（青龙容器内网直达宿主机）
"""
import json
import os
import re
import urllib.request
import urllib.error

RECEIVER = (os.environ.get("CK_SYNC_RECEIVER") or "http://172.17.0.1:8899").rstrip("/")
TOKEN = os.environ.get("CK_SYNC_TOKEN") or ""
QL_BASE = "http://127.0.0.1:5700"
SCRIPTS_DIR = "/ql/data/scripts"
TOKEN_FILES = ["/ql/data/config/token.json", "/opt/qinglong/config/token.json"]

# （app, key）-> 青龙 env 名。青龙现在没有跑这 31 个 App 的脚本时保持空表，
# 以后用户加了某 App 的青龙脚本，在这里加一行映射即可；通用规则（key/app 名匹配）会先顶上。
ALIAS = {
    # 例：("weibotalk", "cookie"): "WEIBO_COOKIE",
}

# 通知/基础设施类变量名，绝不是 CK，扫描时排除
DENY_SUBSTR = (
    "PUSH", "NOTIFY", "TG_", "BARK", "QYWX", "DD_BOT", "GOBOT", "GOTIFY",
    "WP_", "QL_", "YYB", "WX_", "PROXY", "TIMEOUT", "DEBUG", "DRY_RUN",
    "RETRY", "ACTIVITY", "TASK", "SECRET", "PASSWORD", "URL", "HOST",
    "PORT", "DIR", "AMOUNT", "COUNT", "MODE", "TYPE", "SOUND", "GROUP",
    "SKIP", "FILTER", "CHECKCK", "AUTHOR", "PLUS", "SERVERPUSH", "IGOT",
    "BEANCHANGE", "USER_AGENT", "TOKEN", "KEY",
)
SKIP_FILES = ("sendnotify", "notify.py", "notify.js")


def log(msg):
    print(msg, flush=True)


def ql_token():
    for path in TOKEN_FILES:
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)["value"]
        except Exception:
            continue
    return ""


def ql_request(method, path, body=None):
    token = ql_token()
    if not token:
        log("读青龙 token 失败")
        return None
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(QL_BASE + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        log("青龙 API %s %s 失败 HTTP %s" % (method, path, e.code))
        return None
    except Exception as e:
        log("青龙 API %s %s 异常: %s" % (method, path, e))
        return None


def ql_get_env(name):
    res = ql_request("GET", "/open/envs?searchValue=" + name)
    if not res:
        return None
    for env in res.get("data") or []:
        if env.get("name") == name:
            return env
    return None


def ql_create_env(name, value, remarks=""):
    res = ql_request("POST", "/open/envs", [{"name": name, "value": value, "remarks": remarks}])
    return bool(res and res.get("code") == 200)


def ql_enable_env(env_id):
    res = ql_request("PUT", "/open/envs/enable", [env_id])
    return bool(res and res.get("code") == 200)


def ql_delete_env(env_id):
    res = ql_request("DELETE", "/open/envs", [env_id])
    return bool(res and res.get("code") == 200)


def scan_needed_envs():
    """扫描青龙脚本实际读的环境变量名（只认 CK 类，排除通知/基础设施）。"""
    pat = re.compile(
        r"os\.environ(?:\.get)?\(\s*['\"]([A-Za-z0-9_]{3,40})['\"]"
        r"|os\.getenv\(\s*['\"]([A-Za-z0-9_]{3,40})['\"]"
        r"|process\.env\.([A-Za-z0-9_]{3,40})"
        r"|process\.env\[['\"]([A-Za-z0-9_]{3,40})['\"]"
    )
    needed = {}
    for dp, dn, fn in os.walk(SCRIPTS_DIR):
        if "node_modules" in dp:
            continue
        dn[:] = [d for d in dn if d != "node_modules"]
        for f in fn:
            if f.lower() in SKIP_FILES:
                continue
            if not (f.endswith(".py") or f.endswith(".js")):
                continue
            p = os.path.join(dp, f)
            try:
                t = open(p, encoding="utf-8", errors="ignore").read()
            except Exception:
                continue
            for m in pat.finditer(t):
                name = [g for g in m.groups() if g]
                if not name:
                    continue
                name = name[0]
                upper = name.upper()
                if any(s in upper for s in DENY_SUBSTR):
                    continue
                needed[upper] = name
    return needed


def fetch_vault():
    if not TOKEN:
        log("未配 CK_SYNC_TOKEN（青龙环境变量），无法取 vault，先去青龙环境变量里配上")
        return None
    url = RECEIVER + "/vault?token=" + TOKEN
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log("取 vault 失败（%s）：%s" % (RECEIVER, e))
        return None
    if not data.get("ok"):
        log("取 vault 被拒：%s" % data.get("error"))
        return None
    return data.get("vault") or {}


def resolve_target(app, key, needed):
    if (app, key) in ALIAS:
        return ALIAS[(app, key)]
    if app in ALIAS:
        return ALIAS[app]
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", key or ""):
        hit = needed.get(key.upper())
        if hit:
            return hit
    hit = needed.get(app.upper())
    if hit:
        return hit
    return None


def main():
    vault = fetch_vault()
    if vault is None:
        return
    needed = scan_needed_envs()
    log("青龙脚本需要的 CK 类变量共 %d 个" % len(needed))
    filled, skipped_same, skipped_diff, vault_only = 0, 0, 0, 0
    for app, entries in sorted(vault.items()):
        if app == "jd":
            continue  # 京东 wskey 走 /jd-wskey 直写通道，不走补货
        for key, item in sorted((entries or {}).items()):
            value = (item or {}).get("value") or ""
            if not value:
                continue
            target = resolve_target(app, key, needed)
            if not target:
                vault_only += 1
                log("只留 vault：%s / %s（青龙没有跑这个 App 的脚本，不新建 env）" % (app, key))
                continue
            env = ql_get_env(target)
            if env and (env.get("value") or "") == value and not env.get("status"):
                skipped_same += 1
                continue
            if env and (env.get("value") or "") and (env.get("value") or "") != value and not env.get("status"):
                skipped_diff += 1
                log("跳过（青龙已有不同值，等人工确认）：%s <- %s / %s" % (target, app, key))
                continue
            ok = False
            if env and not (env.get("value") or ""):
                # 有 env 但值为空：删了重建
                if ql_delete_env(env["id"]):
                    ok = ql_create_env(target, value, "CK补货 %s/%s" % (app, key))
            elif env and env.get("status"):
                # 被禁用的 env：先启用；值不对的也重建
                if (env.get("value") or "") != value:
                    if ql_delete_env(env["id"]):
                        ok = ql_create_env(target, value, "CK补货 %s/%s" % (app, key))
                else:
                    ok = ql_enable_env(env["id"])
            else:
                ok = ql_create_env(target, value, "CK补货 %s/%s" % (app, key))
            if ok:
                filled += 1
                log("已补货：%s <- %s / %s" % (target, app, key))
            else:
                log("补货失败：%s <- %s / %s" % (target, app, key))
    log("补货完成：新增/恢复 %d，值相同跳过 %d，已有不同值跳过 %d，只留 vault %d" % (filled, skipped_same, skipped_diff, vault_only))


if __name__ == "__main__":
    main()
