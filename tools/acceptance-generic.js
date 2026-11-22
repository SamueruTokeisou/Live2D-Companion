(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const meta = await __stageRpc('meta');
  add('第二角色加载', Live2DStage.generic && meta.model === 'Haru', { model: meta.model, params: Live2DStage.stage.param.count });
  add('表情读取与去重', meta.exprs.length === 8 && new Set(meta.exprs).size === 8, meta.exprs);
  const result = await __stageRpc('expr', { name: 'F02' });
  await wait(500);
  add('通用表情', result.active.exprs.includes('F02'), result.active);
  await __stageRpc('exprClear');
  const el = document.querySelector('#stage');
  el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 190, clientY: 190, bubbles: true }));
  await wait(150);
  const bubble = document.querySelector('#bubble');
  add('点击事件处理与反馈', __probe.history().length > 0 && getComputedStyle(bubble).display !== 'none' && bubble.textContent.length > 0);
  await shell.stageRpc('local:visibility', { visible: false });
  await wait(300); const a = __probe.frameInfo(); await wait(500); const b = __probe.frameInfo();
  add('通用隐藏停帧', a.halted && a.ticks === b.ticks);
  await shell.stageRpc('local:visibility', { visible: true }); await wait(600);
  add('通用恢复渲染', !__probe.frameInfo().halted && __probe.frameInfo().ticks > b.ticks);
  await shell.set({ targetFps: 60 }); await wait(200);
  add('60帧设置', __probe.frameInfo().fps === 60);
  await shell.set({ targetFps: 30 });
  add('无渲染错误', Live2DStage.faults().length === 0, Live2DStage.faults());
  return { at: new Date().toISOString(), checks, allPassed: checks.every(c => c.pass) };
})()
