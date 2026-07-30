/**
 * Generic color-space conversions shared across the app (brand tiles, presence
 * avatars, the PPTX renderer, …). Pure and dependency-free.
 */

/** Parse a hex color string (with or without `#`) into RGB components. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace(/^#/, '')
  if (cleaned.length !== 6 && cleaned.length !== 3) {
    return { r: 0, g: 0, b: 0 }
  }
  const full =
    cleaned.length === 3
      ? cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2]
      : cleaned
  const num = Number.parseInt(full, 16)
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  }
}

/** Convert RGB components (0-255 each) to a 6-digit `#rrggbb` hex string. */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Convert RGB (0-255) to HSL (h: 0-360, s: 0-1, l: 0-1). */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
        break
      case gn:
        h = ((bn - rn) / d + 2) * 60
        break
      case bn:
        h = ((rn - gn) / d + 4) * 60
        break
    }
  }

  return { h, s, l }
}

/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to RGB (0-255). */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(1, s))
  l = Math.max(0, Math.min(1, l))

  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }

  const hueToRgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hNorm = h / 360

  return {
    r: Math.round(hueToRgb(p, q, hNorm + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hNorm) * 255),
    b: Math.round(hueToRgb(p, q, hNorm - 1 / 3) * 255),
  }
}

/**
 * Render a resolved color + alpha as a CSS color string: the bare hex when
 * fully opaque, otherwise `rgba(r,g,b,a)`. Accepts hex with or without `#`.
 */
export function toCssColor(color: string, alpha: number): string {
  const hex = color.startsWith('#') ? color : `#${color}`
  if (alpha >= 1) return hex
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`
}
