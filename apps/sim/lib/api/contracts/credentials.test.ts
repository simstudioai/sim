/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  updateCredentialByIdBodySchema,
  workspaceCredentialSchema,
} from '@/lib/api/contracts/credentials'

const credential = {
  id: 'credential-1',
  workspaceId: 'workspace-1',
  type: 'env_workspace' as const,
  displayName: 'STRIPE_API_KEY',
  description: null,
  providerId: null,
  accountId: null,
  envKey: 'STRIPE_API_KEY',
  envOwnerUserId: null,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

describe('updateCredentialByIdBodySchema unredacted', () => {
  it('accepts unredacted alone as the one updated field', () => {
    const parsed = updateCredentialByIdBodySchema.safeParse({ unredacted: true })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual({ unredacted: true })
  })

  it('still rejects an empty update body', () => {
    expect(updateCredentialByIdBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('workspaceCredentialSchema unredacted', () => {
  it('accepts a credential carrying unredacted: false', () => {
    const parsed = workspaceCredentialSchema.parse({ ...credential, unredacted: false })

    expect(parsed.unredacted).toBe(false)
  })

  it('requires the field so a response cannot silently drop it', () => {
    expect(workspaceCredentialSchema.safeParse(credential).success).toBe(false)
  })
})
