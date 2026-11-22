// Local generic adapter: only existing standard parameters, never DeepSeek-specific keys.
import { createStage } from '../src/stage/engine.js';
import { createViewport } from '../src/stage/viewport.js';
import { createLayerStack } from '../src/stage/layers.js';

export async function startGeneric(shell, settings, caps) {
  const stage = await createStage({ container: document.querySelector('#stage'), modelUrl: caps.model.url });
  const viewport = createViewport({ model: stage.model, app: stage.app, margin: 0.91 });
  viewport.observe(document.querySelector('#stage'));
  const layers = createLayerStack({ param: stage.param, part: stage.part });
  let cfg = settings, active = [], look = { x: 0, y: 0 }, touchUntil = 0, nextBlink = 0, blinkAt = -10000;
  const faults = [], history = [];
  const put = (id, value) => {
    const p = stage.param.info(id);
    if (p) stage.param.set(id, Math.max(p.min, Math.min(p.max, value)));
  };
  const bubble = document.querySelector('#bubble');
  let bubbleTimer;
  function say(text) {
    if (cfg.bubble === false) return;
    bubble.textContent = text;
    bubble.classList.remove('empty');
    bubble.classList.add('on');
    bubble.style.fontSize = '18px';
    Object.assign(bubble.style, { position: 'absolute', top: '12px', right: '12px', opacity: '1', display: 'block' });
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { bubble.classList.add('empty'); bubble.classList.remove('on'); bubble.style.display = 'none'; bubble.textContent = ''; }, 2200);
  }
  function expr(name) {
    layers.removeSource('generic');
    active = [];
    const def = caps.expressions.find(e => e.name === name);
    if (def) { layers.addExpression(name, def.params, { source: 'generic', fade: 0.2 }); active = [name]; }
    return { active: { exprs: active, pose: null } };
  }
  function update() {
    const t = performance.now();
    if (cfg.gaze !== false) {
      const gain = Number(cfg.strength ?? 1);
      put('ParamAngleX', look.x * 18 * gain); put('ParamAngleY', look.y * 12 * gain);
      put('ParamEyeBallX', look.x * 0.7); put('ParamEyeBallY', look.y * 0.7);
    }
    if (cfg.idle !== false) {
      put('ParamBreath', (Math.sin(t / 1200) + 1) / 2);
      if (t > nextBlink) { blinkAt = t; nextBlink = t + 2800 + Math.random() * 4000; }
      const dt = t - blinkAt;
      if (dt < 180) {
        const open = Math.abs(dt / 90 - 1);
        put('ParamEyeLOpen', open); put('ParamEyeROpen', open);
      }
    }
    if (t < touchUntil) put('ParamAngleZ', Math.sin((touchUntil - t) / 100) * 5);
    layers.apply();
  }
  stage.onBeforeUpdate(update);
  await stage.frameLoop.start({ fps: cfg.targetFps === 60 ? 60 : 30 });
  shell.onStageActive?.(on => on ? stage.frameLoop.wake() : stage.frameLoop.halt());
  shell.onSettings?.(next => { cfg = next; stage.frameLoop.setFps(cfg.targetFps === 60 ? 60 : 30); });
  shell.onCursor?.(p => {
    look.x = Math.max(-1, Math.min(1, (p.x - innerWidth / 2) / Math.max(200, innerWidth)));
    look.y = Math.max(-1, Math.min(1, -(p.y - innerHeight / 3) / Math.max(200, innerHeight)));
  });
  // Dynamic alpha hit testing keeps transparent pixels usable by the desktop.
  let lastRead = 0;
  document.addEventListener('pointermove', e => {
    if (e.buttons || cfg.clickThrough || performance.now() - lastRead < 100) return;
    lastRead = performance.now();
    const a = stage.sampleAlpha(e.clientX, e.clientY).alpha;
    shell.setPassThrough(a != null && a < 10);
  });
  const el = document.querySelector('#stage');
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.button === 1 || e.button === 2) {
      drag = { x: e.screenX, y: e.screenY };
      shell.dragBegin(e.screenX, e.screenY); el.setPointerCapture(e.pointerId); e.preventDefault();
    } else if (e.button === 0) {
      touchUntil = performance.now() + 700;
      history.push({ kind: 'tap', at: Date.now() }); if (history.length > 30) history.shift();
      say('你好呀～');
    }
  });
  el.addEventListener('pointermove', e => { if (drag) shell.dragMove(e.screenX, e.screenY); });
  const end = () => { if (drag) { drag = null; shell.dragEnd(); } };
  window.addEventListener('pointerup', end); window.addEventListener('blur', end);
  window.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('wheel', async e => {
    if (!(e.shiftKey || e.buttons & 4)) return;
    e.preventDefault();
    const b = await shell.bounds(); const k = e.deltaY < 0 ? 1.07 : 1 / 1.07;
    shell.fit(Math.max(180, Math.min(800, b.width * k)), Math.max(280, Math.min(screen.availHeight, b.height * k)));
  }, { passive: false });
  const help = document.createElement('button');
  help.textContent = '设置'; help.title = '通用角色模式：点击互动，右键拖动，Shift+滚轮缩放';
  Object.assign(help.style, { position: 'fixed', right: '6px', bottom: '6px', zIndex: 30, borderRadius: '12px', padding: '5px 12px' });
  help.onclick = () => shell.openSettings(); document.body.append(help);
  const meta = () => ({ model: caps.model.name, regions: [], exprs: caps.expressions.map(e => e.name), poses: [], active: { exprs: active }, generic: true });
  window.__stageRpc = async (op, p) => {
    if (op === 'meta') return meta();
    if (op === 'expr') return expr(active.includes(p?.name) ? null : p?.name);
    if (op === 'exprClear') return expr(null);
    if (op === 'catalog') return { protocol: 1, expressions: caps.expressions.map(e => e.name), poses: [], gestures: [], acts: [], idleEnabled: cfg.idle !== false };
    if (op === 'history') return history;
    if (op === 'regions') return [];
    return { error: '此角色使用通用模式，该专属操作尚未适配。' };
  };
  window.__probe = { frameInfo: () => stage.frameLoop.info(), zones: () => ({ count: 0, generic: true }), history: () => history };
  window.Live2DStage = { stage, faults: () => faults, generic: true };
  window.addEventListener('error', e => faults.push({ kind: 'error', message: e.message }));
  window.addEventListener('unhandledrejection', e => faults.push({ kind: 'rejection', message: String(e.reason) }));
  stage.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (!sessionStorage.genericRecovery) { sessionStorage.genericRecovery = '1'; setTimeout(() => location.reload(), 500); } });
  document.title = `stage · ${caps.model.name} · 通用模式`;
  return stage;
}
