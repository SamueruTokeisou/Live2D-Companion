"""Local-only role manager. All model processing happens on private copies."""
from pathlib import Path
import json, os, sys, uuid, shutil, subprocess, threading, time, urllib.request, hashlib
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / 'runtime/desktop-v1.1.0/大肥鱼Live2d桌宠-发布版-win32-x64/大肥鱼Live2d桌宠.exe'
PROFILES = ROOT / 'profiles'

def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def atomic_json(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)

def profiles():
    result = []
    for file in sorted(PROFILES.glob('*.json')):
        try:
            p = read_json(file)
            if p.get('id') == file.stem and p['id'].replace('-', '').isalnum(): result.append(p)
        except (ValueError, KeyError): pass
    return result

def data_dir(profile):
    return ROOT / 'data' / profile['id']

def rpc(profile, op, payload=None, timeout=4):
    ep = read_json(data_dir(profile) / 'integration/endpoint.json')
    # Endpoint files are local state; never contact a remote address from one.
    if ep['url'] != 'http://127.0.0.1:' + str(int(ep['port'])):
        raise ValueError('本地控制地址无效')
    req = urllib.request.Request(ep['url'] + '/api/stage/' + op,
        data=json.dumps(payload or {}).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'X-Stage-Token': ep['token']})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)

def alive(profile):
    try:
        ep = read_json(data_dir(profile) / 'integration/endpoint.json')
        result = rpc(profile, 'local:ping', timeout=0.5)
        return result.get('ok', False) and result.get('value', {}).get('pid') == ep.get('pid')
    except Exception: return False

def stop_all():
    for p in profiles():
        if alive(p): rpc(p, 'local:quit')
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if not any(alive(p) for p in profiles()):
            time.sleep(0.4)
            return
        time.sleep(0.15)
    raise RuntimeError('桌宠尚未正常退出，请先从托盘退出再切换；没有强制终止进程。')

def start(profile, debug=False):
    if not EXE.is_file(): raise FileNotFoundError('桌宠主程序不存在：' + str(EXE))
    model = ROOT / profile['model']
    if not model.is_file(): raise FileNotFoundError('角色模型不存在：' + str(model))
    if alive(profile): return
    stop_all()
    env = os.environ.copy(); env['STAGE_HOME'] = str(data_dir(profile))
    env['STAGE_MANAGER_PYTHON'] = str(Path(sys.executable).with_name('pythonw.exe'))
    env['STAGE_MANAGER_FILE'] = str(Path(__file__).resolve())
    env.pop('ELECTRON_RUN_AS_NODE', None)
    args = [str(EXE)]
    if debug: args.append('--remote-debugging-port=9237')
    subprocess.Popen(args, cwd=EXE.parent, env=env, creationflags=subprocess.CREATE_NO_WINDOW)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            ready = rpc(profile, 'meta', timeout=1)
            if alive(profile) and ready.get('ok') and ready.get('value', {}).get('model'):
                break
        except Exception:
            pass
        time.sleep(0.25)
    else:
        raise RuntimeError('桌宠没有完成模型加载。请查看 ' + str(data_dir(profile) / 'logs'))
    atomic_json(ROOT / 'data/last-profile.json', {'id': profile['id']})

def import_model(model, name, mode='auto'):
    model = Path(model).resolve()
    if not model.name.endswith('.model3.json'): raise ValueError('请选择 .model3.json 文件')
    obj = read_json(model); refs = obj.get('FileReferences', {})
    if not refs.get('Moc') or not refs.get('Textures'): raise ValueError('缺少 Moc 或 Textures 引用')
    base = model.parent
    wanted = {model.name}
    def add(rel):
        if not isinstance(rel, str): raise ValueError('模型文件路径格式无效')
        path = (base / rel).resolve()
        if not path.is_relative_to(base): raise ValueError('模型引用了目录外文件：' + rel)
        if not path.is_file(): raise FileNotFoundError('模型缺少文件：' + rel)
        wanted.add(path.relative_to(base).as_posix())
    for k in ['Moc', 'Physics', 'Pose', 'DisplayInfo', 'UserData']:
        if refs.get(k): add(refs[k])
    for rel in refs['Textures']: add(rel)
    for exp in refs.get('Expressions', []): add(exp['File'])
    for motions in refs.get('Motions', {}).values():
        for motion in motions:
            add(motion['File'])
            if motion.get('Sound'): add(motion['Sound'])
    # Only conventional asset folders; never copy PSDs, programs or parent folders.
    for folder in ['Exp3', 'expressions', 'Expressions', 'Animation', 'Motions', 'motions']:
        source = base / folder
        if source.is_dir():
            for file in source.rglob('*.json'):
                if file.name.endswith(('.exp3.json', '.motion3.json')): add(file.relative_to(base).as_posix())
    for rel in wanted:
        if rel.endswith('.json'): read_json(base / rel)
    if mode == 'auto':
        with (base / refs['Moc']).open('rb') as f:
            signature = hashlib.file_digest(f, 'sha256').hexdigest()
        mode = 'deepseek' if signature == 'b708e7953db9deeb5bf783643255dee1f3bf20d24786bc287e72d07e1b1052e6' else 'generic'
    ident = 'role-' + uuid.uuid4().hex[:12]
    dest = ROOT / 'models' / ident
    dest.mkdir(parents=True, exist_ok=False)
    for rel in wanted:
        target = dest / rel; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(base / rel, target)
    before = after = 0
    for rel in refs['Textures']:
        path = dest / rel
        with Image.open(path) as img:
            before += img.width * img.height * 4
            if max(img.size) > 2048:
                img.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                img.save(path, format='PNG')
            after += img.width * img.height * 4
    # Register adjacent assets for standard players as well as this desktop pet.
    if not refs.get('Expressions'):
        refs['Expressions'] = [{'Name': Path(x).name.removesuffix('.exp3.json'), 'File': x}
                              for x in sorted(wanted) if x.endswith('.exp3.json')]
    if not refs.get('Motions'):
        refs['Motions'] = {'Imported': [{'File': x} for x in sorted(wanted) if x.endswith('.motion3.json')]}
    atomic_json(dest / model.name, obj)
    profile = {'id': ident, 'name': name or model.name.removesuffix('.model3.json'), 'mode': mode,
               'model': (dest / model.name).relative_to(ROOT).as_posix(), 'source': str(model),
               'textureMiBBefore': round(before / 1048576, 2), 'textureMiBAfter': round(after / 1048576, 2)}
    cfg = {'model': str(dest / model.name), 'profileMode': mode, 'autoStart': False,
           'updateCheck': False, 'nativeCore': False, 'engine': 'default',
           'width': 380, 'height': 620, 'targetFps': 30, 'zoom': 0.6 if mode == 'deepseek' else 1,
           'gaze': True, 'idle': True, 'randomFaces': mode == 'deepseek',
           'alwaysOnTop': True, 'clickThrough': False, 'idleSpeed': 0.6}
    atomic_json(data_dir(profile) / 'settings.json', cfg)
    atomic_json(PROFILES / (ident + '.json'), profile)
    return profile

class Manager(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('我的 Live2D 桌宠 · 角色管理'); self.geometry('650x440'); self.minsize(600, 420)
        self.option_add('*Font', ('Microsoft YaHei UI', 10))
        frame = ttk.Frame(self, padding=22); frame.pack(fill='both', expand=True)
        ttk.Label(frame, text='我的 Live2D 桌宠', font=('Microsoft YaHei UI', 19, 'bold')).pack(anchor='w')
        ttk.Label(frame, text='本地运行 · 角色单独保存设置 · 导入时保留原文件').pack(anchor='w', pady=(4, 18))
        self.choice = ttk.Combobox(frame, state='readonly'); self.choice.pack(fill='x')
        self.choice.bind('<<ComboboxSelected>>', lambda e: self.describe())
        self.info = tk.StringVar(); ttk.Label(frame, textvariable=self.info, wraplength=580).pack(anchor='w', pady=12)
        buttons = ttk.Frame(frame); buttons.pack(fill='x', pady=5)
        self.buttons = []
        for label, command in [('启动 / 切换', lambda: self.work(lambda: start(self.selected()), '已启动所选角色')),
                               ('桌宠设置', self.settings), ('退出桌宠', lambda: self.work(stop_all, '桌宠已退出'))]:
            btn = ttk.Button(buttons, text=label, command=command); btn.pack(side='left', padx=(0, 8)); self.buttons.append(btn)
        more = ttk.Frame(frame); more.pack(fill='x', pady=8)
        for label, command in [('导入新角色…', self.import_dialog), ('打开角色文件夹', self.open_model), ('使用说明', self.help)]:
            btn = ttk.Button(more, text=label, command=command); btn.pack(side='left', padx=(0, 8)); self.buttons.append(btn)
        ttk.Separator(frame).pack(fill='x', pady=15)
        ttk.Label(frame, text='操作：左键互动；中键 / 右键拖动；Shift+滚轮缩放。\n找不到角色：Ctrl+Alt+L 解除穿透；Ctrl+Alt+Q 退出。\n关闭本窗口不会退出桌宠。', wraplength=580).pack(anchor='w')
        self.status = tk.StringVar(value='就绪'); ttk.Label(frame, textvariable=self.status, wraplength=580).pack(anchor='w', pady=12)
        self.refresh()
    def refresh(self, ident=None):
        self.items = profiles(); self.choice['values'] = [p['name'] for p in self.items]
        if self.items:
            if not ident:
                try: ident = read_json(ROOT / 'data/last-profile.json')['id']
                except Exception: pass
            self.choice.current(next((i for i, p in enumerate(self.items) if p['id'] == ident), 0)); self.describe()
    def selected(self):
        i = self.choice.current()
        if i < 0: raise ValueError('请先导入或选择角色')
        return self.items[i]
    def describe(self):
        p = self.selected()
        self.info.set(('大肥鱼专属模式：分区互动、表情、手势和待机动作。' if p.get('mode') == 'deepseek' else
                      '通用模式：标准参数视线、眨眼、呼吸、点击反馈和模型表情。专属手势需要后续适配。') +
                     '\n每个角色使用独立的本地配置。')
    def work(self, function, success):
        for b in self.buttons: b['state'] = 'disabled'
        self.status.set('处理中，请稍候…')
        def worker():
            try:
                result = function()
                self.after(0, lambda: done(result, None))
            except Exception as error:
                msg = str(error); self.after(0, lambda: done(None, msg))
        def done(result, error):
            for b in self.buttons: b['state'] = 'normal'
            self.status.set(error or success)
            if error: messagebox.showerror('操作未完成', error, parent=self)
            if isinstance(result, dict) and result.get('id'): self.refresh(result['id'])
        threading.Thread(target=worker, daemon=True).start()
    def settings(self):
        p = self.selected()
        if not alive(p): messagebox.showinfo('先启动角色', '请先点击“启动 / 切换”。', parent=self); return
        self.work(lambda: rpc(p, 'local:settings'), '已打开桌宠设置')
    def import_dialog(self):
        path = filedialog.askopenfilename(title='选择模型入口 .model3.json', initialdir=str(ROOT), filetypes=[('Live2D 模型', '*.model3.json')])
        if not path: return
        name = simpledialog.askstring('角色名称', '给这个角色起个名字：', initialvalue=Path(path).name.removesuffix('.model3.json'), parent=self)
        if name is None: return
        self.work(lambda: import_model(path, name.strip()), '角色已导入。点击“启动 / 切换”即可使用。')
    def open_model(self): os.startfile(str((ROOT / self.selected()['model']).parent))
    def help(self):
        local = ROOT / '桌宠使用说明.md'
        os.startfile(str(local if local.exists() else ROOT / 'README.md'))

if __name__ == '__main__':
    try:
        if '--start' in sys.argv:
            ps = profiles()
            if not ps: raise ValueError('请先打开角色管理器，导入你有权使用的 .model3.json 模型。')
            try: ident = read_json(ROOT / 'data/last-profile.json')['id']
            except Exception: ident = 'deepseek'
            start(next((p for p in ps if p['id'] == ident), ps[0]))
        else: Manager().mainloop()
    except Exception as e:
        root = tk.Tk(); root.withdraw(); messagebox.showerror('桌宠启动失败', str(e)); root.destroy()
