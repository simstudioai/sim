/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpload, mockDeleteIfExists, BlobServiceClientCtor, StorageSharedKeyCredentialCtor } =
  vi.hoisted(() => {
    const mockUpload = vi.fn(async () => ({}))
    const mockDeleteIfExists = vi.fn(async () => ({ succeeded: true }))
    const blockBlobClient = { upload: mockUpload, deleteIfExists: mockDeleteIfExists }
    const containerClient = { getBlockBlobClient: vi.fn(() => blockBlobClient) }
    return {
      mockUpload,
      mockDeleteIfExists,
      BlobServiceClientCtor: vi.fn(() => ({ getContainerClient: vi.fn(() => containerClient) })),
      StorageSharedKeyCredentialCtor: vi.fn(),
    }
  })

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: BlobServiceClientCtor,
  StorageSharedKeyCredential: StorageSharedKeyCredentialCtor,
}))

import { azureBlobDestination } from '@/lib/data-drains/destinations/azure_blob'

const config = { accountName: 'simstore', containerName: 'drains', prefix: 'sim/' }
// Realistic 88-char base64 (64-byte) Azure storage key shape.
const credentials = {
  accountKey:
    'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('azureBlobDestination openSession', () => {
  it('uploads via BlockBlobClient and returns an azure:// locator', async () => {
    const session = azureBlobDestination.openSession({ config, credentials })
    const body = Buffer.from('row\n', 'utf8')
    const result = await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: {
        drainId: 'd1',
        runId: 'r1',
        source: 'workflow_logs',
        sequence: 0,
        rowCount: 1,
        runStartedAt: new Date('2025-06-15T12:00:00Z'),
      },
      signal: new AbortController().signal,
    })

    expect(result.locator).toMatch(
      /^azure:\/\/simstore\/drains\/sim\/workflow_logs\/d1\/\d{4}\/\d{2}\/\d{2}\/r1-00000\.ndjson$/
    )
    expect(mockUpload).toHaveBeenCalledTimes(1)
    const [calledBody, calledLength, opts] = mockUpload.mock.calls[0] as [
      Buffer,
      number,
      { metadata?: Record<string, string> },
    ]
    expect(calledBody).toBe(body)
    expect(calledLength).toBe(body.byteLength)
    expect(opts.metadata?.simdrainid).toBe('d1')
    expect(opts.metadata?.simsequence).toBe('0')

    const fullOpts = opts as {
      blobHTTPHeaders?: { blobContentType?: string }
      abortSignal?: AbortSignal
    }
    expect(fullOpts.blobHTTPHeaders?.blobContentType).toBe('application/x-ndjson')
    expect(fullOpts.abortSignal).toBeDefined()
    expect(StorageSharedKeyCredentialCtor).toHaveBeenCalledWith('simstore', credentials.accountKey)
    expect(BlobServiceClientCtor).toHaveBeenCalledWith(
      'https://simstore.blob.core.windows.net',
      expect.anything(),
      expect.objectContaining({ retryOptions: expect.any(Object) })
    )

    await session.close()
  })

  it('routes to a sovereign-cloud endpoint suffix when configured', async () => {
    const session = azureBlobDestination.openSession({
      config: { ...config, endpointSuffix: 'blob.core.usgovcloudapi.net' },
      credentials,
    })
    await session.deliver({
      body: Buffer.from('row\n', 'utf8'),
      contentType: 'application/x-ndjson',
      metadata: {
        drainId: 'd',
        runId: 'r',
        source: 'workflow_logs',
        sequence: 0,
        rowCount: 1,
        runStartedAt: new Date('2025-06-15T12:00:00Z'),
      },
      signal: new AbortController().signal,
    })
    expect(BlobServiceClientCtor).toHaveBeenCalledWith(
      'https://simstore.blob.core.usgovcloudapi.net',
      expect.anything(),
      expect.objectContaining({ retryOptions: expect.any(Object) })
    )
    await session.close()
  })

  it('surfaces Azure REST errors', async () => {
    mockUpload.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), {
        statusCode: 403,
        code: 'AuthenticationFailed',
      })
    )
    const session = azureBlobDestination.openSession({ config, credentials })
    await expect(
      session.deliver({
        body: Buffer.from('x'),
        contentType: 'application/x-ndjson',
        metadata: {
          drainId: 'd',
          runId: 'r',
          source: 'audit_logs',
          sequence: 0,
          rowCount: 1,
          runStartedAt: new Date('2025-06-15T12:00:00Z'),
        },
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/AuthenticationFailed 403/)
    await session.close()
  })
})

describe('azureBlobDestination test()', () => {
  it('writes a probe blob then attempts cleanup', async () => {
    await azureBlobDestination.test!({
      config,
      credentials,
      signal: new AbortController().signal,
    })
    expect(mockUpload).toHaveBeenCalled()
    expect(mockDeleteIfExists).toHaveBeenCalled()
  })
})

describe('azureBlobDestination config schema', () => {
  it('rejects invalid account names', () => {
    const result = azureBlobDestination.configSchema.safeParse({
      accountName: 'BAD-NAME',
      containerName: 'drains',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid container names', () => {
    const result = azureBlobDestination.configSchema.safeParse({
      accountName: 'simstore',
      containerName: '--bad--',
    })
    expect(result.success).toBe(false)
  })
})

describe('azureBlobDestination credentials schema', () => {
  it('rejects non-base64 account keys', () => {
    const padded = 'a'.repeat(70)
    const result = azureBlobDestination.credentialsSchema.safeParse({
      accountKey: `${padded}!@#$`,
    })
    expect(result.success).toBe(false)
  })

  it('rejects keys that are too short', () => {
    const result = azureBlobDestination.credentialsSchema.safeParse({ accountKey: 'YQ==' })
    expect(result.success).toBe(false)
  })
})
