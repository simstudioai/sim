/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { findModuleEscapes } from './check-platform-css'

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
