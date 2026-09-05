/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadExecutionFile: vi.fn(),
  uploadCopilotFile: vi.fn(),
  createOciClient: vi.fn(),
  prepareStaticEndpoint: vi.fn(),
  request: vi.fn(),
  assertToolFileAccess: vi.fn(),
  processSingleFileToUserFile: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))
vi.mock('@/lib/uploads/contexts/copilot', () => ({ uploadCopilotFile: mocks.uploadCopilotFile }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createOciClient }))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: mocks.processSingleFileToUserFile,
  isInternalFileUrl: vi.fn(() => false),
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import { executeOciNativeOperation } from '@/lib/internal/oci-object-storage-native/operations'
import { ociNativeInputSchema } from '@/lib/internal/oci-object-storage-native/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { isOciNativeJsonWithinLimit } from '@/tools/oci_object_storage_native/shared'

const CONNECTION = {
  credentialId: 'authorized-credential',
  namespace: 'namespace',
  region: 'us-ashburn-1',
}
const BUCKET = { ...CONNECTION, bucketName: 'reports' }
const OBJECT = { ...BUCKET, objectName: 'report.txt' }
const CONTEXT = {
  workspaceId: 'trusted-workspace',
  requestId: 'request-1',
  userId: 'user-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}
const ORIGIN = 'https://objectstorage.us-ashburn-1.oraclecloud.com'

function response(body: unknown = {}, headers: Record<string, string> = {}, status = 200) {
  return {
    status,
    headers,
    opcRequestId: 'oracle-request',
    body: new Uint8Array(Buffer.from(JSON.stringify(body))),
  }
}
function run(operation: string, input: Record<string, unknown> = BUCKET) {
  return executeOciNativeOperation(ociNativeInputSchema.parse({ operation, ...input }), CONTEXT)
}
function requestBody() {
  return JSON.parse(Buffer.from(mocks.request.mock.calls.at(-1)?.[0].body).toString())
}

describe('native OCI operation contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      key: 'workspace/trusted-workspace/file-1',
      name: 'report.txt',
      size: 3,
      type: 'application/octet-stream',
    })
    mocks.uploadCopilotFile.mockResolvedValue({
      id: 'copilot-file',
      key: 'copilot/file',
      name: 'report.txt',
      size: 0,
      type: 'text/plain',
    })
    mocks.createOciClient.mockResolvedValue({
      prepareStaticEndpoint: mocks.prepareStaticEndpoint,
      request: mocks.request,
    })
    mocks.prepareStaticEndpoint.mockResolvedValue({ origin: ORIGIN })
    mocks.request.mockResolvedValue(response())
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.processSingleFileToUserFile.mockReturnValue({
      key: 'workspace/trusted-workspace/file',
      name: 'report.txt',
      size: 5,
      type: 'text/plain',
    })
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
  })

  it('discovers a namespace with the authorized binding and uses one shared deadline', async () => {
    mocks.request
      .mockResolvedValueOnce(response('resolved-namespace'))
      .mockResolvedValueOnce(response({ objects: [] }))
    await run('list_objects', { credentialId: 'authorized-credential', bucketName: 'reports' })
    expect(mocks.createOciClient).toHaveBeenCalledWith({
      credentialId: 'authorized-credential',
      workspaceId: 'trusted-workspace',
      serviceId: 'oci_object_storage_native',
      region: undefined,
    })
    expect(mocks.request.mock.calls[0][0]).toMatchObject({ method: 'GET', encodedPath: '/n/' })
    expect(mocks.request.mock.calls[1][0]).toMatchObject({
      method: 'GET',
      encodedPath: '/n/resolved-namespace/b/reports/o',
      maxResponseBytes: 8 * 1024 * 1024,
      retry: { kind: 'safe', maxAttempts: 3 },
    })
    expect(mocks.request.mock.calls[1][0].timeoutMs).toBeLessThanOrEqual(30_000)
  })

  it('preserves complete path parameters, native metadata, versions, and read conditions', async () => {
    mocks.request.mockResolvedValue(
      response(
        {},
        {
          etag: 'etag',
          'content-length': '42',
          'opc-meta-owner': 'analytics',
          'version-id': 'v1',
          'archival-state': 'Archived',
        }
      )
    )
    const result = await run('head_object', {
      ...OBJECT,
      namespace: 'name/space',
      objectName: ' 空 /a%2Fb\\.txt ',
      versionId: 'v/1%',
      ifMatch: 'etag',
    })
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'HEAD',
        encodedPath: '/n/name%2Fspace/b/reports/o/%20%E7%A9%BA%20%2Fa%252Fb%5C.txt%20',
        queryPairs: [['versionId', 'v/1%']],
        headers: { 'if-match': 'etag' },
        responseHeaders: expect.arrayContaining(['opc-meta-*', 'version-id']),
      })
    )
    expect(result.output).toMatchObject({
      contentLength: 42,
      metadata: { owner: 'analytics' },
      versionId: 'v1',
      archivalState: 'Archived',
    })
  })

  it('uses inclusive nextStartWith for objects and page headers for version listings', async () => {
    mocks.request.mockResolvedValueOnce(
      response(
        { objects: [{ name: ' a ', size: 1 }], prefixes: [' folder/'], nextStartWith: ' next/% ' },
        { 'opc-next-page': 'ignore' }
      )
    )
    const objects = await run('list_objects', {
      ...BUCKET,
      start: ' current/% ',
      prefix: ' ',
      delimiter: '/',
      limit: 2,
    })
    expect(objects.output).toMatchObject({ nextStartWith: ' next/% ', prefixes: [' folder/'] })
    expect(objects.output).not.toHaveProperty('nextPage')
    expect(mocks.request.mock.calls[0][0].queryPairs).toEqual(
      expect.arrayContaining([
        ['start', ' current/% '],
        ['prefix', ' '],
        ['limit', '2'],
      ])
    )
    mocks.request.mockResolvedValueOnce(
      response(
        {
          items: [
            {
              name: 'a',
              versionId: 'v1',
              isDeleteMarker: true,
              timeModified: '2026-01-01T00:00:00Z',
            },
          ],
        },
        { 'opc-next-page': 'version-page' }
      )
    )
    const versions = await run('list_object_versions', { ...BUCKET, page: 'previous-page' })
    expect(versions.output).toMatchObject({
      nextPage: 'version-page',
      versions: [{ versionId: 'v1', isDeleteMarker: true }],
    })
    expect(mocks.request.mock.calls[1][0].queryPairs).toContainEqual(['page', 'previous-page'])
  })

  it('creates private buckets and updates settings with native POST', async () => {
    mocks.request.mockResolvedValue(
      response({ name: 'reports', versioning: 'Disabled' }, { etag: 'bucket-etag' })
    )
    await run('create_bucket', { ...BUCKET, compartmentId: 'ocid1.compartment.oc1..example' })
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      encodedPath: '/n/namespace/b/',
    })
    expect(requestBody()).toEqual({
      name: 'reports',
      compartmentId: 'ocid1.compartment.oc1..example',
      publicAccessType: 'NoPublicAccess',
      storageTier: 'Standard',
      versioning: 'Disabled',
    })
    await run('update_bucket', { ...BUCKET, versioning: 'Suspended', ifMatch: 'bucket-etag' })
    expect(mocks.request.mock.calls[1][0]).toMatchObject({
      method: 'POST',
      encodedPath: '/n/namespace/b/reports/',
      headers: { 'if-match': 'bucket-etag' },
    })
    expect(requestBody()).toEqual({ versioning: 'Suspended' })
  })

  it.each([
    {
      operation: 'get_namespace',
      input: { ...CONNECTION, compartmentId: 'compartment' },
      method: 'GET',
      path: '/n/',
      query: [['compartmentId', 'compartment']],
      response: 'namespace',
    },
    {
      operation: 'list_buckets',
      input: { ...CONNECTION, compartmentId: 'compartment', page: 'bucket-page' },
      method: 'GET',
      path: '/n/namespace/b/',
      query: [
        ['compartmentId', 'compartment'],
        ['page', 'bucket-page'],
      ],
      response: [],
    },
    {
      operation: 'get_bucket',
      input: BUCKET,
      method: 'GET',
      path: '/n/namespace/b/reports/',
      query: [['fields', 'approximateCount,approximateSize']],
      response: { name: 'reports' },
    },
    {
      operation: 'rename_object',
      input: { ...OBJECT, newName: 'new/% name', srcObjIfMatchETag: 'etag' },
      method: 'POST',
      path: '/n/namespace/b/reports/actions/renameObject',
      body: { sourceName: 'report.txt', newName: 'new/% name', srcObjIfMatchETag: 'etag' },
    },
    {
      operation: 'restore_object',
      input: { ...OBJECT, versionId: 'version', hours: 48 },
      method: 'POST',
      path: '/n/namespace/b/reports/actions/restoreObjects',
      body: { objectName: 'report.txt', versionId: 'version', hours: 48 },
    },
    {
      operation: 'update_object_storage_tier',
      input: { ...OBJECT, versionId: 'version', storageTier: 'Archive' },
      method: 'POST',
      path: '/n/namespace/b/reports/actions/updateObjectStorageTier',
      body: { objectName: 'report.txt', versionId: 'version', storageTier: 'Archive' },
    },
    {
      operation: 'create_multipart_upload',
      input: { ...OBJECT, metadata: { owner: 'team' }, contentType: 'text/plain' },
      method: 'POST',
      path: '/n/namespace/b/reports/u',
      body: {
        object: 'report.txt',
        metadata: { 'opc-meta-owner': 'team' },
        contentType: 'text/plain',
      },
      response: { uploadId: 'upload' },
    },
    {
      operation: 'list_multipart_uploads',
      input: { ...BUCKET, page: 'upload-page' },
      method: 'GET',
      path: '/n/namespace/b/reports/u',
      query: [['page', 'upload-page']],
      response: [],
    },
    {
      operation: 'list_multipart_parts',
      input: { ...OBJECT, uploadId: 'upload', page: 'parts-page' },
      method: 'GET',
      path: '/n/namespace/b/reports/u/report.txt',
      query: [
        ['uploadId', 'upload'],
        ['page', 'parts-page'],
      ],
      response: [{ partNumber: 1, etag: 'etag', md5: 'md5', size: 0 }],
    },
    {
      operation: 'list_preauthenticated_requests',
      input: { ...BUCKET, objectNamePrefix: ' prefix/', page: 'par-page' },
      method: 'GET',
      path: '/n/namespace/b/reports/p/',
      query: [
        ['objectNamePrefix', ' prefix/'],
        ['page', 'par-page'],
      ],
      response: [],
    },
  ])('matches Oracle request contract for $operation', async (entry) => {
    mocks.request.mockResolvedValue(
      response(entry.response ?? null, { 'opc-next-page': 'next-page' })
    )
    const result = await run(entry.operation, entry.input)
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: entry.method,
      encodedPath: entry.path,
    })
    if (entry.body) expect(requestBody()).toEqual(entry.body)
    if (entry.query)
      expect(mocks.request.mock.calls[0][0].queryPairs).toEqual(expect.arrayContaining(entry.query))
    if (entry.operation === 'list_multipart_parts')
      expect(result.output).toMatchObject({ objectName: 'report.txt', nextPage: 'next-page' })
  })

  it('returns an asynchronous copy ID and polls status only once', async () => {
    mocks.request.mockResolvedValueOnce(response(null, { 'opc-work-request-id': 'work/1' }, 202))
    const result = await run('copy_object', {
      ...OBJECT,
      destinationRegion: 'us-phoenix-1',
      destinationNamespace: 'destination',
      destinationBucket: 'archive',
      destinationObjectName: 'copy.txt',
      sourceVersionId: 'v1',
      destinationObjectMetadata: { owner: 'analytics' },
    })
    expect(result.output).toMatchObject({ accepted: true, workRequestId: 'work/1' })
    expect(requestBody()).toMatchObject({
      sourceObjectName: 'report.txt',
      sourceVersionId: 'v1',
      destinationObjectMetadata: { 'opc-meta-owner': 'analytics' },
    })
    expect(mocks.request).toHaveBeenCalledOnce()
    mocks.request.mockResolvedValueOnce(
      response({ id: 'work/1', status: 'COMPLETED', percentComplete: 100, resources: [] })
    )
    const status = await run('get_work_request', { ...CONNECTION, workRequestId: 'work/1' })
    expect(status.output.workRequest).toMatchObject({ status: 'COMPLETED' })
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('preserves partial batch failure and native per-object conditions', async () => {
    mocks.request.mockResolvedValue(
      response({
        deleted: [{ objectName: 'ok', timeLastModified: '2026-01-01T00:00:00Z' }],
        failed: [{ objectName: 'changed', statusCode: 412, errorMessage: 'ETag mismatch' }],
      })
    )
    const result = await run('batch_delete_objects', {
      ...BUCKET,
      objects: [{ objectName: 'ok' }, { objectName: 'changed', ifMatch: 'previous' }],
    })
    expect(requestBody()).toEqual({
      objects: [{ objectName: 'ok' }, { objectName: 'changed', ifMatch: 'previous' }],
      isSkipDeletedResult: false,
    })
    expect(result.output).toMatchObject({
      allSucceeded: false,
      failed: [{ objectName: 'changed', statusCode: 412 }],
    })
  })

  it('replaces a lifecycle policy, including an explicitly empty policy', async () => {
    mocks.request.mockResolvedValue(
      response({ items: [], timeCreated: '2026-01-01T00:00:00Z' }, { etag: 'new' })
    )
    const result = await run('put_lifecycle_policy', { ...BUCKET, rules: [], ifMatch: 'previous' })
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: 'PUT',
      encodedPath: '/n/namespace/b/reports/l',
      headers: { 'if-match': 'previous' },
    })
    expect(requestBody()).toEqual({ items: [] })
    expect(result.output).toMatchObject({ rules: [], etag: 'new' })
  })

  it('commits only an explicit multipart manifest and reads header-based completion', async () => {
    mocks.request.mockResolvedValue(
      response(null, { etag: 'completed', 'opc-multipart-md5': 'checksum', 'version-id': 'v2' })
    )
    const manifest = [
      { partNum: 1, etag: 'part-one' },
      { partNum: 3, etag: 'part-three' },
    ]
    const result = await run('commit_multipart_upload', {
      ...OBJECT,
      uploadId: 'upload/1',
      partsToCommit: manifest,
      partsToExclude: [2],
      ifNoneMatch: '*',
    })
    expect(requestBody()).toEqual({ partsToCommit: manifest, partsToExclude: [2] })
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      encodedPath: '/n/namespace/b/reports/u/report.txt',
      queryPairs: [['uploadId', 'upload/1']],
      headers: { 'if-none-match': '*' },
    })
    expect(result.output).toMatchObject({
      etag: 'completed',
      multipartMd5: 'checksum',
      versionId: 'v2',
    })
  })

  it('creates a deliberate expiring access grant and never recovers a URL from GET', async () => {
    const grant = {
      id: 'par/1',
      name: 'Report',
      accessType: 'ObjectRead',
      objectName: 'report.txt',
      timeExpires: '2099-01-01T00:00:00Z',
      timeCreated: '2026-01-01T00:00:00Z',
    }
    mocks.request.mockResolvedValueOnce(
      response({ ...grant, accessUri: '/p/secret/n/namespace/b/reports/o/report.txt' })
    )
    const created = await run('create_preauthenticated_request', {
      ...OBJECT,
      name: 'Report',
      scope: 'object',
      accessType: 'ObjectRead',
      timeExpires: grant.timeExpires,
    })
    expect(requestBody()).toMatchObject({ bucketListingAction: 'Deny', objectName: 'report.txt' })
    expect(requestBody()).not.toHaveProperty('scope')
    expect(created.output.accessUrl).toBe(`${ORIGIN}/p/secret/n/namespace/b/reports/o/report.txt`)
    mocks.request.mockResolvedValueOnce(response({ ...grant, accessUri: 'must-not-leak' }))
    const summary = await run('get_preauthenticated_request', { ...BUCKET, parId: 'par/1' })
    expect(summary.output).toEqual({ request: grant, requestId: 'oracle-request' })
  })

  it.each([
    ['delete_bucket', BUCKET, '/n/namespace/b/reports/'],
    [
      'delete_object',
      { ...OBJECT, versionId: 'permanent-version' },
      '/n/namespace/b/reports/o/report.txt',
    ],
    ['delete_lifecycle_policy', BUCKET, '/n/namespace/b/reports/l'],
    [
      'abort_multipart_upload',
      { ...OBJECT, uploadId: 'upload' },
      '/n/namespace/b/reports/u/report.txt',
    ],
    [
      'delete_preauthenticated_request',
      { ...BUCKET, parId: 'par' },
      '/n/namespace/b/reports/p/par',
    ],
  ])('accepts empty native deletion responses for %s', async (operation, input, path) => {
    mocks.request.mockResolvedValue({
      status: operation === 'delete_preauthenticated_request' ? 200 : 204,
      headers: { 'is-delete-marker': 'false', 'version-id': 'permanent-version' },
      body: new Uint8Array(),
    })
    await run(operation as string, input as Record<string, unknown>)
    expect(mocks.request.mock.calls[0][0]).toMatchObject({ method: 'DELETE', encodedPath: path })
    expect(mocks.request.mock.calls[0][0]).not.toHaveProperty('retry')
    if (operation === 'delete_object')
      expect(mocks.request.mock.calls[0][0].queryPairs).toEqual([
        ['versionId', 'permanent-version'],
      ])
  })
})

describe('native OCI bounded files and schemas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.uploadExecutionFile.mockResolvedValue({
      id: 'file-1',
      key: 'workspace/trusted-workspace/file-1',
      name: 'report.txt',
      size: 3,
      type: 'application/octet-stream',
    })
    mocks.uploadCopilotFile.mockResolvedValue({
      id: 'copilot-file',
      key: 'copilot/file',
      name: 'report.txt',
      size: 0,
      type: 'text/plain',
    })
    mocks.createOciClient.mockResolvedValue({
      prepareStaticEndpoint: mocks.prepareStaticEndpoint,
      request: mocks.request,
    })
    mocks.prepareStaticEndpoint.mockResolvedValue({ origin: ORIGIN })
    mocks.request.mockResolvedValue(response(null))
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.processSingleFileToUserFile.mockReturnValue({
      key: 'workspace/file',
      name: 'page.md',
      size: 0,
      type: 'text/markdown',
    })
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('<p>Hello</p>'),
      contentType: 'text/html',
    })
  })

  it.each(['upload_object', 'upload_part'])(
    'authorizes and reads the servable file for %s',
    async (operation) => {
      await run(operation, {
        ...OBJECT,
        ...(operation === 'upload_part' ? { uploadId: 'upload', partNumber: 1 } : {}),
        file: { key: 'workspace/file', name: 'page.md', size: 0 },
      })
      expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
        'workspace/file',
        'user-1',
        'request-1',
        expect.anything()
      )
      expect(mocks.downloadServableFileFromStorage).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'workspace/file' }),
        'request-1',
        expect.anything(),
        { maxBytes: MAX_BUFFERED_TRANSFER_BYTES, signal: expect.any(AbortSignal) }
      )
      expect(mocks.request.mock.calls[0][0]).toMatchObject({
        method: 'PUT',
        contentType: 'text/html',
      })
      expect(Buffer.from(mocks.request.mock.calls[0][0].body).toString()).toBe('<p>Hello</p>')
      expect(mocks.request.mock.calls[0][0]).not.toHaveProperty('retry')
    }
  )

  it('denies unauthorized files before storage reads or object writes', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))
    await expect(
      run('upload_object', { ...OBJECT, file: { key: 'workspace/file', name: 'file', size: 0 } })
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('rejects declared and actual oversized files without allocating huge test buffers', async () => {
    mocks.processSingleFileToUserFile.mockReturnValueOnce({
      key: 'file',
      name: 'file',
      size: MAX_BUFFERED_TRANSFER_BYTES + 1,
    })
    const input = { ...OBJECT, file: { key: 'file', name: 'file', size: 0 } }
    await expect(run('upload_object', input)).rejects.toThrow()
    expect(mocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
    mocks.downloadServableFileFromStorage.mockResolvedValueOnce({
      buffer: { length: MAX_BUFFERED_TRANSFER_BYTES + 1 },
      contentType: 'text/plain',
    })
    await expect(run('upload_object', input)).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each(['', '空😀'])(
    'uploads exact UTF-8 content %j without a special signing path',
    async (content) => {
      const result = await run('upload_object', {
        ...OBJECT,
        content,
        ifNoneMatch: '*',
        metadata: { owner: 'team' },
      })
      expect(Buffer.from(mocks.request.mock.calls[0][0].body)).toEqual(Buffer.from(content, 'utf8'))
      expect(mocks.request.mock.calls[0][0]).toMatchObject({
        contentType: 'text/plain; charset=utf-8',
        headers: { 'if-none-match': '*', 'opc-meta-owner': 'team' },
      })
      expect(result.output.size).toBe(Buffer.byteLength(content, 'utf8'))
    }
  )

  it('downloads binary data through the bounded foundation response and returns a canonical file', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'opc-meta-owner': 'team' },
      body: new Uint8Array([0, 255, 128]),
    })
    const result = await run('download_object', OBJECT)
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      maxResponseBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(result.output.file).toMatchObject({
      id: 'file-1',
      key: 'workspace/trusted-workspace/file-1',
      size: 3,
    })
    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      { workspaceId: 'trusted-workspace', workflowId: 'workflow-1', executionId: 'execution-1' },
      Buffer.from([0, 255, 128]),
      'report.txt',
      'application/octet-stream',
      'user-1'
    )
    expect(result.output.file).not.toHaveProperty('data')
    expect(mocks.downloadServableFileFromStorage).not.toHaveBeenCalled()
  })

  it('persists empty downloads and uses the existing Copilot fallback without inline data', async () => {
    mocks.request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: new Uint8Array(),
    })
    const result = await executeOciNativeOperation(
      ociNativeInputSchema.parse({ operation: 'download_object', ...OBJECT }),
      { workspaceId: 'trusted-workspace', userId: 'user-1', requestId: 'request-1' }
    )
    expect(mocks.uploadCopilotFile).toHaveBeenCalledWith({
      buffer: Buffer.alloc(0),
      fileName: 'report.txt',
      contentType: 'text/plain',
      userId: 'user-1',
    })
    expect(result.output).toMatchObject({ contentLength: 0, file: { id: 'copilot-file' } })
    expect(mocks.uploadExecutionFile).not.toHaveBeenCalled()
  })

  it('admits structured JSON by exact escaped UTF-8 bytes before materialization', () => {
    const value = { tags: { 空: '😀\n"\\' }, items: [true, null, 42] }
    const bytes = Buffer.byteLength(JSON.stringify(value))
    expect(isOciNativeJsonWithinLimit(value, bytes)).toBe(true)
    expect(isOciNativeJsonWithinLimit(value, bytes - 1)).toBe(false)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => isOciNativeJsonWithinLimit(cyclic, 1_000)).toThrow()
    expect(
      ociNativeInputSchema.safeParse({
        operation: 'create_bucket',
        ...BUCKET,
        compartmentId: 'compartment',
        definedTags: { group: cyclic },
      }).success
    ).toBe(false)
  })

  it.each([
    { operation: 'upload_object', ...OBJECT },
    {
      operation: 'upload_object',
      ...OBJECT,
      content: '',
      file: { key: 'file', name: 'file', size: 0 },
    },
    {
      operation: 'upload_object',
      ...OBJECT,
      file: { url: 'https://untrusted.example/file', name: 'file', size: 0 },
    },
    { operation: 'upload_object', ...OBJECT, content: '', metadata: { key: '空'.repeat(1_334) } },
    { operation: 'list_objects', ...BUCKET, limit: 1_001 },
    {
      operation: 'batch_delete_objects',
      ...BUCKET,
      objects: [{ objectName: 'a', versionId: 'not-supported' }],
    },
    { operation: 'upload_part', ...OBJECT, uploadId: 'id', partNumber: 10_001, content: '' },
    {
      operation: 'commit_multipart_upload',
      ...OBJECT,
      uploadId: 'id',
      partsToCommit: [
        { partNum: 1, etag: 'a' },
        { partNum: 1, etag: 'b' },
      ],
    },
    {
      operation: 'commit_multipart_upload',
      ...OBJECT,
      uploadId: 'id',
      partsToCommit: [{ partNum: 1, etag: 'a' }],
      partsToExclude: [1],
    },
    {
      operation: 'put_lifecycle_policy',
      ...BUCKET,
      rules: [
        {
          name: 'abort',
          action: 'ABORT',
          target: 'objects',
          timeAmount: 1,
          timeUnit: 'DAYS',
          isEnabled: true,
        },
      ],
    },
    {
      operation: 'create_preauthenticated_request',
      ...BUCKET,
      name: 'grant',
      scope: 'bucket',
      accessType: 'ObjectRead',
      timeExpires: '2099-01-01T00:00:00Z',
    },
    {
      operation: 'create_preauthenticated_request',
      ...OBJECT,
      name: 'grant',
      scope: 'object',
      accessType: 'ObjectRead',
      timeExpires: '2000-01-01T00:00:00Z',
    },
    { operation: 'head_object', ...OBJECT, objectName: '..' },
  ])('rejects unsupported or unsafe operation input %#', (input) => {
    expect(ociNativeInputSchema.safeParse(input).success).toBe(false)
  })
})
