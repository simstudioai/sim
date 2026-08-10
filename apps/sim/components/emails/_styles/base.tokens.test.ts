/**
 * Email styles cannot use CSS variables — clients strip them — so `base.ts`
 * hardcodes hex copies of the platform tokens. Nothing else detects it when
 * `globals.css`, `tailwind.config.ts`, or the chip chrome moves and the copies
 * go stale, which is exactly how they drifted before. This suite is that
 * detector.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baseStyles, colors, typography } from '@/components/emails/_styles'

const APP_ROOT = join(__dirname, '../../..')

const globalsCss = readFileSync(join(APP_ROOT, 'app/_styles/globals.css'), 'utf8')
const tailwindConfig = readFileSync(join(APP_ROOT, 'tailwind.config.ts'), 'utf8')
const chipChrome = readFileSync(
  join(APP_ROOT, '../../packages/emcn/src/components/chip/chip-chrome.ts'),
  'utf8'
)

/**
 * The light-mode `:root` block. Dark mode redefines the same names later in the
 * file, and emails are light-only, so the FIRST definition is the one to read.
 */
function readCssVar(name: string): string {
  const match = globalsCss.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`--${name} not found in globals.css`)
  return match[1].trim()
}

function readTailwindFontSize(name: string): string {
  const match = tailwindConfig.match(new RegExp(`\\b${name}:\\s*'([^']+)'`))
  if (!match) throw new Error(`fontSize.${name} not found in tailwind.config.ts`)
  return match[1]
}

/** Every email color token and the platform variable it copies. */
const COLOR_MIRROR: Record<string, string> = {
  bgOuter: 'surface-1',
  bgCard: 'surface-2',
  surfaceSubtle: 'surface-3',
  textPrimary: 'text-primary',
  textBody: 'text-body',
  textMuted: 'text-muted',
  textInverse: 'text-inverse',
  border: 'border',
  errorBg: 'terminal-status-error-bg',
  errorBorder: 'error-muted',
  footerBg: 'surface-1',
}

/**
 * Tokens with no single CSS variable behind them. Each needs a stated reason —
 * an entry here is a deliberate exception, not an oversight.
 */
const UNMIRRORED_COLORS: Record<string, string> = {
  brandTertiary: 'Runtime-conditional on getBrandConfig(); neutral default equals --text-primary.',
}

describe('email color tokens mirror globals.css', () => {
  for (const [token, cssVar] of Object.entries(COLOR_MIRROR)) {
    it(`colors.${token} equals --${cssVar}`, () => {
      expect(colors[token as keyof typeof colors]).toBe(readCssVar(cssVar))
    })
  }

  it('every color token is either mirrored or has a written exemption', () => {
    const accounted = new Set([...Object.keys(COLOR_MIRROR), ...Object.keys(UNMIRRORED_COLORS)])
    const unaccounted = Object.keys(colors).filter((key) => !accounted.has(key))
    expect(unaccounted).toEqual([])
  })

  it('exemptions state a reason', () => {
    for (const reason of Object.values(UNMIRRORED_COLORS)) {
      expect(reason.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('email type scale mirrors tailwind.config.ts', () => {
  it.each(['caption', 'base', 'md'])('fontSize.%s matches the Tailwind token', (name) => {
    expect(typography.fontSize[name as 'caption' | 'base' | 'md']).toBe(readTailwindFontSize(name))
  })

  it('sm is Tailwind stock 14px — the size text-sm resolves to in chip chrome', () => {
    expect(typography.fontSize.sm).toBe('14px')
    expect(chipChrome).toContain('text-sm')
  })

  it('display is deliberately off-scale (no platform headline-numeral token)', () => {
    expect(typography.fontSize.display).toBe('24px')
    expect(tailwindConfig).not.toContain("'24px'")
  })
})

describe('email geometry mirrors the platform', () => {
  it('the card radius equals --radius', () => {
    // --radius is authored in rem; emails need px.
    expect(readCssVar('radius')).toBe('0.5rem')
    expect(baseStyles.container.borderRadius).toBe('8px')
  })

  it('the CTA transcribes chipGeometryClass', () => {
    const geometry = chipChrome.match(/chipGeometryClass = `([^`]+)`/)?.[1]
    expect(geometry).toBeDefined()
    expect(geometry).toContain('h-[30px]')
    expect(geometry).toContain('rounded-lg')
    expect(geometry).toContain('px-2')
    expect(geometry).toContain('text-sm')

    expect(baseStyles.button.lineHeight).toBe('30px')
    expect(baseStyles.button.borderRadius).toBe('8px')
    expect(baseStyles.button.padding).toBe('0 8px')
    expect(baseStyles.button.fontSize).toBe(typography.fontSize.sm)
  })
})

describe('email font weights stay on the platform scale', () => {
  it('no token uses a weight outside 400/500/600', () => {
    const offScale = Object.entries(baseStyles).filter(([, style]) => {
      const weight = (style as { fontWeight?: unknown }).fontWeight
      return weight !== undefined && ![400, 500, 600].includes(weight as number)
    })
    expect(offScale.map(([name]) => name)).toEqual([])
  })
})
