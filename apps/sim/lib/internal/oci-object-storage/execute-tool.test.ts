/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({
  listBuckets: vi.fn(),
  listObjects: vi.fn(),
  uploadObject: vi.fn(),
  downloadObject: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@sim/logger', () => ({ createLogger: () => mocks.logger }))

vi.mock('@/lib/internal/oci-object-storage/operations', () => ({
  executeOciObjectStorageListBuckets: mocks.listBuckets,
  executeOciObjectStorageListObjects: mocks.listObjects,
  executeOciObjectStorageUploadObject: mocks.uploadObject,
  executeOciObjectStorageDownloadObject: mocks.downloadObject,
  executeOciObjectStorageHeadObject: mocks.headObject,
  executeOciObjectStorageDeleteObject: mocks.deleteObject,
}))

import { executeOciObjectStorageTool } from '@/lib/internal/oci-object-storage/execute-tool'

function request(toolId: string, input: Record<string, unknown>) {
  return {
    toolId,
    input,
    context: { userId: 'user-1' },
    requestId: 'request-1',
  } as Parameters<typeof executeOciObjectStorageTool>[0]
}

describe('OCI Object Storage tool execution boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    [403, 403, 'invalid or lacks permission'],
    [404, 404, 'was not found'],
    [500, 502, 'request failed'],
  ])(
    'maps provider status %i without exposing provider details',
    async (providerStatus, status, text) => {
      const error = Object.assign(new Error('secret-key-canary'), {
        $metadata: { httpStatusCode: providerStatus },
      })
      mocks.headObject.mockRejectedValueOnce(error)

      const response = await executeOciObjectStorageTool(
        request('oci_object_storage_head_object', {
          credentialId: 'credential-1',
          bucketName: 'documents',
          objectKey: 'missing.txt',
        })
      )
      const body = await response.json()

      expect(response.status).toBe(status)
      expect(body.error).toContain(text)
      expect(JSON.stringify(body)).not.toContain('secret-key-canary')
      if (status >= 500) {
        expect(mocks.logger.error).toHaveBeenCalledOnce()
        expect(mocks.logger.warn).not.toHaveBeenCalled()
      } else {
        expect(mocks.logger.warn).toHaveBeenCalledOnce()
        expect(mocks.logger.error).not.toHaveBeenCalled()
      }
    }
  )

  it.each([null, undefined])(
    'sanitizes an upstream %s rejection without throwing from the error boundary',
    async (providerError) => {
      mocks.headObject.mockRejectedValueOnce(providerError)

      const response = await executeOciObjectStorageTool(
        request('oci_object_storage_head_object', {
          credentialId: 'credential-1',
          bucketName: 'documents',
          objectKey: 'missing.txt',
        })
      )

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: 'Oracle Object Storage request failed',
      })
      expect(mocks.logger.error).toHaveBeenCalledOnce()
      expect(mocks.logger.warn).not.toHaveBeenCalled()
    }
  )

  it('reports the bounded bucket-inventory failure without provider details', async () => {
    mocks.listBuckets.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'OCI bucket listing',
        maxBytes: 8,
        observedBytes: 9,
      })
    )
    const response = await executeOciObjectStorageTool(
      request('oci_object_storage_list_buckets', { credentialId: 'credential-1' })
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'OCI bucket listing exceeds the Sim limit',
    })
  })

  it('rejects malformed strict input before calling provider code', async () => {
    const response = await executeOciObjectStorageTool(
      request('oci_object_storage_list_buckets', {
        credentialId: 'credential-1',
        secretAccessKey: 'secret-key-canary',
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.listBuckets).not.toHaveBeenCalled()
    expect(JSON.stringify(await response.json())).not.toContain('secret-key-canary')
  })

  it.each([
    [{ bucketName: 'bucket/name', maxKeys: 10 }, 'bucket'],
    [{ bucketName: 'documents', prefix: 'bad\nkey', maxKeys: 10 }, 'prefix'],
    [{ bucketName: 'documents', delimiter: ':', maxKeys: 10 }, 'delimiter'],
    [{ bucketName: 'documents', continuationToken: 'x'.repeat(1_025), maxKeys: 10 }, 'cursor'],
  ])('rejects OCI-incompatible list inputs before execution (%s)', async (fields) => {
    const response = await executeOciObjectStorageTool(
      request('oci_object_storage_list_objects', {
        credentialId: 'credential-1',
        ...fields,
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.listObjects).not.toHaveBeenCalled()
  })

  it('keeps encoded number-sign and question-mark object keys valid', async () => {
    mocks.headObject.mockResolvedValue({ success: true, output: {} })
    const response = await executeOciObjectStorageTool(
      request('oci_object_storage_head_object', {
        credentialId: 'credential-1',
        bucketName: 'documents',
        objectKey: 'folder/a#b?.txt',
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.headObject).toHaveBeenCalledOnce()
  })

  it.each([null, '', '   '])(
    'applies the maxKeys default to a blank value (%s)',
    async (maxKeys) => {
      mocks.listObjects.mockResolvedValue({ success: true, output: {} })
      const response = await executeOciObjectStorageTool(
        request('oci_object_storage_list_objects', {
          credentialId: 'credential-1',
          bucketName: 'documents',
          maxKeys,
        })
      )

      expect(response.status).toBe(200)
      expect(mocks.listObjects).toHaveBeenCalledWith(
        expect.objectContaining({ maxKeys: 100 }),
        undefined
      )
    }
  )

  it('allows an inline upload without a user actor', async () => {
    mocks.uploadObject.mockResolvedValue({ success: true, output: { size: 5 } })
    const response = await executeOciObjectStorageTool({
      ...request('oci_object_storage_upload_object', {
        credentialId: 'credential-1',
        bucketName: 'documents',
        objectKey: 'report.txt',
        content: 'hello',
      }),
      context: {},
    })

    expect(response.status).toBe(200)
    expect(mocks.uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'hello' }),
      expect.objectContaining({ userId: undefined, requestId: 'request-1' })
    )
  })

  it('uses the trusted delegated subject for file-backed uploads', async () => {
    mocks.uploadObject.mockResolvedValue({ success: true, output: { size: 5 } })
    const response = await executeOciObjectStorageTool({
      ...request('oci_object_storage_upload_object', {
        credentialId: 'credential-1',
        bucketName: 'documents',
        objectKey: 'report.txt',
        file: {
          name: 'report.txt',
          key: 'workspace/file-1',
          size: 5,
          type: 'text/plain',
        },
      }),
      context: {
        executorDelegationOrigin: {
          subjectUserId: 'user-origin',
          workflowId: 'workflow-origin',
          executionId: 'execution-origin',
        },
      },
    })

    expect(response.status).toBe(200)
    expect(mocks.uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.objectContaining({ key: 'workspace/file-1' }) }),
      expect.objectContaining({ userId: 'user-origin', requestId: 'request-1' })
    )
  })
})
