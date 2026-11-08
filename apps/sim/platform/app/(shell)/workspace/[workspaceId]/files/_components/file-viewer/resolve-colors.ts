/**
 * EMCN tokens as sRGB hex, for renderers that take colors in JavaScript (Monaco, Mermaid, ECharts):
 * one probe element per token inside `host`, measured through a canvas so any CSS color form
 * (oklch, color-mix) arrives as hex.
 */
export function tokenColors(host: HTMLElement, tokens: readonly string[]): Record<string, string> {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const probe = document.createElement('span')
  probe.hidden = true
  host.appendChild(probe)
  const colors: Record<string, string> = {}
  for (const token of tokens) {
    probe.style.color = `var(${token})`
    const computed = getComputedStyle(probe).color
    if (!context) {
      colors[token] = computed
      continue
    }
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = computed
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    const hex = [r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')
    colors[token] = a === 255 ? `#${hex}` : `#${hex}${a.toString(16).padStart(2, '0')}`
  }
  probe.remove()
  return colors
}
