import { describe, expect, it } from 'vitest'
import { thinScrollbarClass } from './scrollbar'

describe('thinScrollbarClass', () => {
  it('uses compact edge-aligned geometry and theme tokens', () => {
    expect(thinScrollbarClass).toContain('[&::-webkit-scrollbar]:size-1')
    expect(thinScrollbarClass).toContain('[scrollbar-width:thin]')
    expect(thinScrollbarClass).toContain('var(--scrollbar-thumb-color)')
    expect(thinScrollbarClass).toContain('var(--scrollbar-thumb-hover-color)')
  })
})
