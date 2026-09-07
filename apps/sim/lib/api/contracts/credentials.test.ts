/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createCredentialBodySchema,
  createCredentialDraftBodySchema,
  updateCredentialByIdBodySchema,
  workspaceCredentialSchema,
} from '@/lib/api/contracts/credentials'
import {
  v2CreateServiceAccountCredentialBodySchema,
  v2UpdateCredentialBodySchema,
} from '@/lib/api/contracts/v2/credentials'

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

describe('OCI API-key credential fields', () => {
  const fields = {
    tenancyOcid: 'ocid1.tenancy.oc1..tenant',
    userOcid: 'ocid1.user.oc1..user',
    fingerprint: '00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff',
    privateKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
    privateKeyPassphrase: ' exact passphrase ',
    region: 'us-ashburn-1',
  }

  it('accepts the stable web create field names and preserves the passphrase exactly', () => {
    const parsed = createCredentialBodySchema.parse({
      workspaceId: '11111111-2222-4333-8444-555555555555',
      type: 'service_account',
      providerId: 'oci-api-key-service-account',
      ...fields,
    })

    expect(parsed.privateKeyPassphrase).toBe(' exact passphrase ')
    expect(parsed).toMatchObject(fields)
  })

  it('accepts the same fields in the V2 write-only envelope', () => {
    const parsed = v2CreateServiceAccountCredentialBodySchema.parse({
      workspaceId: '11111111-2222-4333-8444-555555555555',
      type: 'service_account',
      providerId: 'oci-api-key-service-account',
      credentials: JSON.stringify(fields),
    })

    expect(parsed.credentials).toMatchObject(fields)
  })

  it('accepts an omitted passphrase on rotation as an unencrypted replacement key', () => {
    const { privateKeyPassphrase: _omitted, ...replacement } = fields
    expect(v2UpdateCredentialBodySchema.parse(replacement)).toEqual(replacement)
    expect(updateCredentialByIdBodySchema.parse(replacement)).toEqual(replacement)
  })
})
