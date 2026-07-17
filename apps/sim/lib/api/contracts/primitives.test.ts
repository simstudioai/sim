/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  customPatternSchema,
  piiStagePolicySchema,
  piiStagesSchema,
} from '@/lib/api/contracts/primitives'

describe('customPatternSchema', () => {
  it('accepts a well-formed pattern', () => {
    expect(
      customPatternSchema.parse({ name: 'Employee ID', regex: 'EMP-\\d{6}', replacement: '<EMP>' })
    ).toEqual({ name: 'Employee ID', regex: 'EMP-\\d{6}', replacement: '<EMP>' })
  })

  it('rejects an empty regex', () => {
    expect(customPatternSchema.safeParse({ name: 'x', regex: '', replacement: '' }).success).toBe(
      false
    )
  })

  it('rejects an over-long regex', () => {
    expect(
      customPatternSchema.safeParse({ name: '', regex: 'a'.repeat(513), replacement: '' }).success
    ).toBe(false)
  })
})

describe('piiStagePolicySchema', () => {
  it('allows an enabled stage with only custom patterns (no entity types)', () => {
    const parsed = piiStagePolicySchema.safeParse({
      enabled: true,
      entityTypes: [],
      customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an enabled stage with no entity types and no custom patterns', () => {
    const parsed = piiStagePolicySchema.safeParse({ enabled: true, entityTypes: [] })
    expect(parsed.success).toBe(false)
  })
})

describe('piiStagesSchema', () => {
  it('keeps custom patterns on blockOutputs while stripping NER, staying enabled', () => {
    const parsed = piiStagesSchema.parse({
      input: { enabled: false, entityTypes: [] },
      blockOutputs: {
        enabled: true,
        entityTypes: ['PERSON', 'EMAIL_ADDRESS'],
        customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' }],
      },
      logs: { enabled: false, entityTypes: [] },
    })
    expect(parsed.blockOutputs.entityTypes).toEqual(['EMAIL_ADDRESS'])
    expect(parsed.blockOutputs.customPatterns).toEqual([
      { name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' },
    ])
    expect(parsed.blockOutputs.enabled).toBe(true)
  })

  it('keeps blockOutputs enabled when only custom patterns survive the NER strip', () => {
    const parsed = piiStagesSchema.parse({
      input: { enabled: false, entityTypes: [] },
      blockOutputs: {
        enabled: true,
        entityTypes: ['PERSON'],
        customPatterns: [{ name: 'Ticket', regex: 'TCK-\\d+', replacement: '<TICKET>' }],
      },
      logs: { enabled: false, entityTypes: [] },
    })
    expect(parsed.blockOutputs.entityTypes).toEqual([])
    expect(parsed.blockOutputs.enabled).toBe(true)
  })
})
