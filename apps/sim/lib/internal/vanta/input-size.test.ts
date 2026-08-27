/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isJsonInputWithinLimit } from '@/lib/internal/vanta/input-size'

describe('Vanta operation input sizing', () => {
  it.each([
    null,
    { value: 'plain text' },
    { value: 'quotes " and slashes \\' },
    { value: 'emoji 🚀 and control\n' },
    { nested: [{ enabled: true }, undefined, 42] },
  ])('matches JSON byte boundaries without materializing the entire input', (input) => {
    const bytes = Buffer.byteLength(JSON.stringify(input) ?? '', 'utf8')
    expect(isJsonInputWithinLimit(input, bytes)).toBe(true)
    if (bytes > 0) expect(isJsonInputWithinLimit(input, bytes - 1)).toBe(false)
  })

  it('rejects cyclic inputs as invalid JSON', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => isJsonInputWithinLimit(cyclic, 1024)).toThrow(/circular/i)
  })
})
