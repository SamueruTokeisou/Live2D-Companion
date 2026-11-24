// Preserve valid placement; bring a disconnected-screen window back into view.
export function visiblePosition(bounds, areas) {
  if (!areas.length) return { x: bounds.x, y: bounds.y }
  const visible = areas.some(a => Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x) >= Math.min(64, bounds.width)
    && Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y) >= Math.min(64, bounds.height))
  if (visible) return { x: bounds.x, y: bounds.y }
  const area = areas.reduce((best, a) => {
    const distance = r => Math.hypot(bounds.x - (r.x + r.width / 2), bounds.y - (r.y + r.height / 2))
    return distance(a) < distance(best) ? a : best
  })
  return { x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))) }
}
