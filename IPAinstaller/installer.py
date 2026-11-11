# -*- coding: utf-8 -*-
"""
IPA 安装助手（Windows 绿色版）
配合「IPA 取件站」：取件站把指定版本 IPA 下到服务器，这个助手开在本机
浏览器里，手机用数据线连电脑，点一下就把 IPA 装进 iPhone。
装的是你自己账号的商店原版包。依赖 pymobiledevice3（已打包在同目录），
电脑还需装一次微软商店的免费 App「Apple 设备」提供苹果驱动。
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import threading
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(HERE, "config.json")
PORT = 8912

jobs = {}
jobs_lock = threading.Lock()
job_seq = [0]


def load_station():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("station", "")
    except Exception:
        return ""


def save_station(url):
    url = (url or "").strip()
    if url and not url.endswith("/"):
        url += "/"
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump({"station": url}, f, ensure_ascii=False)
    return url


def http_get_json(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "IPAInstaller/2.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


async def _install_async(path):
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.installation_proxy import InstallationProxyService

    async with create_using_usbmux() as lockdown:
        async with InstallationProxyService(lockdown) as svc:
            await svc.install_from_local(path)


def install_ipa(path):
    try:
        asyncio.run(_install_async(path))
        return
    except Exception:
        pass
    cmd = [sys.executable, os.path.abspath(__file__), "--pmd3", "apps", "install", path]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if p.returncode != 0:
        tail = (p.stderr or p.stdout or "").strip().splitlines()
        raise RuntimeError(tail[-1] if tail else f"安装失败（退出码 {p.returncode}）")


def friendly_error(e):
    s = str(e)
    low = s.lower()
    if "pair" in low or "trust" in low:
        return "手机还没信任这台电脑：解锁手机，在弹窗上点「信任」，输完密码再点一次安装。"
    if "no device" in low or "usbmux" in low or "refused" in low or "27015" in low or "modulenotfound" in low:
        return ("没连上手机。检查：① 数据线插好、手机已解锁；"
                "② 电脑装了微软商店的免费 App「Apple 设备」（装一次就行）。原始信息：" + s)
    if "verification" in low:
        return "系统拒绝了这个包（验证不过）。把这段发给 Muse： " + s
    return s


def run_job(job_id, name):
    station = load_station()
    tmp = os.path.join(tempfile.gettempdir(), name)

    def upd(**kw):
        with jobs_lock:
            jobs[job_id].update(kw)

    try:
        upd(status="downloading", text="正在从服务器下载…")
        url = station + "file/" + quote(name)
        req = urllib.request.Request(url, headers={"User-Agent": "IPAInstaller/2.0"})
        with urllib.request.urlopen(req, timeout=180) as r:
            total = int(r.headers.get("Content-Length") or 0)
            done = 0
            with open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1024 * 256)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        upd(text=f"下载中… {done // 1048576}/{total // 1048576} MB")
        upd(status="installing", text="下载完成，正在往手机里安装（大包要等一会，别拔线）…")
        install_ipa(tmp)
        upd(status="done", text="✅ 安装成功！去手机桌面打开吧。（美区下的 App，手机上要登录过美区账号才能打开；国区的直接能用。）")
    except Exception as e:
        upd(status="error", text="❌ 没装上：" + friendly_error(e))
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass


PAGE = r"""<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>IPA 安装助手</title>
<style>body{font-family:-apple-system,'Microsoft YaHei',sans-serif;margin:0;background:#f2f2f7;color:#111}
.wrap{max-width:640px;margin:0 auto;padding:18px}
h1{font-size:20px}.card{background:#fff;border-radius:12px;padding:14px;margin:12px 0}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:14px}
button{background:#0a7d33;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:15px;margin-top:8px}
button.ghost{background:#e8e8ea;color:#111}
.meta{color:#666;font-size:13px}.note{color:#666;font-size:13px;line-height:1.6}
.err{color:#c00}.ok{color:#0a7d33}.file{margin:10px 0;padding-bottom:10px;border-bottom:1px solid #eee}
</style></head><body><div class="wrap">
<h1>IPA 安装助手</h1>
<div class="card">
<div class="note">准备（只做一次）：① 微软商店装免费 App「Apple 设备」；② 手机用数据线连电脑、解锁，弹窗点「信任」。</div>
<div class="note" style="margin-top:8px">取件站链接（手机上打开取件站的那个完整链接，粘一次就行）：</div>
<input id="station" placeholder="http://…/取件链接">
<button onclick="saveStation()">保存链接</button>
<button class="ghost" onclick="quit()">退出助手</button>
</div>
<div class="card"><b>服务器上的 IPA</b> <button class="ghost" onclick="loadFiles()">刷新</button>
<div id="files" style="margin-top:8px"></div>
<div id="job" class="note" style="margin-top:8px"></div></div>
<script>
const $ = id => document.getElementById(id);
async function api(p, body){
  const opt = body ? {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)} : {};
  const r = await fetch(p, opt); return r.json();
}
async function init(){
  const d = await api('/api/state');
  if(d.station){ $('station').value = d.station; loadFiles(); }
  else { $('files').innerHTML = '<span class="note">先粘贴取件站链接并保存。</span>'; }
}
async function saveStation(){
  const d = await api('/api/station', {url: $('station').value});
  if(d.ok){ alert('已保存'); loadFiles(); } else alert('保存失败');
}
async function loadFiles(){
  const box = $('files'); box.innerHTML = '<span class="note">读取中…</span>';
  const d = await api('/api/files');
  if(d.error){ box.innerHTML = '<span class="err">' + d.error + '</span>'; return; }
  if(!d.files.length){ box.innerHTML = '<span class="note">还没有文件，先去取件站下载。</span>'; return; }
  box.innerHTML = '';
  d.files.forEach(f => {
    const div = document.createElement('div'); div.className = 'file';
    const mb = (f.size / 1048576).toFixed(1);
    div.innerHTML = '<div></div>';
    div.firstChild.textContent = f.name + ' · 真实版本 ' + f.version + ' · ' + mb + ' MB';
    const b = document.createElement('button'); b.textContent = '安装到手机';
    b.onclick = () => doInstall(f.name);
    div.appendChild(b); box.appendChild(div);
  });
}
async function doInstall(name){
  const j = $('job'); j.className = 'note'; j.textContent = '开始…';
  const d = await api('/api/install', {name});
  const timer = setInterval(async () => {
    const s = await api('/api/job/' + d.job_id);
    j.textContent = s.text || s.status;
    if(s.status == 'done'){ clearInterval(timer); j.className = 'note ok'; }
    else if(s.status == 'error'){ clearInterval(timer); j.className = 'note err'; }
  }, 1500);
}
async function quit(){ await api('/api/quit', {}); document.body.innerHTML = '<p style="padding:20px">助手已退出，可以关掉这个页面了。</p>'; }
init();
</script></div></body></html>"""


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/":
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if p == "/api/state":
            self._json({"station": load_station()})
            return
        if p == "/api/files":
            station = load_station()
            if not station:
                self._json({"error": "还没保存取件站链接"})
                return
            try:
                d = http_get_json(station + "api/files")
                self._json({"files": d.get("files", [])})
            except Exception as e:
                self._json({"error": "读取取件站失败：" + str(e)})
            return
        if p.startswith("/api/job/"):
            jid = p.rsplit("/", 1)[-1]
            with jobs_lock:
                j = dict(jobs.get(jid) or {"status": "unknown", "text": ""})
            self._json(j)
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        p = urlparse(self.path).path
        if p == "/api/station":
            url = save_station(self._body().get("url", ""))
            self._json({"ok": bool(url)})
            return
        if p == "/api/install":
            name = os.path.basename(self._body().get("name", ""))
            if not name.endswith(".ipa"):
                self._json({"error": "文件名不对"}, 400)
                return
            with jobs_lock:
                job_seq[0] += 1
                jid = str(job_seq[0])
                jobs[jid] = {"status": "starting", "text": "准备中…"}
            threading.Thread(target=run_job, args=(
jid, name), daemon=True).start()
            self._json({"job_id": jid})
            return
        if p == "/api/quit":
            self._json({"ok": True})
            threading.Thread(target=lambda: (threading.Event().wait(0.5), os._exit(0)), daemon=True).start()
            return
        self._json({"error": "not found"}, 404)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--pmd3":
        sys.argv = ["pymobiledevice3"] + sys.argv[2:]
        from pymobiledevice3.__main__ import main as pmd3_main
        pmd3_main()
        return
    server = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    url = f"http://127.0.0.1:{PORT}/"
    print(f"IPA 安装助手已启动：{url}")
    print("用完点页面里的「退出助手」，或直接关掉这个窗口。")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
