import { describe, expect, it } from 'vitest'
import {
  v2CreateServiceAccountCredentialBodySchema,
  v2UpdateCredentialBodySchema,
} from '@/lib/api/contracts/v2/credentials'

const workspaceId = '123e4567-e89b-12d3-a456-426614174000'

describe('V2 OCI Object Storage credential contract', () => {
  it('accepts exactly the four provider fields and parses the JSON envelope', () => {
    const result = v2CreateServiceAccountCredentialBodySchema.safeParse({
      workspaceId,
      type: 'service_account',
      providerId: 'oci-object-storage-service-account',
      credentials: JSON.stringify({
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        namespace: 'namespace1',
        region: 'us-ashburn-1',
      }),
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.credentials).toEqual({
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        namespace: 'namespace1',
        region: 'us-ashburn-1',
      })
    }
  })

  it('requires all four fields and rejects undeclared credential material', () => {
    const missing = v2CreateServiceAccountCredentialBodySchema.safeParse({
      workspaceId,
      type: 'service_account',
      providerId: 'oci-object-storage-service-account',
      credentials: JSON.stringify({
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        namespace: 'namespace1',
      }),
    })
    const unknown = v2CreateServiceAccountCredentialBodySchema.safeParse({
      workspaceId,
      type: 'service_account',
      providerId: 'oci-object-storage-service-account',
      credentials: JSON.stringify({
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        namespace: 'namespace1',
        region: 'us-ashburn-1',
        endpoint: 'https://attacker.example',
      }),
    })

    expect(missing.success).toBe(false)
    expect(missing.error?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['credentials', 'region'] })])
    )
    expect(unknown.success).toBe(false)
  })

  it('accepts the four write-only fields for reconnect and rejects a caller endpoint', () => {
    expect(
      v2UpdateCredentialBodySchema.safeParse({
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        namespace: 'namespace1',
        region: 'us-ashburn-1',
      }).success
    ).toBe(true)
    expect(
      v2UpdateCredentialBodySchema.safeParse({
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        namespace: 'namespace1',
        region: 'us-ashburn-1',
        endpoint: 'https://attacker.example',
      }).success
    ).toBe(false)
  })
})
