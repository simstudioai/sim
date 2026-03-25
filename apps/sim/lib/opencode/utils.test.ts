/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { coerceOpenCodeBoolean } from '@/lib/opencode/utils'

describe('coerceOpenCodeBoolean', () => {
  it('coerces booleans and string booleans consistently', () => {
    expect(coerceOpenCodeBoolean(true)).toBe(true)
    expect(coerceOpenCodeBoolean(false)).toBe(false)
    expect(coerceOpenCodeBoolean('true')).toBe(true)
    expect(coerceOpenCodeBoolean('TRUE')).toBe(true)
    expect(coerceOpenCodeBoolean('false')).toBe(false)
    expect(coerceOpenCodeBoolean(undefined)).toBe(false)
    expect(coerceOpenCodeBoolean(null)).toBe(false)
  })
})
