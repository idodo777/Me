# -*- coding: utf-8 -*-
"""
IPA 安装助手（Windows）
配合「IPA 取件站」使用：在取件站把 IPA 下到服务器后，用这个助手把手机
用数据线连电脑，一键装进 iPhone（装的是你自己账号的商店原版包）。

依赖：pymobiledevice3（打包在 exe 里）；电脑需装有苹果驱动
（微软商店免费 App「Apple 设备」装一次即可，不用装 iTunes）。
"""
import asyncio
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import tkinter as tk
from tkinter import messagebox, ttk
from urllib.parse import quote
import urllib.request

APP_NAME = "IPA 安装助手"
CONFIG_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "IPAInstaller")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")


def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


def station_base(raw):
    raw = (raw or "").strip()
    if not raw:
        return ""
    if not raw.endswith("/"):
        raw += "/"
    return raw


def http_get_json(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "IPAInstaller/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def http_download(url, dest, progress_cb):
    req = urllib.request.Request(url, headers={"User-Agent": "IPAInstaller/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        with open(dest, "wb") as f:
            while True:
                chunk = r.read(1024 * 256)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                progress_cb(done, total)
    return done


async def _install_async(path):
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.installation_proxy import InstallationProxyService

    async with create_using_usbmux() as lockdown:
        async with InstallationProxyService(lockdown) as svc:
            await svc.install_from_local(path)


def install_ipa(path):
    """先走库接口；失败再退到打包在同一个 exe 里的 pymobiledevice3 命令行。"""
    try:
        asyncio.run(_install_async(path))
        return
    except Exception:
        pass
    cmd = [sys.executable, "--pmd3", "apps", "install", path]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if p.returncode != 0:
        tail = (p.stderr or p.stdout or "").strip().splitlines()
        raise RuntimeError(tail[-1] if tail else f"安装失败（退出码 {p.returncode}）")


def friendly_error(e):
    s = str(e)
    low = s.lower()
    if "pair" in low or "trust" in low:
        return "手机还没信任这台电脑：解锁手机，在弹窗上点「信任」，输密码后再点一次安装。"
    if "no device" in low or "usbmux" in low or "connection" in low or "refused" in low or "27015" in low:
        return ("没连上手机。检查：① 数据线插好、手机已解锁；"
                "② 电脑装了微软商店的免费 App「Apple 设备」（装一次就行，提供苹果驱动）。")
    if "applicationverificationfailed" in low or "verification" in low:
        return "系统拒绝了这个包（验证不过）。把下面的原始报错发给 Muse 看：\n" + s
    return s


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        self.geometry("640x480")
        self.minsize(560, 420)
        self.files = []
        self.q = queue.Queue()
        self.busy = False

        cfg = load_config()
        top = ttk.Frame(self, padding=10)
        top.pack(fill="x")
        ttk.Label(top, text="取件站链接：").pack(side="left")
        self.url_var = tk.StringVar(value=cfg.get("station", ""))
        ent = ttk.Entry(top, textvariable=self.url_var)
        ent.pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(top, text="保存并刷新", command=self.on_refresh).pack(side="left")

        mid = ttk.Frame(self, padding=(10, 0, 10, 0))
        mid.pack(fill="both", expand=True)
        ttk.Label(mid, text="服务器上已下载的 IPA（选中后点安装）：").pack(anchor="w")
        lb = ttk.Frame(mid)
        lb.pack(fill="both", expand=True, pady=4)
        self.listbox = tk.Listbox(lb, activestyle="dotbox", font=("Microsoft YaHei UI", 10))
        sb = ttk.Scrollbar(lb, orient="vertical", command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=sb.set)
        self.listbox.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        btns = ttk.Frame(self, padding=10)
        btns.pack(fill="x")
        self.btn_refresh = ttk.Button(btns, text="刷新列表", command=self.on_refresh)
        self.btn_refresh.pack(side="left")
        self.btn_install = ttk.Button(btns, text="安装选中", command=self.on_install)
        self.btn_install.pack(side="left", padx=8)

        self.status = tk.StringVar(value="用法：① 电脑装一次微软商店的免费 App「Apple 设备」；"
                                         "② 手机用数据线连电脑、解锁，弹窗点「信任」；"
                                         "③ 在上面粘贴取件站链接，刷新，选中 IPA 点「安装选中」。")
        ttk.Label(self, textvariable=self.status, wraplength=610, padding=10,
                  foreground="#333").pack(fill="x")
        self.after(150, self._drain)
        if self.url_var.get():
            self.on_refresh()

    # ---------- UI plumbing ----------
    def _drain(self):
        try:
            while True:
                fn = self.q.get_nowait()
                fn()
        except queue.Empty:
            pass
        self.after(150, self._drain)

    def set_status(self, text):
        self.q.put(lambda: self.status.set(text))

    def set_busy(self, busy):
        def f():
            self.busy = busy
            state = "disabled" if busy else "normal"
            self.btn_refresh.configure(state=state)
            self.btn_install.configure(state=state)
        self.q.put(f)

    def work(self, fn):
        threading.Thread(target=fn, daemon=True).start()

    # ---------- actions ----------
    def on_refresh(self):
        base = station_base(self.url_var.get())
        if not base:
            messagebox.showwarning(APP_NAME, "先把取件站链接粘进来（就是手机上打开取件站的那个完整链接）。")
            return
        save_config({"station": base})
        self.set_busy(True)
        self.set_status("正在读取列表…")

        def job():
            try:
                d = http_get_json(base + "api/files")
                files = d.get("files", [])

                def show():
                    self.files = files
                    self.listbox.delete(0, "end")
                    for fdata in files:
                        self.listbox.insert("end", f"{fdata['name']} · 版本 {fdata['version']} · {fdata['size_mb']} MB")
                    self.status.set(f"共 {len(files)} 个文件。手机插好线后，选中一个点「安装选中」。")
                self.q.put(show)
            except Exception as e:
                self.set_status("读取失败：" + str(e) + "（检查链接是否完整、网络是否通）")
            finally:
                self.set_busy(False)
        self.work(job)

    def on_install(self):
        sel = self.listbox.curselection()
        if not sel:
            messagebox.showwarning(APP_NAME, "先在列表里选中要安装的 IPA。")
            return
        fdata = self.files[sel[0]]
        base = station_base(self.url_var.get())
        self.set_busy(True)

        def job():
            tmp = os.path.join(tempfile.gettempdir(), fdata["name"])
            try:
                self.set_status(f"正在从服务器下载 {fdata['name']} …")

                def prog(done, total):
                    if total:
                        self.set_status(f"下载中… {done // 1048576}/{total // 1048576} MB")
                http_download(base + "file/" + quote(fdata["name"]), tmp, prog)
                self.set_status("下载完成，正在往手机里安装（大包要等一会儿，别拔线）…")
                install_ipa(tmp)
                self.set_status(f"✅ {fdata['name']} 安装成功，去手机桌面打开吧。"
                                "（美区下的 App，手机上要登录过美区账号才能打开；国区的直接能用。）")
            except Exception as e:
                self.set_status("❌ 没装上：" + friendly_error(e))
            finally:
                try:
                    os.remove(tmp)
                except Exception:
                    pass
                self.set_busy(False)
        self.work(job)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--pmd3":
        sys.argv = ["pymobiledevice3"] + sys.argv[2:]
        from pymobiledevice3.__main__ import main as pmd3_main
        pmd3_main()
        return
    App().mainloop()


if __name__ == "__main__":
    main()
