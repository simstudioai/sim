import { describe, expect, it } from 'vitest'
import { v2SetSecretBodySchema } from '@/lib/api/contracts/v2/secrets'

describe('v2SetSecretBodySchema unredacted', () => {
  it('rejects unredacted on a personal secret at the flag itself', () => {
    const parsed = v2SetSecretBodySchema.safeParse({
      workspaceId: 'workspace-1',
      scope: 'personal',
      value: 'secret-value',
      unredacted: true,
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({
          path: ['unredacted'],
          message: 'unredacted is only supported for a workspace secret',
        }),
      ])
    }
  })
})

describe('v2SetSecretBodySchema metadata-only write', () => {
  it('rejects a workspace body with nothing to write rather than resolving to an empty update', () => {
    const parsed = v2SetSecretBodySchema.safeParse({
      workspaceId: 'workspace-1',
      scope: 'workspace',
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({
          path: ['value'],
          message: 'value, description, or unredacted is required',
        }),
      ])
    }
  })

  it('still requires a value for a personal secret, which has no metadata field to write', () => {
    const parsed = v2SetSecretBodySchema.safeParse({
      workspaceId: 'workspace-1',
      scope: 'personal',
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({
          path: ['value'],
          message: 'value is required for a personal secret',
        }),
      ])
    }
  })
})
