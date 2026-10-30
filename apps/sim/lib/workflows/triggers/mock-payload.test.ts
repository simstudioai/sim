import { describe, expect, it } from 'vitest'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/mock-payload'

describe('generateMockPayloadFromOutputsDefinition', () => {
  it('samples a declared __proto__ field as a field, never as the prototype', () => {
    const outputs = JSON.parse(
      '{"structuredContent":{"type":"json","properties":{"__proto__":{"type":"json","properties":{"polluted":{"type":"boolean"}}},"role":{"type":"string"}}}}'
    )
    const sample = generateMockPayloadFromOutputsDefinition(outputs)
    const structured = sample.structuredContent as Record<string, unknown>
    expect(Object.getPrototypeOf(structured)).toBe(Object.prototype)
    expect(Object.keys(structured)).toEqual(['__proto__', 'role'])
    expect(Object.hasOwn(structured, '__proto__')).toBe(true)
  })
})
