(() => {
  const r = __probe.refs()
  const t = r.app.ticker
  window.__dragRec = { on: true, deltas: [], wall: [] }
  let lastWall = performance.now()
  const rec = window.__dragRec
  const fn = () => {
    rec.deltas.push(+t.deltaMS.toFixed(2))
    const now = performance.now()
    rec.wall.push(+(now - lastWall).toFixed(1))
    lastWall = now
  }
  t.add(fn)
  rec.stop = () => t.remove(fn)
  return { started: true }
})()
