(async () => {
  const r = __probe.refs()
  const app = r.app
  let renders = 0
  const orig = app.render.bind(app)
  app.render = function (...a) {
    renders++
    return orig(...a)
  }
  const t0 = performance.now()
  await new Promise((res) => setTimeout(res, 5000))
  const elapsed = (performance.now() - t0) / 1000
  app.render = orig
  return {
    renders,
    seconds: +elapsed.toFixed(2),
    renderFps: +(renders / elapsed).toFixed(1),
    ticker: { started: app.ticker.started, maxFPS: app.ticker.maxFPS, minFPS: app.ticker.minFPS, FPS: app.ticker.FPS, deltaMS: app.ticker.deltaMS },
    display: { dpr: devicePixelRatio },
  }
})()
