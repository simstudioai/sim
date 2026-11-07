/**
 * @vitest-environment node
 */
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import embed from '@/lib/postcss/platform-embed.cjs'
import { findEntryEscapes, findModuleEscapes } from './check-platform-css'

const ENTRY = '/repo/packages/emcn-platform/src/styles/platform.css'

const scoped = async (css: string, from = ENTRY) =>
  (await postcss([embed()]).process(css, { from })).css

describe('findEntryEscapes', () => {
  it.each([
    ':root { --spacing: 1px; }',
    'html { color: red; }',
    '[data-platform-ui] html { color: red; }',
    '.flex { display: flex; }',
    '[data-material="shell"] { color: red; }',
    '@layer utilities { [data-platform-ui] .flex { display: flex; } }',
    '@layer components { [data-platform-ui] .local { display: flex; } }',
    '@layer theme, base, components, utilities;',
    '@property --tw-shadow { syntax: "*"; inherits: false; }',
    '@keyframes spin { to { rotate: 1turn; } }',
    '@media (width > 1px) { .flex { display: flex; } }',
  ])('flags %s', (css) => {
    expect(findEntryEscapes(css, '')).not.toEqual([])
  })

  it('flags a font family the host stylesheet names', () => {
    expect(findEntryEscapes('@font-face { font-family: "Geist"; }', 'font: "Geist"')).not.toEqual(
      []
    )
  })

  it('passes what the embed plugin emits', async () => {
    const css = await scoped(
      '[data-platform-ui] { color: red; } [data-material="shell"] { color: red; } ' +
        '[data-platform-ui][data-theme="dark"] svg { color: red; } :focus, a { color: red; }'
    )
    expect(findEntryEscapes(css, '')).toEqual([])
    expect(css).toContain(':where([data-platform-ui]) [data-material="shell"]')
    expect(css).toContain(':where(html.dark) [data-platform-ui][data-theme="system"] svg')
  })

  it('leaves any other stylesheet to the host', async () => {
    const css = '.flex { display: flex; }'
    expect(await scoped(css, '/repo/apps/sim/app/_styles/globals.css')).toBe(css)
  })
})

describe('findModuleEscapes', () => {
  it.each([
    'button { color: red; }',
    '[data-platform-ui] { color: red; }',
    ':global(.flex) { display: flex; }',
    '.local, body { color: red; }',
    '@layer base { .local { color: red; } }',
    '@layer components;',
    '@layer theme, base, components, utilities;',
    '@layer components.base { .local { color: red; } }',
    '@layer components { body { color: red; } }',
    '@layer components { :global(.escaped) { color: red; } }',
    '@layer components { .local { :global(.escaped) { color: red; } } }',
    '@layer components { @layer components { .local { color: red; } } }',
    '@font-face { font-family: "X"; }',
    '@property --x { syntax: "*"; inherits: false; }',
  ])('flags %s', (css) => {
    expect(findModuleEscapes(css, 'x.module.css')).not.toEqual([])
  })

  it('passes local classes, their keyframes and blocks in the existing components layer', () => {
    const css =
      '.local:hover, textarea.input { color: red; } @media (width > 1px) { .local { color: red; } } ' +
      '@keyframes spin { from { rotate: 0; } to { rotate: 1turn; } } ' +
      '@layer components { .local { color: red; } @media (width > 1px) { .local { color: blue; } } }'
    expect(findModuleEscapes(css, 'x.module.css')).toEqual([])
  })
})
