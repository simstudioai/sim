/**
 * @vitest-environment node
 */
import { ListBucketsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSecret: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/credentials/oci-object-storage-service-account', () => ({
  getOciObjectStorageServiceAccountSecret: mocks.getSecret,
}))
vi.mock('@/lib/internal/oci-object-storage/client', () => ({
  withOciObjectStorageClient: async (
    _secret: unknown,
    _attempts: number,
    execute: (client: { send: typeof mocks.send }) => Promise<unknown>
  ) => execute({ send: mocks.send }),
  sendOciListBuckets: (client: { send: typeof mocks.send }, signal?: AbortSignal) =>
    client.send(new ListBucketsCommand({}), { abortSignal: signal }),
}))

import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociObjectStorageSelectorAttachments } from '@/lib/selectors/server/providers/oci-object-storage'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(
  selectorKey: 'oci_object_storage.buckets' | 'oci_object_storage.objects',
  overrides: Partial<ExecuteServerSelectorArgs> = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context:
      selectorKey === 'oci_object_storage.objects'
        ? { bucketName: 'bucket-name', prefix: 'folder/' }
        : {},
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: {
      suppliedId: 'credential-reference-canary',
      providerId: 'oci-object-storage-service-account',
      access: {
        ok: true,
        resolvedCredentialId: 'credential-1',
        credentialType: 'service_account',
        credentialOwnerUserId: 'owner-1',
        workspaceId: 'workspace-1',
      } as never,
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

async function prepare(input: ExecuteServerSelectorArgs) {
  const attachment = ociObjectStorageSelectorAttachments[input.selectorKey]
  const destination = attachment.destination
  if (destination === 'fixed') throw new Error('Expected a credential-bound destination')
  return destination.prepare(input)
}

describe('OCI Object Storage selectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSecret.mockResolvedValue({
      accessKeyId: 'access-key-canary',
      secretAccessKey: 'secret-key-canary',
      namespace: 'namespace1',
      region: 'us-ashburn-1',
    })
  })

  it('declares API-key integration gating and credential-bound destinations', () => {
    expect(ociObjectStorageSelectorAttachments['oci_object_storage.buckets']).toMatchObject({
      integrationBlockTypes: ['oci_object_storage'],
      destination: { kind: 'credential-bound' },
    })
    expect(ociObjectStorageSelectorAttachments['oci_object_storage.objects']).toMatchObject({
      integrationBlockTypes: ['oci_object_storage'],
      destination: { kind: 'credential-bound' },
    })
  })

  it('loads only the authorized resolved OCI credential reference', async () => {
    const input = args('oci_object_storage.buckets')
    await prepare(input)
    expect(mocks.getSecret).toHaveBeenCalledWith('credential-1')

    await expect(
      prepare(
        args('oci_object_storage.buckets', {
          credential: {
            suppliedId: 'credential-1',
            providerId: 'atlassian-service-account',
            access: input.credential?.access,
          },
        })
      )
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
  })

  it('returns sorted bucket options without credential metadata', async () => {
    mocks.send.mockResolvedValue({
      Buckets: [
        { Name: 'z-bucket', CreationDate: new Date('2026-09-02T12:00:00Z') },
        { Name: 'a-bucket' },
      ],
    })
    const input = args('oci_object_storage.buckets')
    const secret = await prepare(input)
    const result = await ociObjectStorageSelectorAttachments['oci_object_storage.buckets'].execute(
      input,
      secret
    )

    expect(mocks.send.mock.calls[0]?.[0]).toBeInstanceOf(ListBucketsCommand)
    expect(result).toEqual({
      kind: 'list',
      items: [
        { id: 'a-bucket', label: 'a-bucket' },
        {
          id: 'z-bucket',
          label: 'z-bucket',
          meta: { detail: 'Created 2026-09-02T12:00:00.000Z' },
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('key-canary')
    expect(JSON.stringify(result)).not.toContain('credential-reference-canary')
  })

  it('forwards bucket, prefix, and opaque cursor with a bounded page size', async () => {
    mocks.send.mockResolvedValue({
      Contents: [
        {
          Key: 'folder/a b.txt',
          Size: 7,
          LastModified: new Date('2026-09-02T12:00:00Z'),
        },
      ],
      IsTruncated: true,
      NextContinuationToken: 'opaque-next+/=',
    })
    const input = args('oci_object_storage.objects', {
      request: { kind: 'list', cursor: 'opaque-current+/=' },
    })
    const secret = await prepare(input)
    const result = await ociObjectStorageSelectorAttachments['oci_object_storage.objects'].execute(
      input,
      secret
    )

    const command = mocks.send.mock.calls[0]?.[0]
    expect(command).toBeInstanceOf(ListObjectsV2Command)
    expect(command.input).toEqual({
      Bucket: 'bucket-name',
      Prefix: 'folder/',
      MaxKeys: 100,
      ContinuationToken: 'opaque-current+/=',
    })
    expect(result).toEqual({
      kind: 'list',
      items: [
        {
          id: 'folder/a b.txt',
          label: 'folder/a b.txt',
          meta: { detail: '7 bytes · 2026-09-02T12:00:00.000Z' },
        },
      ],
      nextCursor: 'opaque-next+/=',
    })
  })

  it('rejects missing dependencies and overlong cursors before provider execution', async () => {
    const missingBucket = args('oci_object_storage.objects', { context: {} })
    const secret = await prepare(missingBucket)
    await expect(
      ociObjectStorageSelectorAttachments['oci_object_storage.objects'].execute(
        missingBucket,
        secret
      )
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)

    const longCursor = args('oci_object_storage.objects', {
      request: { kind: 'list', cursor: 'x'.repeat(1_025) },
    })
    await expect(
      ociObjectStorageSelectorAttachments['oci_object_storage.objects'].execute(longCursor, secret)
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('enforces Oracle bucket and prefix constraints before provider execution', async () => {
    const secret = await prepare(args('oci_object_storage.objects'))
    for (const context of [
      { bucketName: 'bucket/name' },
      { bucketName: 'bucket-name', prefix: 'bad\nkey' },
      { bucketName: 'bucket-name', prefix: '🙂'.repeat(257) },
    ]) {
      const input = args('oci_object_storage.objects', { context })
      await expect(
        ociObjectStorageSelectorAttachments['oci_object_storage.objects'].execute(input, secret)
      ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    }
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('sanitizes provider failures and rejects truncated responses without a cursor', async () => {
    mocks.send.mockRejectedValueOnce({
      message: 'provider-secret-canary',
      $metadata: { httpStatusCode: 403 },
    })
    const input = args('oci_object_storage.objects')
    const secret = await prepare(input)
    const failure = ociObjectStorageSelectorAttachments['oci_object_storage.objects'].execute(
      input,
      secret
    )
    await expect(failure).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    await expect(failure.catch((error) => error.message)).resolves.not.toContain(
      'provider-secret-canary'
    )

    mocks.send.mockResolvedValueOnce({ Contents: [], IsTruncated: true })
    await expect(
      ociObjectStorageSelectorAttachments['oci_object_storage.objects'].execute(input, secret)
    ).rejects.toBeDefined()
  })
})
