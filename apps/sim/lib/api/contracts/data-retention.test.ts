/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { updateOrganizationDataRetentionBodySchema } from '@/lib/api/contracts/organization'
import { retentionOverridesSchema } from '@/lib/api/contracts/primitives'

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
