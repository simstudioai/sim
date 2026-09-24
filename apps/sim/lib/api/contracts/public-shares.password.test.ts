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

  /**
   * Only the use case knows whether the caller is Sim's agent, whose reference
   * resolves before the password rules apply, so v2 admits a whole-value
   * reference below the password minimum. Every other short value, and the internal surface,
   * stay refused with the password message rather than a generic union failure.
   */
  it('admits a short whole-value reference on v2 only', () => {
    const body = { workspaceId: 'workspace-1', isActive: true, authType: 'password' }

    expect(v2UpsertFileShareBodySchema.safeParse({ ...body, password: '{{PW}}' }).success).toBe(
      true
    )
    expect(
      v2UpsertFileShareBodySchema.safeParse({ ...body, password: 'x-{{PW}}' }).error?.issues[0]
        .message
    ).toBe('Password must be at least 15 characters')
    expect(sharePasswordSchema.safeParse('{{PW}}').success).toBe(false)
  })

  it('caps a reference at the password length limit with one issue', () => {
    const body = { workspaceId: 'workspace-1', isActive: true, authType: 'password' }
    const issues = v2UpsertFileShareBodySchema.safeParse({
      ...body,
      password: `{{${'A'.repeat(1024)}}}`,
    }).error?.issues
    expect(issues?.map((issue) => issue.message)).toEqual(['Password is too long'])
  })
})
