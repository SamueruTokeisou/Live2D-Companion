(async () => {
  const r = __probe.refs()
  const t = r.app.ticker
  window.__tickerStops = []
  const origStop = t.stop.bind(t)
  t.stop = function (...a) {
    window.__tickerStops.push(String(new Error('stop called').stack || '').split('\n').slice(1, 6))
    return origStop(...a)
  }
  const origStart = t.start.bind(t)
  t.start = function (...a) {
    window.__tickerStops.push(['start', String(new Error('start called').stack || '').split('\n').slice(1, 6)])
    return origStart(...a)
  }
  const c0 = t.count
  await new Promise((res) => setTimeout(res, 1200))
  const c1 = t.count
  return {
    c0, c1,
    started: t.started,
    stops: (window.__tickerStops || []).slice(0, 6),
    fps: t.FPS,
  }
})()
