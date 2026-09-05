/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ executeOciNativeOperation: vi.fn() }))
vi.mock('@/lib/internal/oci-object-storage-native/operations', () => mocks)

import { OciClientError } from '@/lib/internal/oci/errors'
import { executeOciObjectStorageNativeTool } from '@/lib/internal/oci-object-storage-native/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import {
  createOciNativeOperationInput,
  OCI_NATIVE_JSON_BYTES,
} from '@/tools/oci_object_storage_native/shared'

const AUTH = { credentialId: 'authorized', namespace: 'namespace' }
const BUCKET = { ...AUTH, bucketName: 'reports' }
const OBJECT = { ...BUCKET, objectName: 'report.txt' }
const MULTIPART = { ...OBJECT, uploadId: 'upload' }
const CASES: [string, Record<string, unknown>][] = [
  ['get_namespace', AUTH],
  ['list_buckets', { ...AUTH, compartmentId: 'compartment' }],
  ['get_bucket', BUCKET],
  ['create_bucket', { ...BUCKET, compartmentId: 'compartment' }],
  ['update_bucket', { ...BUCKET, versioning: 'Enabled' }],
  ['delete_bucket', BUCKET],
  ['list_objects', BUCKET],
  ['head_object', OBJECT],
  ['upload_object', { ...OBJECT, content: '' }],
  ['download_object', OBJECT],
  [
    'copy_object',
    {
      ...OBJECT,
      destinationRegion: 'us-phoenix-1',
      destinationNamespace: 'namespace',
      destinationBucket: 'copies',
      destinationObjectName: 'copy',
    },
  ],
  ['rename_object', { ...OBJECT, newName: 'new' }],
  ['delete_object', OBJECT],
  ['batch_delete_objects', { ...BUCKET, objects: [{ objectName: 'report.txt' }] }],
  ['list_object_versions', BUCKET],
  ['restore_object', OBJECT],
  ['update_object_storage_tier', { ...OBJECT, storageTier: 'Archive' }],
  ['get_lifecycle_policy', BUCKET],
  ['put_lifecycle_policy', { ...BUCKET, rules: [] }],
  ['delete_lifecycle_policy', BUCKET],
  ['create_multipart_upload', OBJECT],
  ['upload_part', { ...MULTIPART, partNumber: 1, content: '' }],
  ['list_multipart_uploads', BUCKET],
  ['list_multipart_parts', MULTIPART],
  ['commit_multipart_upload', { ...MULTIPART, partsToCommit: [{ partNum: 1, etag: 'etag' }] }],
  ['abort_multipart_upload', MULTIPART],
  [
    'create_preauthenticated_request',
    {
      ...OBJECT,
      name: 'Report',
      scope: 'object',
      accessType: 'ObjectRead',
      timeExpires: '2099-01-01T00:00:00Z',
    },
  ],
  ['list_preauthenticated_requests', BUCKET],
  ['get_preauthenticated_request', { ...BUCKET, parId: 'par' }],
  ['delete_preauthenticated_request', { ...BUCKET, parId: 'par' }],
  ['get_work_request', { ...AUTH, workRequestId: 'work' }],
]

function request(operation: string, input: unknown): InternalToolOperationCall {
  return {
    toolId: `oci_object_storage_native_${operation}`,
    input,
    headers: new Headers(),
    context: { workflowId: 'workflow', workspaceId: 'trusted-workspace', userId: 'actor' },
    requestId: 'request',
  }
}

describe('native OCI tool operation handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeOciNativeOperation.mockResolvedValue({ success: true, output: {} })
  })

  it.each(CASES)(
    'validates and dispatches %s with trusted workspace context',
    async (operation, input) => {
      const result = await executeOciObjectStorageNativeTool(request(operation, input))
      expect(result.status).toBe(200)
      expect(mocks.executeOciNativeOperation).toHaveBeenCalledWith(
        expect.objectContaining({ ...input, operation }),
        {
          workspaceId: 'trusted-workspace',
          workflowId: 'workflow',
          executionId: undefined,
          userId: 'actor',
          requestId: 'request',
          signal: undefined,
        }
      )
    }
  )

  it('maps the authorized hidden reference and strips the caller execution context', async () => {
    const input = createOciNativeOperationInput({
      oauthCredential: 'visible-selection',
      accessToken: 'authorized',
      _context: { workspaceId: 'attacker' },
      _credentialId: 'bookkeeping',
      _workflowId: 'workflow',
      credential: undefined,
      impersonateUserEmail: undefined,
      namespace: 'namespace',
    })
    expect(input).toEqual(AUTH)
    await executeOciObjectStorageNativeTool(request('get_namespace', input))
    expect(mocks.executeOciNativeOperation).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'authorized' }),
      expect.objectContaining({ workspaceId: 'trusted-workspace' })
    )
    const missing = createOciNativeOperationInput({ oauthCredential: 'visible-selection' })
    expect(
      (await executeOciObjectStorageNativeTool(request('get_namespace', missing))).status
    ).toBe(400)
  })

  it.each<[string, Record<string, unknown>]>([
    ['ASCII text', { content: 'x'.repeat(OCI_NATIVE_JSON_BYTES) }],
    ['escaped text', { content: '\u0000'.repeat(OCI_NATIVE_JSON_BYTES / 4) }],
    [
      'combined fields',
      {
        content: 'x'.repeat(OCI_NATIVE_JSON_BYTES / 2),
        metadata: { label: 'x'.repeat(OCI_NATIVE_JSON_BYTES / 2) },
      },
    ],
  ])('rejects oversized %s before serialization or dispatch', async (_label, source) => {
    const input = { ...OBJECT, ...source }
    expect(() =>
      createOciNativeOperationInput(
        { ...input, oauthCredential: 'visible', accessToken: 'authorized' },
        ['bucketName', 'objectName', 'content', 'metadata']
      )
    ).toThrow('OCI request exceeds 8 MiB of JSON; use a file for larger uploads')
    const response = await executeOciObjectStorageNativeTool(request('upload_object', input))
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'OCI request exceeds 8 MiB of JSON; use a file for larger uploads',
    })
    expect(mocks.executeOciNativeOperation).not.toHaveBeenCalled()
  })

  it.each([
    { content: '' },
    { file: { key: 'file', name: 'report.txt', size: MAX_BUFFERED_TRANSFER_BYTES } },
  ])('admits empty text and 100 MiB file references after field projection', async (source) => {
    const input = createOciNativeOperationInput(
      {
        ...OBJECT,
        ...source,
        oauthCredential: 'visible',
        accessToken: 'authorized',
        _context: { unrelated: 'x'.repeat(OCI_NATIVE_JSON_BYTES) },
        unused: 'x'.repeat(OCI_NATIVE_JSON_BYTES),
      },
      ['bucketName', 'objectName', 'file', 'content']
    )
    expect(input).toEqual({ ...OBJECT, ...source })
    const response = await executeOciObjectStorageNativeTool(request('upload_object', input))
    expect(response.status).toBe(200)
    expect(mocks.executeOciNativeOperation).toHaveBeenCalledWith(
      expect.objectContaining(source),
      expect.anything()
    )
  })

  it('rejects circular inputs with safe errors before parsing or dispatch', async () => {
    const metadata: Record<string, unknown> = {}
    metadata.secret = metadata
    expect(() =>
      createOciNativeOperationInput(
        { oauthCredential: 'visible', accessToken: 'authorized', metadata },
        ['metadata']
      )
    ).toThrow('Converting circular structure to JSON')
    const response = await executeOciObjectStorageNativeTool(
      request('upload_object', { ...OBJECT, content: '', metadata })
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Invalid or excessively nested OCI JSON input',
    })
    expect(mocks.executeOciNativeOperation).not.toHaveBeenCalled()
  })

  it.each([
    { ...AUTH, workspaceId: 'injected' },
    { ...AUTH, operation: 'delete_bucket' },
    { ...AUTH, authorization: 'injected' },
  ])('rejects unexpected authority or operation fields', async (input) => {
    expect((await executeOciObjectStorageNativeTool(request('get_namespace', input))).status).toBe(
      400
    )
    expect(mocks.executeOciNativeOperation).not.toHaveBeenCalled()
  })

  it('requires trusted workspace scope', async () => {
    const call = request('get_namespace', AUTH)
    call.context.workspaceId = undefined
    expect((await executeOciObjectStorageNativeTool(call)).status).toBe(403)
    expect(mocks.executeOciNativeOperation).not.toHaveBeenCalled()
  })

  it('uses the delegated subject for file authorization', async () => {
    const call = request('upload_object', {
      ...OBJECT,
      file: { key: 'file', name: 'file.txt', size: 0 },
    })
    call.context.executorDelegationOrigin = {
      subjectUserId: 'delegated-actor',
      workflowId: 'origin-workflow',
      executionId: 'origin-execution',
    }
    await executeOciObjectStorageNativeTool(call)
    expect(mocks.executeOciNativeOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'delegated-actor', workspaceId: 'trusted-workspace' })
    )
  })

  it('projects safe foundation failures without exposing arbitrary error details', async () => {
    mocks.executeOciNativeOperation.mockRejectedValueOnce(
      new OciClientError('request_failed', { status: 412 })
    )
    const known = await executeOciObjectStorageNativeTool(request('get_namespace', AUTH))
    expect(known.status).toBe(412)
    await expect(known.json()).resolves.toEqual({ success: false, error: 'OCI request failed' })
    mocks.executeOciNativeOperation.mockRejectedValueOnce(
      new Error('private-key-or-storage-secret')
    )
    const unknown = await executeOciObjectStorageNativeTool(request('get_namespace', AUTH))
    await expect(unknown.json()).resolves.toEqual({
      success: false,
      error: 'OCI Object Storage operation failed',
    })
  })

  it('preserves cancellation before and after provider work', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Canceled', 'AbortError')
    const call = { ...request('get_namespace', AUTH), signal: controller.signal }
    mocks.executeOciNativeOperation.mockImplementationOnce(async () => {
      controller.abort(reason)
      throw reason
    })
    await expect(executeOciObjectStorageNativeTool(call)).rejects.toBe(reason)
    mocks.executeOciNativeOperation.mockClear()
    await expect(executeOciObjectStorageNativeTool(call)).rejects.toBe(reason)
    expect(mocks.executeOciNativeOperation).not.toHaveBeenCalled()
  })
})
