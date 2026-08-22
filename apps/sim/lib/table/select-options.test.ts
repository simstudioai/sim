/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeSelectOptionsInput } from '@/lib/table/select-options'

describe('normalizeSelectOptionsInput', () => {
  it('generates a stable id for a bare-name string option', () => {
    const [opt] = normalizeSelectOptionsInput(['Open']) ?? []
    expect(opt.name).toBe('Open')
    expect(typeof opt.id).toBe('string')
    expect(opt.id.length).toBeGreaterThan(0)
  })

  it('generates an id for an object option without one', () => {
    const [opt] = normalizeSelectOptionsInput([{ name: 'Closed' }]) ?? []
    expect(opt.name).toBe('Closed')
    expect(opt.id.length).toBeGreaterThan(0)
  })

  it('preserves an explicitly supplied id', () => {
    const result = normalizeSelectOptionsInput([{ id: 'opt_keep', name: 'Open' }])
    expect(result).toEqual([{ id: 'opt_keep', name: 'Open' }])
  })

  it('reuses the id of an existing option with the same name', () => {
    // The agent re-sends options as bare names on every edit. Minting fresh ids
    // would orphan every cell holding them — silently clearing the column.
    const existing = [
      { id: 'opt_low', name: 'Low' },
      { id: 'opt_high', name: 'High' },
    ]
    const result = normalizeSelectOptionsInput(['Low', 'Medium', 'High'], existing) ?? []

    expect(result[0]).toEqual({ id: 'opt_low', name: 'Low' })
    expect(result[2]).toEqual({ id: 'opt_high', name: 'High' })
    // Only the genuinely new option gets a fresh id.
    expect(result[1].name).toBe('Medium')
    expect(result[1].id).not.toBe('opt_low')
    expect(result[1].id).not.toBe('opt_high')
  })

  it('matches an existing option name case-insensitively', () => {
    const result = normalizeSelectOptionsInput(['open'], [{ id: 'opt_open', name: 'Open' }]) ?? []
    expect(result[0].id).toBe('opt_open')
    expect(result[0].name).toBe('open')
  })

  it('mints a fresh id when there is no existing column to match against', () => {
    const result = normalizeSelectOptionsInput(['Open']) ?? []
    expect(result[0].id.length).toBeGreaterThan(0)
    expect(result[0].name).toBe('Open')
  })

  it('returns undefined for a non-array (validation rejects it downstream)', () => {
    expect(normalizeSelectOptionsInput(undefined)).toBeUndefined()
    expect(normalizeSelectOptionsInput('Open')).toBeUndefined()
  })
})
