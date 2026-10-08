"""QIROVA one-click launcher: backend gateway + IDE, with health monitoring.

Build: <venv>/Scripts/pyinstaller --onefile --noconsole --name QIROVA QIROVA_launcher.py
Stdlib only (tkinter GUI). Run from the ecdat-ide-build directory.
All tkinter updates happen on the main thread via a queue.
"""
import json
import os
import queue
import subprocess
import sys
import threading
import time
import tkinter as tk
import tkinter.messagebox as messagebox
import tkinter.ttk as ttk
import traceback
import urllib.error
import urllib.request
import webbrowser

API = "http://127.0.0.1:8000"
RELEASE_TAG = "v1.0.0"
RELEASE_URL = f"https://github.com/snnxndnsjdnsn/ECDAT-IDE/releases/tag/{RELEASE_TAG}"
RELEASE_API = f"https://api.github.com/repos/snnxndnsjdnsn/ECDAT-IDE/releases/tags/{RELEASE_TAG}"
ASSET_API_BASE = "https://api.github.com/repos/snnxndnsjdnsn/ECDAT-IDE/releases/assets"
INSTALLED_EXE = os.path.join(os.environ.get("LOCALAPPDATA", ""),
                             "QIROVA-IDE", "QIROVA.exe")
LAUNCH_LOG = os.path.join(os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
                          else os.path.dirname(os.path.abspath(__file__)),
                          "qirova-launcher.log")


def log_msg(msg):
    try:
        with open(LAUNCH_LOG, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
    except Exception:
        pass


def log_exc(where):
    try:
        with open(LAUNCH_LOG, "a", encoding="utf-8") as f:
            f.write(f"\n[{time.strftime('%H:%M:%S')}] {where}\n")
            traceback.print_exc(file=f)
    except Exception:
        pass
    try:
        with open(LAUNCH_LOG, "a", encoding="utf-8") as f:
            f.write(f"\n[{time.strftime('%H:%M:%S')}] {where}\n")
            traceback.print_exc(file=f)
    except Exception:
        pass


def home_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


HOME = os.environ.get("QIROVA_HOME", home_dir())
BACKEND_DIR = os.path.join(HOME, "backend")
VENV_PY = os.path.join(HOME, "backend", ".venv", "Scripts", "python.exe")
VSCODIUM = os.path.join(HOME, "VSCodium.exe")
LOG_FILE = os.path.join(BACKEND_DIR, "qirova-backend.log")


def api_get(path, timeout=10):
    try:
        with urllib.request.urlopen(API + path, timeout=timeout) as r:
            if r.status == 200:
                return json.loads(r.read().decode("utf-8"))
    except Exception:
        pass
    return None


def installed_copy():
    # A real install made by QIROVA-Setup.exe lives here. Never "relaunch"
    # this very exe (bare copies live elsewhere, so the path check is enough).
    try:
        if INSTALLED_EXE and os.path.isfile(INSTALLED_EXE):
            return INSTALLED_EXE
    except Exception:
        pass
    return None


def github_token():
    # Reuse the credential the developer already authenticated `git clone`
    # with (Git Credential Manager). Private-repo release assets need it.
    for scheme in ("Bearer", "basic"):
        try:
            p = subprocess.run(
                ["git", "credential", "fill"],
                input="protocol=https\nhost=github.com\n\n",
                capture_output=True, text=True, timeout=15,
                creationflags=0x08000000)
            for line in p.stdout.splitlines():
                if line.startswith("password=") and len(line) > 9:
                    pw = line[9:].strip()
                    if scheme == "Bearer":
                        return ("Bearer", pw)
                    import base64
                    user = "x-access-token"
                    for ul in p.stdout.splitlines():
                        if ul.startswith("username=") and len(ul) > 9:
                            user = ul[9:].strip()
                    return ("Basic", base64.b64encode(
                        f"{user}:{pw}".encode()).decode())
        except Exception:
            log_exc("github_token")
            return None
    return None


def _resolve_setup_asset(auth_header):
    # Fresh (asset_id, size) for QIROVA-Setup.exe on the current release tag,
    # so re-uploads keep working without hardcoding an asset id.
    req = urllib.request.Request(RELEASE_API, headers={
        "Authorization": auth_header,
        "Accept": "application/vnd.github+json",
        "User-Agent": "QIROVA-updater"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    for a in data.get("assets", []):
        if a.get("name") == "QIROVA-Setup.exe":
            return int(a["id"]), int(a.get("size") or 0)
    return None, 0


def _asset_redirect_url(asset_id, auth_header):
    # Follow the API 302 by hand: urllib would forward the Authorization
    # header to the CDN host, which must never see the token.
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    op = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(f"{ASSET_API_BASE}/{asset_id}", headers={
        "Authorization": auth_header,
        "Accept": "application/octet-stream",
        "User-Agent": "QIROVA-updater"})
    try:
        op.open(req, timeout=30)
        return None
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            return e.headers.get("Location")
        raise


def _fetch_file(url, dest, total, on_progress):
    # Stream to disk with resume; returns True only when size matches total.
    have = 0
    if os.path.isfile(dest):
        have = os.path.getsize(dest)
        if total and have == total:
            on_progress(have, total)
            return True
        if total and have > total:
            try:
                os.remove(dest)
            except Exception:
                pass
            have = 0
    mode = "ab" if have else "wb"
    req = urllib.request.Request(url, headers={"User-Agent": "QIROVA-updater"})
    if have:
        req.add_header("Range", f"bytes={have}-")
    with urllib.request.urlopen(req, timeout=60) as r:
        if have and getattr(r, "status", 200) != 206:
            have, mode = 0, "wb"
        done = have
        last = 0.0
        with open(dest, mode) as f:
            while True:
                chunk = r.read(262144)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                now = time.time()
                if now - last > 0.5:
                    last = now
                    on_progress(done, total)
        on_progress(done, total)
    if total and os.path.getsize(dest) != total:
        return False
    return True


def procs_by_name(name):
    # Headless tasklist: CREATE_NO_WINDOW + hidden startup info, otherwise
    # each poll flashes a console popup.
    out = []
    try:
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        txt = subprocess.check_output(["tasklist", "/FI", f"IMAGENAME eq {name}",
                                       "/FO", "CSV", "/NH"],
                                      text=True, stderr=subprocess.DEVNULL,
                                      startupinfo=si,
                                      creationflags=0x08000000)
        for line in txt.strip().splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 2 and parts[0].lower() == name.lower():
                try:
                    out.append(int(parts[1]))
                except ValueError:
                    pass
    except Exception:
        pass
    return out


class Launcher(tk.Tk):
    # 1x1 transparent GIF (base64) — replaces the default Tk feather icon.
    _BLANK_ICON = (
        "R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==")

    def __init__(self):
        super().__init__()
        self.title("QIROVA — Quantum Intelligence for PQC Migration")
        self.geometry("480x560")
        self.configure(bg="#0d1117")
        try:
            self._icon_img = tk.PhotoImage(data=self._BLANK_ICON)
            self.iconphoto(True, self._icon_img)
        except Exception:
            pass
        self.backend_proc = None
        self.closing = False
        self._dl_thread = None
        self.msgq = queue.Queue()
        try:
            ttk.Style(self).theme_use("clam")
        except Exception:
            pass

        header = tk.Frame(self, bg="#0d1117")
        header.pack(fill="x", padx=14, pady=(12, 2))
        tk.Label(header, text="QIROVA", bg="#0d1117", fg="#58a6ff",
                 font=("Segoe UI", 16, "bold")).pack(side="left")
        tk.Label(header, text="v1.0.0  •  SIH 2026", bg="#0d1117", fg="#8b949e",
                 font=("Segoe UI", 9)).pack(side="left", padx=(8, 0))

        sep = tk.Frame(self, bg="#21262d", height=1)
        sep.pack(fill="x", padx=14, pady=8)

        self.vars = {}
        self.dots = {}
        for key, label in (("backend", "Backend gateway"),
                           ("models", "Models wired"),
                           ("ide", "IDE")):
            f = tk.Frame(self, bg="#0d1117")
            f.pack(fill="x", padx=14, pady=3)
            dot = tk.Label(f, text="●", bg="#0d1117", fg="#6e7681",
                           font=("Segoe UI", 11))
            dot.pack(side="left", padx=(0, 6))
            tk.Label(f, text=label, width=16, anchor="w", bg="#0d1117",
                     fg="#8b949e", font=("Segoe UI", 10)).pack(side="left")
            var = tk.StringVar(value="starting...")
            tk.Label(f, textvariable=var, anchor="w", bg="#0d1117", fg="#e6edf3",
                     font=("Segoe UI", 10, "bold")).pack(side="left")
            self.vars[key] = var
            self.dots[key] = dot
        btns = tk.Frame(self, bg="#0d1117")
        btns.pack(pady=10)
        self._btn(btns, "Start Everything", self.start_everything, 0, 0, primary=True)
        self._btn(btns, "Open IDE", lambda: self._bg(self.open_ide), 0, 1)
        self._btn(btns, "API Docs", lambda: webbrowser.open(API + "/docs"), 1, 0)
        self._btn(btns, "Restart Backend", self.restart_backend, 1, 1)
        self._btn(btns, "Uninstall QIROVA", self.uninstall_gui, 2, 0, danger=True)
        self._btn(btns, "Quit (stop all)", self.quit_all, 2, 1)
        tk.Label(self, text="backend log (tail)", bg="#0d1117", fg="#8b949e",
                 font=("Segoe UI", 9)).pack(anchor="w", padx=14)
        self.log = tk.Text(self, height=12, bg="#010409", fg="#c9d1d9",
                           font=("Consolas", 9), wrap="none", relief="flat",
                           highlightthickness=1,
                           highlightbackground="#21262d",
                           insertbackground="#58a6ff")
        self.log.pack(fill="both", expand=True, padx=14, pady=(2, 14))
        tk.Label(self, text="Scans stay on localhost • keys live in backend\\.env only",
                 bg="#0d1117", fg="#6e7681",
                 font=("Segoe UI", 8)).pack(pady=(0, 10))
        self.after(300, self._pump)
        self.after(2000, self._sched_poll)
        self.after(5000, self._sched_tail)
        self.after(1000, self.start_everything)  # one click does everything

    def _btn(self, parent, text, cmd, r, c, primary=False, danger=False):
        if primary:
            bg, ab, fg = "#238636", "#2ea043", "#ffffff"
        elif danger:
            bg, ab, fg = "#21262d", "#da3633", "#ffa198"
        else:
            bg, ab, fg = "#21262d", "#30363d", "#e6edf3"
        b = tk.Button(parent, text=text, command=cmd, width=22,
                      bg=bg, fg=fg, activebackground=ab, activeforeground="#ffffff",
                      relief="flat", font=("Segoe UI", 10), padx=4, pady=7,
                      cursor="hand2", borderwidth=0, highlightthickness=0)
        b.grid(row=r, column=c, padx=4, pady=4, sticky="ew")
        parent.grid_columnconfigure(c, weight=1)

    def _bg(self, fn):
        threading.Thread(target=self._guard(fn), daemon=True).start()

    def _guard(self, fn):
        def run():
            try:
                fn()
            except Exception:
                log_exc(fn.__name__)
        return run

    def set(self, key, val):
        self.msgq.put(("set", key, val))

    def _pump(self):
        try:
            while True:
                kind, key, val = self.msgq.get_nowait()
                if kind == "set" and key in self.vars:
                    self.vars[key].set(val)
                    dot = self.dots.get(key)
                    if dot is not None:
                        dot.configure(fg=self._dot_color(key, val))
        except queue.Empty:
            pass
        if not self.closing:
            self.after(300, self._pump)

    @staticmethod
    def _dot_color(key, val):
        v = str(val).lower()
        if key == "backend":
            return "#3fb950" if v == "healthy" else "#d29922" if "starting" in v else "#f85149"
        if key == "models":
            return "#3fb950" if "/" in v and not v.startswith("0/") else "#6e7681"
        if key == "ide":
            return "#3fb950" if v.startswith("running") else "#6e7681"
        return "#6e7681"

    def _sched_poll(self):
        if self.closing:
            return
        self._bg(self._poll)
        self.after(5000, self._sched_poll)

    def _sched_tail(self):
        if self.closing:
            return
        try:
            with open(LOG_FILE, "rb") as f:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - 4000))
                tail = f.read().decode("utf-8", errors="replace").splitlines()[-12:]
            self.log.delete("1.0", "end")
            self.log.insert("end", "\n".join(tail))
            self.log.see("end")
        except Exception:
            pass
        self.after(5000, self._sched_tail)

    def _poll(self):
        h = api_get("/api/v1/health", timeout=5)
        if h:
            self.set("backend", "healthy")
            try:
                m = api_get("/api/v1/models/status", timeout=10) or {}
                models = m.get("models", [])
                wired = sum(1 for x in models if x.get("wired"))
                self.set("models", f"{wired}/{len(models)}")
            except Exception:
                self.set("models", "?")
        else:
            self.set("backend", "down")
            self.set("models", "-")
        ide = procs_by_name("VSCodium.exe")
        self.set("ide", f"running ({len(ide)})" if ide else "stopped")

    def child_env(self):
        # Inherit the full user environment like QIROVA-BACKEND.cmd does,
        # dropping only what the PyInstaller bootloader adds that can poison
        # the venv child (its temp dir on PATH).
        env = dict(os.environ)
        path = env.get("PATH", "")
        parts = [p for p in path.split(os.pathsep) if "_MEI" not in p.upper()]
        venv_scripts = os.path.join(BACKEND_DIR, ".venv", "Scripts")
        if venv_scripts not in parts:
            parts.insert(0, venv_scripts)
        env["PATH"] = os.pathsep.join(parts)
        return env

    def _run_quiet(self, args, cwd=None, timeout=600):
        # Headless subprocess: never flashes a console.
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        try:
            p = subprocess.run(
                args, cwd=cwd or BACKEND_DIR, timeout=timeout,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                startupinfo=si, creationflags=0x08000000)
            return p.returncode, p.stdout.decode("utf-8", errors="replace")[-2000:]
        except Exception as e:
            return -1, str(e)

    def _find_system_python(self):
        # Prefer a bundled portable interpreter, else PATH python 3.11/3.12,
        # else a previous per-user silent install from this launcher.
        candidates = [os.path.join(HOME, "python-embed", "python.exe")]
        local = os.path.join(os.environ.get("LOCALAPPDATA", ""),
                             "Programs", "Python", "Python312", "python.exe")
        if os.path.exists(local):
            candidates.append(local)
        try:
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            txt = subprocess.check_output(
                ["where", "python"], text=True, stderr=subprocess.DEVNULL,
                startupinfo=si, creationflags=0x08000000)
            candidates += [l.strip() for l in txt.splitlines() if l.strip()]
        except Exception:
            pass
        for cand in candidates:
            try:
                si = subprocess.STARTUPINFO()
                si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                out = subprocess.check_output(
                    [cand, "--version"], text=True, stderr=subprocess.STDOUT,
                    timeout=20, startupinfo=si, creationflags=0x08000000)
                ver = (out.strip().split() + ["", ""])[1]
                major, minor = (ver.split(".") + ["0", "0"])[:2]
                if major == "3" and minor in ("11", "12"):
                    return cand
            except Exception:
                continue
        return None

    def _start_embedded(self, wait=False):
        # Self-contained backend bundle: no venv, no pip, no system python.
        embedded = os.path.join(HOME, "backend-dist", "QIROVA-backend", "QIROVA-backend.exe")
        env = self.child_env()
        env["ECDAT_ALL_MODELS_DIR"] = os.path.join(BACKEND_DIR, "all_models")
        try:
            os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        except Exception:
            pass
        logf = open(LOG_FILE, "ab")
        self.backend_proc = subprocess.Popen(
            [embedded], cwd=BACKEND_DIR, stdout=logf, stderr=subprocess.STDOUT,
            env=env, creationflags=0x08000000)
        log_msg(f"embedded backend spawned pid={self.backend_proc.pid}")
        if not wait:
            return True
        waited = 0
        while not self.closing:
            time.sleep(10)
            waited += 10
            if api_get("/api/v1/health", timeout=5):
                return True
            if waited % 60 == 0:
                self.set("backend", f"warming models ({waited // 60} min)...")
        return False

    def _download(self, url, dest, label):
        # Headless download with progress into status bar. Returns True on ok.
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "QIROVA-IDE/1.0.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                total = int(r.headers.get("Content-Length") or 0)
                done = 0
                with open(dest, "wb") as f:
                    while True:
                        chunk = r.read(1024 * 256)
                        if not chunk:
                            break
                        f.write(chunk)
                        done += len(chunk)
                        if total:
                            self.set("backend",
                                     f"{label} {done // 1048576}MB/{total // 1048576}MB...")
            return True
        except Exception as e:
            log_msg(f"download failed: {e}")
            return False

    def _install_python(self):
        # No usable Python: fetch the official installer and silent-install
        # per-user (no admin). Makes backend setup fully automatic.
        url = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
        try:
            tmp = os.path.join(os.environ.get("TEMP", HOME), "qirova-python-setup.exe")
        except Exception:
            return False
        self.set("backend", "downloading Python 3.12 (once)...")
        if not self._download(url, tmp, "downloading Python"):
            self.set("backend", "Python download failed (offline?)")
            return False
        self.set("backend", "installing Python 3.12 (once)...")
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        try:
            p = subprocess.run(
                [tmp, "/quiet", "InstallAllUsers=0", "PrependPath=0",
                 "Include_test=0", "Include_doc=0", "Include_dev=0"],
                timeout=600, startupinfo=si, creationflags=0x08000000,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            ok = (p.returncode == 0)
        except Exception as e:
            log_msg(f"python installer failed: {e}")
            ok = False
        try:
            os.remove(tmp)
        except Exception:
            pass
        return ok

    def _venv_works(self):
        # A copied/stale venv looks present but imports nothing. Smoke-test it.
        if not os.path.exists(VENV_PY):
            return False
        rc, _ = self._run_quiet(
            [VENV_PY, "-c", "import fastapi, uvicorn"], timeout=120)
        return rc == 0

    def ensure_backend_ready(self):
        # Fresh (judge) machines: no venv yet -> build it + deps + .env.
        if self._venv_works():
            return True
        if os.path.exists(VENV_PY):
            # Broken transplant: remove so we rebuild cleanly below.
            self.set("backend", "repairing environment...")
            try:
                import shutil
                shutil.rmtree(os.path.join(BACKEND_DIR, ".venv"),
                              ignore_errors=True)
            except Exception:
                pass
        self.set("backend", "first run: setting up...")
        py = self._find_system_python()
        if not py:
            if not self._install_python():
                return False
            py = self._find_system_python()
        if not py:
            self.set("backend", "need Python 3.11/3.12")
            try:
                messagebox.showwarning(
                    "QIROVA",
                    "No Python 3.11/3.12 found.\n\nInstall it from python.org "
                    "(check 'Add Python to PATH'), then press Start Everything.")
            except Exception:
                pass
            return False
        self.set("backend", "creating venv...")
        rc, _ = self._run_quiet([py, "-m", "venv", os.path.join(BACKEND_DIR, ".venv")], timeout=300)
        if rc != 0 or not os.path.exists(VENV_PY):
            self.set("backend", "venv failed")
            return False
        req = os.path.join(BACKEND_DIR, "requirements-lite.txt")
        if os.path.exists(req):
            self.set("backend", "installing packages (once)...")
            vpip = os.path.join(BACKEND_DIR, ".venv", "Scripts", "pip.exe")
            rc, _ = self._run_quiet([vpip, "install", "-r", req], timeout=1800)
            if rc != 0:
                self.set("backend", "deps failed (offline?)")
                return False
        envf, exf = os.path.join(BACKEND_DIR, ".env"), os.path.join(BACKEND_DIR, ".env.example")
        try:
            if not os.path.exists(envf) and os.path.exists(exf):
                import shutil
                shutil.copyfile(exf, envf)
        except Exception:
            pass
        return os.path.exists(VENV_PY)

    def layout_problems(self):
        # Returns a list of human-readable blockers, [] when install is whole.
        problems = []
        if not os.path.isdir(BACKEND_DIR):
            problems.append("backend folder is missing next to QIROVA.exe")
        elif not os.path.exists(os.path.join(BACKEND_DIR, "gateway", "main.py")):
            problems.append("backend code is missing (gateway\\main.py not found)")
        # NOTE: missing venv/bundle is NOT a blocker — first run bootstraps it.
        if not os.path.exists(VSCODIUM):
            problems.append("VSCodium.exe is missing next to QIROVA.exe")
        return problems

    def _fix_incomplete(self, problems):
        # Runs on the Tk thread. A bare QIROVA.exe (git clone / stray copy)
        # cannot work alone — turn the dead-end error into a real fix.
        try:
            inst = installed_copy()
            if inst:
                if messagebox.askyesno(
                        "QIROVA install found",
                        "This QIROVA.exe is just a launcher stub — its folder "
                        "is missing:\n\n- " + "\n- ".join(problems) +
                        "\n\nA full QIROVA install already exists:\n"
                        f"{inst}\n\nLaunch the installed copy instead?"):
                    self.set("backend", "launching installed copy...")
                    try:
                        subprocess.Popen([inst], cwd=os.path.dirname(inst))
                    except Exception:
                        log_exc("launch installed")
                        messagebox.showerror("QIROVA", f"Could not launch:\n{inst}")
                        return
                    self.closing = True
                    self.after(600, self.destroy)
                return
            if messagebox.askyesno(
                    "QIROVA — full package needed",
                    "This QIROVA.exe is just a launcher stub — its folder is "
                    "missing:\n\n- " + "\n- ".join(problems) +
                    "\n\nIt cannot run on its own. The full package "
                    "(QIROVA-Setup.exe, about 816 MB) is on GitHub.\n\n"
                    "Download it now?\n\n"
                    "  Yes  — download to your Downloads folder, then open "
                    "the installer\n"
                    "  No   — open the download page in your browser"):
                self._start_setup_download()
            else:
                self.set("backend", "package download page opened")
                webbrowser.open(RELEASE_URL)
        except Exception:
            log_exc("_fix_incomplete")
            try:
                messagebox.showerror(
                    "QIROVA",
                    "This QIROVA.exe is incomplete here:\n\n- " +
                    "\n- ".join(problems) +
                    "\n\nGet the full package:\n"
                    "1) Download QIROVA-Setup.exe (recommended):\n"
                    f"   {RELEASE_URL}\n"
                    "2) git clone https://github.com/snnxndnsjdnsn/ECDAT-IDE\n"
                    "   + copy backend-dist + VSCodium next to this EXE.")
            except Exception:
                pass

    def _start_setup_download(self):
        t = getattr(self, "_dl_thread", None)
        if t is not None and t.is_alive():
            self.set("backend", "package already downloading...")
            return
        self.set("backend", "starting package download...")
        self._dl_thread = threading.Thread(target=self._download_setup,
                                           daemon=True)
        self._dl_thread.start()

    def _download_setup(self):
        dest = os.path.join(os.path.expanduser("~"), "Downloads",
                            "QIROVA-Setup.exe")
        try:
            auth = github_token()
            if not auth:
                self.set("backend", "git sign-in needed — opened download page")
                webbrowser.open(RELEASE_URL)
                return
            scheme, cred = auth
            hdr = f"{scheme} {cred}"
            aid, total = _resolve_setup_asset(hdr)
            if not aid:
                self.set("backend", "release asset not found — opened page")
                webbrowser.open(RELEASE_URL)
                return
            url = _asset_redirect_url(aid, hdr)
            if not url:
                self.set("backend", "download link failed — opened page")
                webbrowser.open(RELEASE_URL)
                return

            def prog(done, total_bytes):
                if total_bytes:
                    pct = done * 100 // total_bytes
                    self.set("backend", f"downloading package {pct}% "
                             f"({done // 1048576}/{total_bytes // 1048576} MB)")
                else:
                    self.set("backend",
                             f"downloading package {done // 1048576} MB")

            if not _fetch_file(url, dest, total, prog):
                self.set("backend", "download incomplete — press Start to retry")
                return
            self.set("backend", "download complete — running installer...")
            try:
                os.startfile(dest)
            except Exception:
                log_exc("startfile")
                self.set("backend", f"saved to {dest} — run it manually")
                return
            self.after(0, lambda: messagebox.showinfo(
                "QIROVA",
                "QIROVA-Setup.exe finished downloading:\n"
                f"{dest}\n\n"
                "The installer window should be open now — follow it. "
                "It installs the full package and launches QIROVA.\n\n"
                "Windows may show SmartScreen for this unsigned file: "
                "click More info → Run anyway."))
        except Exception:
            log_exc("_download_setup")
            self.set("backend", "download failed — see launcher log")

    def start_backend(self, wait=False):
        if api_get("/api/v1/health", timeout=5):
            return True
        problems = [p for p in self.layout_problems()
                    if "VSCodium" not in p and "IDE" not in p]
        if problems:
            self.set("backend", "incomplete — package needed")
            try:
                self.after(0, lambda: self._fix_incomplete(problems))
            except Exception:
                log_exc("fix_incomplete")
            return False
        embedded = os.path.join(HOME, "backend-dist", "QIROVA-backend", "QIROVA-backend.exe")
        log_msg(f"embedded check: HOME={HOME} exists={os.path.exists(embedded)}")
        if os.path.exists(embedded):
            return self._start_embedded(wait)
        if not self.ensure_backend_ready():
            return False
        if not self._venv_works():
            self.set("backend", "environment broken")
            return False
        if os.path.exists(embedded):
            return self._start_embedded(wait)
        if not self.ensure_backend_ready():
            return False
        env = self.child_env()
        log_msg(f"spawning backend: venv={VENV_PY} exists={os.path.exists(VENV_PY)} "
                f"path0={env.get('PATH', '').split(os.pathsep)[0]}")
        try:
            os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        except Exception:
            pass
        logf = open(LOG_FILE, "ab")
        creation = 0x08000000  # CREATE_NO_WINDOW
        self.backend_proc = subprocess.Popen(
            [VENV_PY, "-m", "uvicorn", "gateway.main:app",
             "--host", "127.0.0.1", "--port", "8000"],
            cwd=BACKEND_DIR, stdout=logf, stderr=subprocess.STDOUT,
            env=env, creationflags=creation)
        log_msg(f"backend spawned pid={self.backend_proc.pid}")
        if not wait:
            return True
        waited = 0
        while not self.closing:
            time.sleep(10)
            waited += 10
            if api_get("/api/v1/health", timeout=5):
                return True
            if waited % 60 == 0:
                self.set("backend", f"warming models ({waited // 60} min)...")
        return False

    def open_ide(self):
        if not os.path.exists(VSCODIUM):
            problems = self.layout_problems()
            if problems:
                try:
                    self.after(0, lambda: self._fix_incomplete(problems))
                except Exception:
                    log_exc("fix_incomplete")
                return
            try:
                messagebox.showwarning(
                    "QIROVA",
                    "VSCodium.exe is missing next to QIROVA.exe.\n\n"
                    "Run this from a full install folder\n"
                    "(or use the Complete Setup installer).")
            except Exception:
                pass
            return
        profile = os.path.join(HOME, ".qirova-profile")
        try:
            os.makedirs(profile, exist_ok=True)
        except Exception:
            pass
        subprocess.Popen(
            [VSCODIUM, "--disable-workspace-trust", "--disable-gpu",
             "--extensions-dir", os.path.join(HOME, "resources", "app", "extensions"),
             "--user-data-dir", profile],
            cwd=HOME, creationflags=0x08000000,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def start_everything(self):
        self._bg(self._start_all)

    def _start_all(self):
        self.set("backend", "starting...")
        if self.start_backend(wait=True):
            self.set("backend", "healthy")
            self.open_ide()
        else:
            self.set("backend", "start timed out")

    def restart_backend(self):
        self._bg(self._restart)

    def _restart(self):
        self.stop_backend()
        time.sleep(3)
        self._start_all()

    def stop_backend(self):
        if self.backend_proc and self.backend_proc.poll() is None:
            try:
                self.backend_proc.terminate()
                self.backend_proc.wait(timeout=15)
            except Exception:
                try:
                    self.backend_proc.kill()
                except Exception:
                    pass
        self.backend_proc = None

    def quit_all(self):
        self.closing = True
        self.stop_backend()
        for pid in procs_by_name("VSCodium.exe"):
            try:
                os.kill(pid, 15)
            except Exception:
                pass
        self.destroy()

    def uninstall_gui(self):
        if not self._uninstall_guarded("Uninstall QIROVA IDE?\n\nThis stops everything and deletes:\n"
                                       "- backend, IDE files, logs\n"
                                       "- Desktop + Start Menu shortcuts\n\n"
                                       "The install folder itself is removed\n"
                                       "automatically after this window closes."):
            return
        self._bg(self._do_uninstall)

    def _uninstall_guarded(self, prompt):
        # Never uninstall from a drive root or a non-QIROVA folder.
        root = HOME
        if len(root) <= 3 or not root[1:2] == ":":
            messagebox.showerror("QIROVA", f"Refusing: unsafe location: {root}")
            return False
        for marker in ("VSCodium.exe",
                       os.path.join("backend", "gateway", "main.py")):
            if not os.path.exists(os.path.join(root, marker)):
                messagebox.showerror(
                    "QIROVA",
                    f"Refusing: {root}\ndoes not look like a QIROVA install.")
                return False
        return messagebox.askyesno("QIROVA", prompt)

    def _do_uninstall(self):
        try:
            self.set("backend", "uninstalling...")
            self.stop_backend()
            for pid in procs_by_name("VSCodium.exe"):
                try:
                    os.kill(pid, 15)
                except Exception:
                    pass
            time.sleep(2)
            self._remove_shortcuts()
            home = HOME
            # Delete everything except this running EXE + logs (locked files
            # are skipped, not fatal). A detached cleanup removes the rest.
            me = os.path.abspath(sys.executable if getattr(sys, "frozen", False)
                                 else __file__).lower()
            for entry in os.listdir(home):
                p = os.path.join(home, entry)
                if os.path.abspath(p).lower() == me:
                    continue
                try:
                    if os.path.isdir(p) and not os.path.islink(p):
                        import shutil
                        shutil.rmtree(p, ignore_errors=True)
                    else:
                        os.remove(p)
                except Exception:
                    pass
            # Self-delete: detached cmd waits for this EXE to exit, then
            # removes the folder and itself.
            bat = os.path.join(os.environ.get("TEMP", home), "qirova-uninst.bat")
            with open(bat, "w") as f:
                f.write(f'@echo off\ntimeout /t 4 /nobreak >nul\nrmdir /s /q "{home}"\ndel "%~f0"\n')
            subprocess.Popen(["cmd", "/c", bat], cwd=os.environ.get("TEMP", home),
                             creationflags=0x08000000,
                             stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
            self.closing = True
            try:
                self.destroy()
            except Exception:
                pass
            os._exit(0)
        except Exception:
            log_exc("uninstall")

    def _remove_shortcuts(self):
        try:
            desk = os.path.join(os.path.expanduser("~"), "Desktop", "QIROVA IDE.lnk")
            if os.path.exists(desk):
                os.remove(desk)
        except Exception:
            pass
        try:
            sm = os.path.join(os.environ.get("APPDATA", ""),
                              "Microsoft", "Windows", "Start Menu",
                              "Programs", "QIROVA IDE.lnk")
            if os.path.exists(sm):
                os.remove(sm)
        except Exception:
            pass


if __name__ == "__main__":
    import ctypes as _ct
    _m = _ct.windll.kernel32.CreateMutexW(None, True, "Global\\QIROVA-Launcher-Singleton")
    if _ct.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        try:
            import tkinter.messagebox as _mb
            _root = tk.Tk()
            _root.withdraw()
            _mb.showinfo("QIROVA", "QIROVA is already running.")
            _root.destroy()
        except Exception:
            pass
        sys.exit(0)
    Launcher().mainloop()
