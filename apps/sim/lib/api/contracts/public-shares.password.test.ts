/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  authenticatePublicFileBodySchema,
  sharePasswordSchema,
  upsertFileShareBodySchema,
} from '@/lib/api/contracts/public-shares'
import { v2UpsertFileShareBodySchema } from '@/lib/api/contracts/v2/files'

describe('public file share password contracts', () => {
  it('requires 15 characters when a password is created or changed', () => {
    expect(sharePasswordSchema.safeParse('short-password').success).toBe(false)
    expect(sharePasswordSchema.safeParse('correct-password').success).toBe(true)
    expect(
      upsertFileShareBodySchema.safeParse({
        isActive: true,
        authType: 'password',
        password: 'short-password',
      }).success
    ).toBe(false)
    expect(
      v2UpsertFileShareBodySchema.safeParse({
        workspaceId: 'workspace-1',
        isActive: true,
        authType: 'password',
        password: 'short-password',
      }).success
    ).toBe(false)
  })

  it('continues accepting legacy short passwords at the public login gate', () => {
    expect(authenticatePublicFileBodySchema.safeParse({ password: 'legacy' }).success).toBe(true)
  })
})
