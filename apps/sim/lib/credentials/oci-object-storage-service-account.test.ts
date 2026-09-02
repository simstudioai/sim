/**
 * @vitest-environment node
 */
import { S3Client } from '@aws-sdk/client-s3'
import { credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ decryptSecret: vi.fn() }))

vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decryptSecret }))

import {
  getOciObjectStorageServiceAccountSecret,
  OciObjectStorageCredentialError,
  validateOciObjectStorageServiceAccount,
} from '@/lib/credentials/oci-object-storage-service-account'
import {
  OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_SECRET_TYPE,
} from '@/lib/oauth/types'

const storedBlob = JSON.stringify({
  type: OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_SECRET_TYPE,
  providerId: OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_PROVIDER_ID,
  accessKeyId: 'access-key-canary',
  secretAccessKey: 'secret-key-canary',
  namespace: 'namespace1',
  region: 'us-ashburn-1',
  ownerId: 'ocid1.user.oc1..owner',
  ownerDisplayName: 'Storage Automation',
  metadata: { principalKind: 'user', principalId: 'ocid1.user.oc1..owner' },
})

describe('OCI Object Storage service-account credential', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.decryptSecret.mockResolvedValue({ decrypted: storedBlob })
  })

  it('validates the connection with ListBuckets and derives the owner identity', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Owner: { ID: 'ocid1.user.oc1..owner', DisplayName: 'Storage Automation' },
      Buckets: [],
    } as never)

    await expect(
      validateOciObjectStorageServiceAccount({
        accessKeyId: ' access-key-canary ',
        secretAccessKey: ' secret-key-canary ',
        namespace: 'NAMESPACE1',
        region: 'US-ASHBURN-1',
      })
    ).resolves.toEqual({
      secret: {
        accessKeyId: 'access-key-canary',
        secretAccessKey: 'secret-key-canary',
        namespace: 'namespace1',
        region: 'us-ashburn-1',
      },
      ownerId: 'ocid1.user.oc1..owner',
      ownerDisplayName: 'Storage Automation',
    })
    expect(send).toHaveBeenCalledOnce()
  })

  it('returns a bounded validation error without echoing rejected secret material', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(
      new Error('provider echoed secret-key-canary')
    )
    const result = validateOciObjectStorageServiceAccount({
      accessKeyId: 'access-key-canary',
      secretAccessKey: 'secret-key-canary',
      namespace: 'namespace1',
      region: 'us-ashburn-1',
    }).catch((error) => error as Error)

    await expect(result).resolves.toBeInstanceOf(OciObjectStorageCredentialError)
    await expect(result).resolves.not.toHaveProperty(
      'message',
      expect.stringContaining('secret-key-canary')
    )
  })

  it('decrypts only a provider-bound OCI service-account row', async () => {
    queueTableRows(credential, [
      {
        type: 'service_account',
        providerId: OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_PROVIDER_ID,
        encryptedServiceAccountKey: 'ciphertext',
      },
    ])

    await expect(getOciObjectStorageServiceAccountSecret('credential-1')).resolves.toMatchObject({
      accessKeyId: 'access-key-canary',
      secretAccessKey: 'secret-key-canary',
      namespace: 'namespace1',
      region: 'us-ashburn-1',
      ownerId: 'ocid1.user.oc1..owner',
    })
    expect(mocks.decryptSecret).toHaveBeenCalledWith('ciphertext')
  })

  it('rejects a wrong provider before decrypting and rejects a wrong blob discriminator', async () => {
    queueTableRows(credential, [
      {
        type: 'service_account',
        providerId: 'atlassian-service-account',
        encryptedServiceAccountKey: 'ciphertext',
      },
    ])
    await expect(getOciObjectStorageServiceAccountSecret('credential-1')).rejects.toThrow(
      'OCI Object Storage credential not found'
    )
    expect(mocks.decryptSecret).not.toHaveBeenCalled()

    resetDbChainMock()
    queueTableRows(credential, [
      {
        type: 'service_account',
        providerId: OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_PROVIDER_ID,
        encryptedServiceAccountKey: 'ciphertext',
      },
    ])
    mocks.decryptSecret.mockResolvedValue({
      decrypted: storedBlob.replace(
        OCI_OBJECT_STORAGE_SERVICE_ACCOUNT_SECRET_TYPE,
        'atlassian_service_account'
      ),
    })
    await expect(getOciObjectStorageServiceAccountSecret('credential-1')).rejects.toThrow(
      'Stored OCI Object Storage credential is malformed'
    )
  })
})
