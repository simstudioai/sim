/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { envNumber } from '@/lib/core/config/env'

vi.unmock('@/lib/core/config/env')

describe('envNumber', () => {
  it('can require integer env values for count-like settings', () => {
    expect(envNumber('5', 1, { min: 1, integer: true })).toBe(5)
    expect(envNumber('5.5', 1, { min: 1, integer: true })).toBe(1)
    expect(envNumber(5.5, 1, { min: 1, integer: true })).toBe(1)
  })

  it('treats whitespace-only values as unset instead of coercing them to 0', () => {
    expect(envNumber('   ', 1)).toBe(1)
    expect(envNumber('', 1)).toBe(1)
    expect(envNumber(' 1.1 ', 1)).toBe(1.1)
    expect(envNumber('0', 1)).toBe(0)
  })
})
