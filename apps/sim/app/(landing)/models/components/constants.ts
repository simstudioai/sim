import { MODEL_CATALOG_PROVIDERS } from '@/app/(landing)/models/utils'

/**
 * Luminance ceiling (Rec. 601, 0-255) above which a near-gray provider color is
 * too light to read as a dot or bar on the landing's light background. OpenAI's
 * near-white brand gray sits well above this, so it gets darkened to stay visible
 * on the timeline and comparison charts.
 */
const MAX_LUMINANCE = 140

/**
 * Only desaturated (near-gray) colors are darkened. Saturated brand colors stay
 * readable on white thanks to their hue, so a bright yellow or orange is left
 * exactly as the brand declares it.
 */
const MAX_GRAY_SATURATION = 0.15

/** Fallback when a provider declares no brand color: a readable mid-dark gray. */
const FALLBACK_COLOR = '#666666'

/** Darkens a too-light near-gray color toward the readable ceiling; passes others through. */
function clampToReadable(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex

  const value = Number.parseInt(match[1], 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff

  const max = Math.max(r, g, b)
  const saturation = max === 0 ? 0 : (max - Math.min(r, g, b)) / max
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  if (luminance <= MAX_LUMINANCE || saturation > MAX_GRAY_SATURATION) return hex

  const factor = MAX_LUMINANCE / luminance
  const toHex = (channel: number) =>
    Math.round(channel * factor)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const colorMap = new Map(
  MODEL_CATALOG_PROVIDERS.filter((p) => p.color).map((p) => [
    p.id,
    clampToReadable(p.color as string),
  ])
)

/** Provider brand color, darkened when too light to read on the light background. */
export function getProviderColor(providerId: string): string {
  return colorMap.get(providerId) ?? FALLBACK_COLOR
}
