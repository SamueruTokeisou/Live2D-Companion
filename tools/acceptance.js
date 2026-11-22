(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const checks = [];
  function check(name, pass, detail) { checks.push({ name, pass: !!pass, detail }); }
  const meta = await __stageRpc('meta');
  await shell.set({ idle: false, randomFaces: false });
  check('模型表情与热区', meta.exprs.length === 23 && meta.regions.length === 13, { expressions: meta.exprs.length, regions: meta.regions.length });
  await __stageRpc('exprClear');
  await __stageRpc('expr', { name: '爱心眼' });
  await wait(400);
  const heart = await __stageRpc('meta');
  check('表情切换', heart.active.exprs.includes('爱心眼'), heart.active.exprs);
  await __stageRpc('expr', { name: '圈圈眼' });
  await wait(300);
  const circle = await __stageRpc('meta');
  check('眼型互斥', circle.active.exprs.includes('圈圈眼') && !circle.active.exprs.includes('爱心眼'), circle.active.exprs);
  await __stageRpc('pose', { name: '举手' });
  await wait(800);
  const raised = (await __stageRpc('meta')).active;
  check('举手姿势', raised.hands?.right === '抚胸' && await __probe.readAtUpdate('Movement2') > 0.9, raised);
  await __stageRpc('pose', { name: '默认手' });
  await __stageRpc('exprClear');
  const before = await shell.bounds();
  shell.moveBy(-70, 20); await wait(300);
  const moved = await shell.bounds();
  check('窗口移动', moved.x !== before.x || moved.y !== before.y, { before, moved });
  shell.moveBy(before.x - moved.x, before.y - moved.y);
  const z0 = __probe.zoom();
  __probe.zoomAt('头', -120); await wait(500);
  check('滚轮缩放处理', __probe.zoom() !== z0, { before: z0, after: __probe.zoom() });
  await shell.set({ zoom: 0.6, targetFps: 30, idle: true, randomFaces: true });
  await wait(400);
  const a = __probe.frameInfo(); await wait(3000); const b = __probe.frameInfo();
  check('30帧推进', b.ticks > a.ticks && b.fps === 30, { ticks: b.ticks - a.ticks, durationMs: 3000, info: b });
  const faults = Live2DStage.faults();
  check('渲染故障', !faults.some(f => /error|rejection|crash/.test(f.kind)), faults.map(f => ({ kind: f.kind })));
  return { at: new Date().toISOString(), checks, allPassed: checks.every(c => c.pass) };
})()
