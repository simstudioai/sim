import { describe, expect, it } from 'vitest'
import { piiRedactionRuleSchema } from '@/lib/api/contracts/primitives'

describe('piiRedactionRuleSchema', () => {
  const stage = (enabled: boolean, entityTypes: string[], language?: string) => ({
    enabled,
    entityTypes,
    ...(language ? { language } : {}),
  })

  it('strips spaCy-NER entities from the blockOutputs stage only (regex-only)', () => {
    const result = piiRedactionRuleSchema.safeParse({
      id: 'r-1',
      workspaceId: null,
      stages: {
        input: stage(true, ['PERSON', 'EMAIL_ADDRESS']),
        blockOutputs: stage(true, ['PERSON', 'EMAIL_ADDRESS']),
        logs: stage(true, ['DATE_TIME']),
      },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.stages?.blockOutputs.entityTypes).toEqual(['EMAIL_ADDRESS'])
    expect(result.data.stages?.blockOutputs.enabled).toBe(true)
    // input and logs keep their NER entities.
    expect(result.data.stages?.input.entityTypes).toEqual(['PERSON', 'EMAIL_ADDRESS'])
    expect(result.data.stages?.logs.entityTypes).toEqual(['DATE_TIME'])
  })

  it('disables blockOutputs when the NER strip leaves it empty (migration-safe, no lockout)', () => {
    const result = piiRedactionRuleSchema.safeParse({
      id: 'r-1',
      workspaceId: null,
      stages: {
        input: stage(false, []),
        blockOutputs: stage(true, ['PERSON', 'LOCATION']),
        logs: stage(false, []),
      },
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.stages?.blockOutputs.entityTypes).toEqual([])
    expect(result.data.stages?.blockOutputs.enabled).toBe(false)
  })
})
