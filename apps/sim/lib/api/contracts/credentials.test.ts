/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createCredentialDraftBodySchema,
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
    const parsed = updateCredentialByIdBodySchema.safeParse({
      unredacted: true,
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual({ unredacted: true })
  })

  it('still rejects an empty update body', () => {
    expect(updateCredentialByIdBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('workspaceCredentialSchema unredacted', () => {
  it('accepts a credential carrying unredacted: false', () => {
    const parsed = workspaceCredentialSchema.parse({
      ...credential,
      unredacted: false,
    })

    expect(parsed.unredacted).toBe(false)
  })

  it('requires the field so a response cannot silently drop it', () => {
    expect(workspaceCredentialSchema.safeParse(credential).success).toBe(false)
  })
})

describe('createCredentialDraftBodySchema OAuth client configuration', () => {
  const base = {
    workspaceId: 'workspace-1',
    displayName: 'Accounting',
  }
  const oauthClientConfig = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    environment: 'sandbox' as const,
    webhookVerifierToken: 'verifier-token',
  }

  it('requires caller-managed app credentials for QuickBooks', () => {
    const result = createCredentialDraftBodySchema.safeParse({
      ...base,
      providerId: 'quickbooks',
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['oauthClientConfig'])
  })

  it('accepts QuickBooks app credentials and rejects them for other providers', () => {
    expect(
      createCredentialDraftBodySchema.safeParse({
        ...base,
        providerId: 'quickbooks',
        oauthClientConfig,
      }).success
    ).toBe(true)
    expect(
      createCredentialDraftBodySchema.safeParse({
        ...base,
        providerId: 'google-email',
        oauthClientConfig,
      }).success
    ).toBe(false)
  })
})
