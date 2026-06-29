/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { updateOrganizationDataRetentionBodySchema } from '@/lib/api/contracts/organization'
import {
  piiRedactionRuleSchema,
  piiRedactionSettingsSchema,
  retentionOverridesSchema,
} from '@/lib/api/contracts/primitives'

describe('retentionOverridesSchema', () => {
  it('accepts an override that overrides one field and inherits the rest', () => {
    const result = retentionOverridesSchema.safeParse([
      { workspaceId: 'ws-1', logRetentionHours: 168 },
    ])
    expect(result.success).toBe(true)
  })

  it('accepts null (forever) for a field', () => {
    const result = retentionOverridesSchema.safeParse([
      { workspaceId: 'ws-1', logRetentionHours: null },
    ])
    expect(result.success).toBe(true)
  })

  it('rejects two overrides for the same workspace', () => {
    const result = retentionOverridesSchema.safeParse([
      { workspaceId: 'ws-1', logRetentionHours: 168 },
      { workspaceId: 'ws-1', softDeleteRetentionHours: 720 },
    ])
    expect(result.success).toBe(false)
  })

  it('allows distinct workspaces', () => {
    const result = retentionOverridesSchema.safeParse([
      { workspaceId: 'ws-1', logRetentionHours: 168 },
      { workspaceId: 'ws-2', logRetentionHours: 720 },
    ])
    expect(result.success).toBe(true)
  })

  it('rejects hours below the 24h minimum and above the ~5y maximum', () => {
    expect(
      retentionOverridesSchema.safeParse([{ workspaceId: 'ws-1', logRetentionHours: 1 }]).success
    ).toBe(false)
    expect(
      retentionOverridesSchema.safeParse([{ workspaceId: 'ws-1', logRetentionHours: 100000 }])
        .success
    ).toBe(false)
  })

  it('rejects an empty workspaceId', () => {
    expect(
      retentionOverridesSchema.safeParse([{ workspaceId: '', logRetentionHours: 168 }]).success
    ).toBe(false)
  })
})

describe('updateOrganizationDataRetentionBodySchema', () => {
  it('accepts retentionOverrides alongside the org hours', () => {
    const result = updateOrganizationDataRetentionBodySchema.safeParse({
      logRetentionHours: 720,
      retentionOverrides: [{ workspaceId: 'ws-1', logRetentionHours: 168 }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a body with no retentionOverrides (field is optional)', () => {
    const result = updateOrganizationDataRetentionBodySchema.safeParse({ logRetentionHours: 720 })
    expect(result.success).toBe(true)
  })
})

describe('piiRedactionRuleSchema', () => {
  const stage = (enabled: boolean, entityTypes: string[], language?: string) => ({
    enabled,
    entityTypes,
    ...(language ? { language } : {}),
  })

  it('accepts a legacy flat rule (entityTypes only)', () => {
    const result = piiRedactionRuleSchema.safeParse({
      id: 'r-1',
      workspaceId: null,
      entityTypes: ['EMAIL_ADDRESS'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a per-stage rule', () => {
    const result = piiRedactionRuleSchema.safeParse({
      id: 'r-1',
      workspaceId: 'ws-1',
      stages: {
        input: stage(true, ['PERSON'], 'es'),
        blockOutputs: stage(false, []),
        logs: stage(true, ['US_SSN']),
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a rule with neither stages nor entityTypes', () => {
    const result = piiRedactionRuleSchema.safeParse({ id: 'r-1', workspaceId: null })
    expect(result.success).toBe(false)
  })

  it('rejects an unsupported stage language', () => {
    const result = piiRedactionRuleSchema.safeParse({
      id: 'r-1',
      workspaceId: null,
      stages: {
        input: stage(true, ['PERSON'], 'de'),
        blockOutputs: stage(false, []),
        logs: stage(false, []),
      },
    })
    expect(result.success).toBe(false)
  })

  it('enforces one rule per scope (uniqueness refine still applies)', () => {
    const result = piiRedactionSettingsSchema.safeParse({
      rules: [
        { id: 'r-1', workspaceId: 'ws-1', entityTypes: ['PERSON'] },
        { id: 'r-2', workspaceId: 'ws-1', entityTypes: ['US_SSN'] },
      ],
    })
    expect(result.success).toBe(false)
  })
})
