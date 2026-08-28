/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_CUSTOM_RANGE_DAYS } from '@/lib/api/contracts/organization-usage'
import { isUsableCustomRange } from '@/ee/organization-usage/hooks/use-usage-window'

/**
 * Every condition here is one the server answers with a 400. A deep link carrying
 * one would otherwise be marked resolved and fail all four of the panel's queries,
 * so the guard degrades the link to the default window instead — and that only
 * works while these three rules match the window resolver's.
 */
describe('isUsableCustomRange', () => {
  it('accepts a well-formed range inside the cap', () => {
    expect(isUsableCustomRange('2026-01-01', '2026-01-31')).toBe(true)
  })

  it('accepts a single-day range', () => {
    expect(isUsableCustomRange('2026-01-01', '2026-01-01')).toBe(true)
  })

  it('rejects a missing bound', () => {
    expect(isUsableCustomRange('2026-01-01', null)).toBe(false)
    expect(isUsableCustomRange(null, '2026-01-31')).toBe(false)
  })

  it('rejects a malformed or unreal date', () => {
    expect(isUsableCustomRange('2026-1-1', '2026-01-31')).toBe(false)
    expect(isUsableCustomRange('2026-02-30', '2026-03-01')).toBe(false)
    expect(isUsableCustomRange('not-a-date', '2026-03-01')).toBe(false)
  })

  it('rejects an inverted pair', () => {
    expect(isUsableCustomRange('2026-03-01', '2026-02-01')).toBe(false)
  })

  it('accepts a span of exactly the cap and rejects one day past it', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const at = new Date(start.getTime() + (MAX_CUSTOM_RANGE_DAYS - 1) * 86_400_000)
    const past = new Date(start.getTime() + MAX_CUSTOM_RANGE_DAYS * 86_400_000)
    expect(isUsableCustomRange('2026-01-01', at.toISOString().slice(0, 10))).toBe(true)
    expect(isUsableCustomRange('2026-01-01', past.toISOString().slice(0, 10))).toBe(false)
  })
})
