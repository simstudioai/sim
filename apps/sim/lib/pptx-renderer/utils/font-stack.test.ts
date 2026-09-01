/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { cssFontStack } from '@/lib/pptx-renderer/utils/font-stack'

describe('cssFontStack', () => {
  it('appends metric-compatible substitutes and a generic family', () => {
    expect(cssFontStack('Calibri')).toBe(
      '"Calibri", "Carlito", "Helvetica Neue", "Arial", sans-serif'
    )
  })

  it('classifies serif and monospace families', () => {
    expect(cssFontStack('Times New Roman')).toBe(
      '"Times New Roman", "Liberation Serif", "Times", serif'
    )
    expect(cssFontStack('Consolas')).toBe('"Consolas", "Menlo", "Liberation Mono", monospace')
    expect(cssFontStack('Playfair Display')).toBe('"Playfair Display", serif')
  })

  it('leaves CSS keywords unquoted', () => {
    expect(cssFontStack('Segoe UI')).toBe('"Segoe UI", system-ui, "Helvetica Neue", sans-serif')
  })

  it('defaults unknown families to sans-serif', () => {
    expect(cssFontStack('Some Brand Font')).toBe('"Some Brand Font", sans-serif')
  })

  it('sends explicitly sans-named serif-suffixed families to sans-serif', () => {
    expect(cssFontStack('Open Sans')).toBe('"Open Sans", sans-serif')
    expect(cssFontStack('Liberation Serif')).toBe('"Liberation Serif", serif')
  })

  it('passes an existing stack through unchanged', () => {
    const stacked = cssFontStack('Calibri')
    expect(cssFontStack(stacked)).toBe(stacked)
  })

  it('returns empty for blank input', () => {
    expect(cssFontStack('  ')).toBe('')
  })
})
