/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createCredentialBodySchema,
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

describe('OCI Object Storage credential contracts', () => {
  const base = {
    workspaceId: 'bdb1712f-f4de-4f38-8721-7ff40fd6fd0e',
    type: 'service_account' as const,
    providerId: 'oci-object-storage-service-account',
  }

  it('requires all four provider-specific fields only for OCI', () => {
    const missing = createCredentialBodySchema.safeParse({ ...base, accessKeyId: 'access' })
    expect(missing.success).toBe(false)
    if (!missing.success) {
      expect(missing.error.issues.map((issue) => issue.path[0])).toEqual([
        'secretAccessKey',
        'namespace',
        'region',
      ])
    }

    expect(
      createCredentialBodySchema.safeParse({
        ...base,
        accessKeyId: 'access',
        secretAccessKey: 'secret',
        namespace: 'namespace',
        region: 'us-ashburn-1',
      }).success
    ).toBe(true)
  })

  it('accepts OCI reconnect fields and remains strict', () => {
    expect(
      updateCredentialByIdBodySchema.safeParse({
        accessKeyId: 'access',
        secretAccessKey: 'secret',
        namespace: 'namespace',
        region: 'us-ashburn-1',
      }).success
    ).toBe(true)
    expect(
      updateCredentialByIdBodySchema.safeParse({
        accessKeyId: 'access',
        endpoint: 'https://attacker.example',
      }).success
    ).toBe(false)
  })
})

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
