/**
 * Email styles cannot use CSS variables — clients strip them — so `base.ts`
 * hardcodes hex copies of the platform tokens. This suite fails when those
 * copies drift from `globals.css` or the chip chrome.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baseStyles, colors, typography } from '@/components/emails/_styles'

const APP_ROOT = join(__dirname, '../../..')

const globalsCss = readFileSync(join(APP_ROOT, 'app/_styles/globals.css'), 'utf8')
const chipChrome = readFileSync(
  join(APP_ROOT, '../../packages/emcn/src/components/chip/chip-chrome.ts'),
  'utf8'
)

/**
 * The type scale moved into the `@theme` block when the v4 upgrade removed
 * `tailwind.config.ts`. This scans the whole file rather than that block, so it
 * also picks up the `--text-*` colour tokens — harmless because only the size
 * keys are asserted below. Paired sub-keys such as `--text-xs--line-height` are
 * not sizes, so the double dash is excluded.
 */
const tailwindFontSize: Record<string, string> = Object.fromEntries(
  [...globalsCss.matchAll(/^\s*--text-([a-z0-9-]+):\s*([^;]+);/gm)]
    .filter(([, name]) => !name.includes('--'))
    .map(([, name, value]) => [name, value.trim()])
)

/**
 * Dark mode redefines the same names later in the file and emails are
 * light-only, so the FIRST definition is the one to read.
 */
function readCssVar(name: string): string {
  const match = globalsCss.match(new RegExp(`(?:^|[^-\\w])--${name}:\\s*([^;]+);`, 'm'))
  if (!match) throw new Error(`--${name} not found in globals.css`)
  return match[1].trim()
}

/** Every email color token and the platform variable it copies. */
const COLOR_MIRROR: Record<string, string> = {
  bgOuter: 'surface-1',
  bgCard: 'surface-2',
  surfaceSubtle: 'surface-3',
  textPrimary: 'text-primary',
  textBody: 'text-body',
  textSecondary: 'text-secondary',
  textMuted: 'text-muted',
  textInverse: 'text-inverse',
  border: 'border',
  errorBg: 'terminal-status-error-bg',
  errorBorder: 'error-muted',
  footerBg: 'surface-1',
}

/** Tokens with no single CSS variable behind them, and why. */
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
    expect(Object.keys(colors).filter((key) => !accounted.has(key))).toEqual([])
  })
})

describe('email type scale mirrors the globals.css @theme scale', () => {
  it.each(['caption', 'small', 'base', 'md'])('fontSize.%s matches the Tailwind token', (name) => {
    expect(typography.fontSize[name as keyof typeof typography.fontSize]).toBe(
      tailwindFontSize[name]
    )
  })

  it('sm is Tailwind stock 14px — the size text-sm resolves to in chip chrome', () => {
    expect(typography.fontSize.sm).toBe('14px')
    expect(tailwindFontSize.sm).toBeUndefined()
    expect(chipChrome).toContain('text-sm')
  })

  it('display is deliberately off-scale — the platform has no headline numeral', () => {
    expect(Object.values(tailwindFontSize)).not.toContain(typography.fontSize.display)
  })
})

describe('email geometry mirrors the platform', () => {
  it('the card radius equals --radius', () => {
    // --radius is authored in rem; emails need px.
    expect(readCssVar('radius')).toBe('0.5rem')
    expect(baseStyles.container.borderRadius).toBe('8px')
  })

  it('the CTA transcribes chipGeometryClass', () => {
    // chipGeometryClass composes the unrounded geometry with the default radius,
    // so the transcription reads both halves rather than one literal.
    expect(chipChrome).toMatch(
      /chipGeometryClass = `\$\{chipGeometryUnroundedClass\} \$\{chipRadiusClass\}`/
    )
    const unrounded = chipChrome.match(/chipGeometryUnroundedClass = `([^`]+)`/)?.[1]
    const radius = chipChrome.match(/chipRadiusClass = '([^']+)'/)?.[1]
    expect(unrounded).toBeDefined()
    expect(radius).toBeDefined()
    const geometry = `${unrounded} ${radius}`
    for (const token of ['h-[30px]', 'rounded-lg', 'px-2', 'text-sm']) {
      expect(geometry).toContain(token)
    }

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
