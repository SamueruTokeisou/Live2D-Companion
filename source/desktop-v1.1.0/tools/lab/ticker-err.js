(async () => {
  const errs = []
  const onErr = (e) => errs.push('error: ' + (e.message || e.reason || String(e)))
  const onRej = (e) => errs.push('rejection: ' + (e.reason?.message || String(e.reason)))
  window.addEventListener('error', onErr)
  window.addEventListener('unhandledrejection', onRej)

  const r = __probe.refs()
  const app = r.app
  const before = app.ticker.count
  let manualErr = null
  try {
    app.ticker.update(performance.now())
  } catch (e) {
    manualErr = { message: e.message, stack: String(e.stack || '').split('\n').slice(0, 6) }
  }
  const after = app.ticker.count

  await new Promise((res) => setTimeout(res, 600))
  window.removeEventListener('error', onErr)
  window.removeEventListener('unhandledrejection', onRej)
  const afterWait = app.ticker.count

  return { before, after, afterWait, manualErr, errs: errs.slice(0, 5), started: app.ticker.started, maxFPS: app.ticker.maxFPS }
})()
