/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { envNumber } from '@/lib/core/config/env'

describe('envNumber', () => {
  it('can require integer env values for count-like settings', () => {
    expect(envNumber('5', 1, { min: 1, integer: true })).toBe(5)
    expect(envNumber('5.5', 1, { min: 1, integer: true })).toBe(1)
    expect(envNumber(5.5, 1, { min: 1, integer: true })).toBe(1)
  })
})
