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

  it('rejects a syntactically invalid regex at the boundary (not just in the editor)', () => {
    const parsed = customPatternSchema.safeParse({ name: 'bad', regex: '(', replacement: '' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['regex'])
    }
  })

  it('no longer screens for catastrophic backtracking, which never worked here', () => {
    // This used to reject `(a+)+$` via `safe-regex2`. The screen was removed:
    // it caught that shape but passed `a*a*b`, which is just as catastrophic,
    // so it only ever deterred the obvious spelling of a misconfiguration a
    // user can inflict on their own workspace. It also rejected valid patterns
    // (lookbehind, optional groups) that Presidio accepts.
    //
    // These patterns run in Presidio, not in this process, so they cannot
    // stall this event loop; Presidio's own timeout is the bound. In-process
    // matching uses `compileLinearRegex`, which cannot backtrack at all.
    for (const regex of ['(a+)+$', 'a*a*b', '(?<=id: )\\w+']) {
      expect(
        customPatternSchema.safeParse({ name: 'p', regex, replacement: '' }).success,
        `pattern ${regex} should be accepted`
      ).toBe(true)
    }
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
