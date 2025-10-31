const APP_COLORS = [
  { from: '#4F46E5', to: '#7C3AED' }, // indigo to purple
  { from: '#7C3AED', to: '#C026D3' }, // purple to fuchsia
  { from: '#EC4899', to: '#F97316' }, // pink to orange
  { from: '#14B8A6', to: '#10B981' }, // teal to emerald
  { from: '#6366F1', to: '#8B5CF6' }, // indigo to violet
  { from: '#F59E0B', to: '#F97316' }, // amber to orange
]

interface PresenceColorPalette {
  gradient: string
  accentColor: string
  baseColor: string
}

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}){1,2}$/

function hashIdentifier(identifier: string | number): number {
  if (typeof identifier === 'number' && Number.isFinite(identifier)) {
    return Math.abs(Math.trunc(identifier))
  }

  if (typeof identifier === 'string') {
    return Math.abs(Array.from(identifier).reduce((acc, char) => acc + char.charCodeAt(0), 0))
  }

  return 0
}

function withAlpha(hexColor: string, alpha: number): string {
  if (!HEX_COLOR_REGEX.test(hexColor)) {
    return hexColor
  }

  const normalized = hexColor.slice(1)
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized

  const r = Number.parseInt(expanded.slice(0, 2), 16)
  const g = Number.parseInt(expanded.slice(2, 4), 16)
  const b = Number.parseInt(expanded.slice(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${Math.min(Math.max(alpha, 0), 1)})`
}

function buildGradient(fromColor: string, toColor: string, rotationSeed: number): string {
  const rotation = (rotationSeed * 25) % 360
  return `linear-gradient(${rotation}deg, ${fromColor}, ${toColor})`
}

export function getPresenceColors(
  identifier: string | number,
  explicitColor?: string
): PresenceColorPalette {
  const paletteIndex = hashIdentifier(identifier)

  if (explicitColor) {
    const normalizedColor = explicitColor.trim()
    const lighterShade = HEX_COLOR_REGEX.test(normalizedColor)
      ? withAlpha(normalizedColor, 0.85)
      : normalizedColor

    return {
      gradient: buildGradient(lighterShade, normalizedColor, paletteIndex),
      accentColor: normalizedColor,
      baseColor: lighterShade,
    }
  }

  const colorPair = APP_COLORS[paletteIndex % APP_COLORS.length]

  return {
    gradient: buildGradient(colorPair.from, colorPair.to, paletteIndex),
    accentColor: colorPair.to,
    baseColor: colorPair.from,
  }
}
