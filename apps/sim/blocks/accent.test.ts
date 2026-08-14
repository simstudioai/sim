/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn().mockReturnValue(null),
}))

import { hasBlockAccent } from '@/blocks/accent'
import { getBlock } from '@/blocks/registry'

describe('hasBlockAccent', () => {
  const mockedGetBlock = vi.mocked(getBlock)

  afterEach(() => {
    mockedGetBlock.mockReturnValue(null as never)
  })

  function withCategory(category: string) {
    mockedGetBlock.mockReturnValue({ category } as never)
  }

  it('accents a core block, mapped or not', () => {
    withCategory('blocks')
    expect(hasBlockAccent('agent')).toBe(true)
    /*
     * An unmapped core block still takes the accent and lands on `neutral`,
     * which is what the canvas does for a newly added one — the surfaces must
     * not disagree while the role map catches up.
     */
    expect(hasBlockAccent('brand_new_core_block')).toBe(true)
  })

  it('accents every first-party trigger, role or no role', () => {
    withCategory('triggers')
    // Catalogued green, but an `interface` block on the canvas.
    expect(hasBlockAccent('generic_webhook')).toBe(true)
    expect(hasBlockAccent('schedule')).toBe(true)
    /*
     * Roleless triggers are the same bug one step further out: the canvas
     * paints them `neutral`, so a list keyed off the role map alone would have
     * put them back on the catalog blues this rule exists to overrule.
     */
    expect(hasBlockAccent('manual_trigger')).toBe(true)
    expect(hasBlockAccent('circleback')).toBe(true)
  })

  it('leaves a third-party integration on its brand, even if it gains a role', () => {
    withCategory('tools')
    expect(hasBlockAccent('gmail')).toBe(false)
    /*
     * Role membership must not override the category. The canvas brands every
     * `tools` block, so accenting one here would reintroduce the mismatch in
     * the opposite direction.
     */
    expect(hasBlockAccent('table')).toBe(false)
  })

  it('accents configless subflows, which carry a role', () => {
    expect(hasBlockAccent('loop')).toBe(true)
    expect(hasBlockAccent('parallel')).toBe(true)
    expect(hasBlockAccent('workflow')).toBe(true)
  })

  it('leaves the terminal-synthesized run rows on their own status fill', () => {
    expect(hasBlockAccent('error')).toBe(false)
    expect(hasBlockAccent('validation')).toBe(false)
    expect(hasBlockAccent('cancelled')).toBe(false)
  })
})
