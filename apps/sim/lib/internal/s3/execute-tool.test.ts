/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeS3CopyObject: vi.fn(),
  executeS3CreateBucket: vi.fn(),
  executeS3DeleteBucket: vi.fn(),
  executeS3DeleteObject: vi.fn(),
  executeS3DeleteObjects: vi.fn(),
  executeS3HeadObject: vi.fn(),
  executeS3ListBuckets: vi.fn(),
  executeS3ListObjects: vi.fn(),
  executeS3PresignedUrl: vi.fn(),
  executeS3PutObject: vi.fn(),
}))

vi.mock('@/lib/internal/s3/operations', () => mockOperations)

import { S3OperationError } from '@/lib/internal/s3/errors'
import { executeS3Tool } from '@/lib/internal/s3/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  region: 'us-east-1',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 's3_list_buckets',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const OBJECT = { ...CONNECTION, bucketName: 'bucket', objectKey: 'folder/file.txt' }

const TOOL_CASES = [
  [
    's3_copy_object',
    {
      ...CONNECTION,
      sourceBucket: 'source',
      sourceKey: 'source.txt',
      destinationBucket: 'destination',
      destinationKey: 'destination.txt',
    },
    mockOperations.executeS3CopyObject,
  ],
  [
    's3_create_bucket',
    { ...CONNECTION, bucketName: 'bucket' },
    mockOperations.executeS3CreateBucket,
  ],
  [
    's3_delete_bucket',
    { ...CONNECTION, bucketName: 'bucket' },
    mockOperations.executeS3DeleteBucket,
  ],
  ['s3_delete_object', OBJECT, mockOperations.executeS3DeleteObject],
  [
    's3_delete_objects',
    { ...CONNECTION, bucketName: 'bucket', keys: ['one'] },
    mockOperations.executeS3DeleteObjects,
  ],
  ['s3_head_object', OBJECT, mockOperations.executeS3HeadObject],
  ['s3_list_buckets', CONNECTION, mockOperations.executeS3ListBuckets],
  ['s3_list_objects', { ...CONNECTION, bucketName: 'bucket' }, mockOperations.executeS3ListObjects],
  [
    's3_presigned_url',
    { ...OBJECT, method: 'get', expiresIn: 300 },
    mockOperations.executeS3PresignedUrl,
  ],
  ['s3_put_object', { ...OBJECT, content: 'hello' }, mockOperations.executeS3PutObject],
] as const

describe('executeS3Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ success: true, output: { toolId } })

    const response = await executeS3Tool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, output: { toolId } })
    if (toolId === 's3_put_object') {
      expect(operation).toHaveBeenCalledWith(input, {
        headers: expect.any(Headers),
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      })
    } else {
      expect(operation).toHaveBeenCalledWith(input, controller.signal)
    }
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeS3Tool(createRequest({ input: { region: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeS3ListBuckets).not.toHaveBeenCalled()
  })

  it('preserves S3 operation status and error envelopes', async () => {
    mockOperations.executeS3PutObject.mockRejectedValue(
      new S3OperationError('Either file or content must be provided', 400)
    )

    const response = await executeS3Tool(
      createRequest({
        toolId: 's3_put_object',
        input: { ...OBJECT, content: 'hello' },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Either file or content must be provided',
    })
  })

  it('propagates cancellation before provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(executeS3Tool(createRequest({ signal: controller.signal }))).rejects.toMatchObject(
      { name: 'AbortError' }
    )
    expect(mockOperations.executeS3ListBuckets).not.toHaveBeenCalled()
  })
})
