/**
 * The hairline pass has no other safety net: it rewrites Tailwind's own output,
 * so a miss shows up as a half-device-pixel line weight on retina — invisible
 * in CI and easy to miss by eye. These cases pin both directions.
 *
 * @vitest-environment node
 */
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import hairline from '@/lib/postcss/hairline-border-width.mjs'

const FROM = '/repo/apps/sim/app/_styles/globals.css'

async function run(css: string, from = FROM): Promise<string> {
  const result = await postcss([hairline()]).process(css, { from })
  return result.css
}

describe('hairline border width', () => {
  describe('rewrites the utilities that carried borderWidth.DEFAULT in v3', () => {
    /** Every emitted form, in the shape Tailwind v4 actually produces. */
    const REWRITTEN: [string, string][] = [
      ['.border', 'border-width: 1px'],
      ['.border-x', 'border-inline-width: 1px'],
      ['.border-y', 'border-block-width: 1px'],
      ['.border-t', 'border-top-width: 1px'],
      ['.border-r', 'border-right-width: 1px'],
      ['.border-b', 'border-bottom-width: 1px'],
      ['.border-l', 'border-left-width: 1px'],
      ['.border-s', 'border-inline-start-width: 1px'],
      ['.border-e', 'border-inline-end-width: 1px'],
    ]

    it.each(REWRITTEN)('%s', async (selector, decl) => {
      const out = await run(`${selector} { ${decl} }`)
      expect(out).toContain('var(--border-width)')
      expect(out).not.toContain('1px')
    })

    it('rewrites the divide utilities inside their calc()', async () => {
      const out = await run(
        ':where(.divide-y > :not(:last-child)) { border-top-width: calc(1px * var(--tw-divide-y-reverse)) }'
      )
      expect(out).toContain('calc(var(--border-width) * var(--tw-divide-y-reverse))')
    })

    it('rewrites through variants, arbitrary variants and the important marker', async () => {
      const out = await run(`
        .sm\\:border { border-width: 1px }
        .dark\\:hover\\:border-t { border-top-width: 1px }
        .\\[\\&_tr\\]\\:border-b { border-bottom-width: 1px }
        .border\\! { border-width: 1px }
      `)
      expect(out.match(/var\(--border-width\)/g)).toHaveLength(4)
      expect(out).not.toContain('1px')
    })
  })

  describe('leaves everything else alone', () => {
    it('keeps an explicit width', async () => {
      expect(await run('.border-2 { border-width: 2px }')).toContain('2px')
    })

    it('keeps a zeroed side', async () => {
      expect(await run('.border-t-0 { border-top-width: 0px }')).toContain('0px')
    })

    it('keeps an arbitrary 1px, which asked for exactly one pixel', async () => {
      const out = await run('.border-\\[1px\\] { border-width: 1px }')
      expect(out).toContain('1px')
      expect(out).not.toContain('var(--border-width)')
    })

    it('does not touch a non-border width sharing a border rule', async () => {
      const out = await run(
        '.border { border-width: 1px; outline-width: 1px; stroke-width: 1px; column-rule-width: 1px }'
      )
      expect(out).toContain('border-width: var(--border-width)')
      expect(out).toContain('outline-width: 1px')
      expect(out).toContain('stroke-width: 1px')
      expect(out).toContain('column-rule-width: 1px')
    })

    it('does not splice into a sub-pixel value', async () => {
      const out = await run('.border { border-width: 0.1px }')
      expect(out).toContain('0.1px')
      expect(out).not.toContain('var(--border-width)')
    })

    it('skips third-party stylesheets', async () => {
      const out = await run('.border { border-width: 1px }', '/repo/node_modules/pkg/styles.css')
      expect(out).toContain('1px')
      expect(out).not.toContain('var(--border-width)')
    })

    it('ignores a hairline class that is not the rule subject', async () => {
      const out = await run('.foo:has(.border) { border-width: 1px }')
      expect(out).toContain('var(--border-width)')
    })
  })
})
