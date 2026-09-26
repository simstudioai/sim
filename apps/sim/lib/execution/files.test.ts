import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedBlock } from '@/serializer/types'

const mocks = vi.hoisted(() => ({
  readWorkspace: vi.fn(),
}))
const { mockGetFileMetadataById, mockGetFileMetadataByKey } = uploadsMetadataMockFns
const { mockGeneratePresignedDownloadUrl } = storageServiceMockFns
const { mockDownloadFileFromUrl } = fileUtilsServerMockFns
const { mockUploadExecutionFile } = uploadsExecutionMockFns
vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/core/network/resource-scope.server', () => ({
  withResourceOutboundScope: (_: unknown, fn: () => unknown) => fn(),
}))

vi.mock(
  '@/lib/workspace-files/application/read-stored-workspace-file-record-by-key',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/lib/workspace-files/application/read-stored-workspace-file-record-by-key')
    >()),
    readStoredWorkspaceFileRecordByKey: { execute: mocks.readWorkspace },
  })
)

import {
  getStoredFileReferenceScope,
  processExecutionFiles,
  processInputFileFields,
} from '@/lib/execution/files'
import { assertUserFileContentAccess } from '@/lib/execution/payloads/materialization.server'
import { StartBlockPath } from '@/lib/workflows/triggers/triggers'
import { buildStartBlockOutput } from '@/executor/utils/start-block'

const scope = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  workflowId: 'workflow',
  executionId: 'run',
}
const existing = {
  id: 'file',
  name: 'stale',
  size: 999,
  type: 'wrong',
  key: 'workspace/11111111-1111-4111-8111-111111111111/report.pdf',
  url: 'https://expired.example.com',
}
const stored = {
  id: 'metadata-id',
  key: existing.key,
  workspaceId: '11111111-1111-4111-8111-111111111111',
  context: 'workspace',
  originalName: 'report.pdf',
  contentType: 'application/pdf',
  sizeBytes: 24,
  deletedAt: null,
}
function trigger(id: string, name: string, type = 'file[]'): SerializedBlock {
  return {
    id,
    metadata: { id: 'start_trigger', name: 'Start' },
    config: { tool: '', params: { inputFormat: [{ name, type }] } },
    inputs: {},
    outputs: {},
    enabled: true,
  }
}

describe('workflow input files', () => {
  beforeEach(() => {
    mockGetFileMetadataById.mockResolvedValue(stored)
    mockGetFileMetadataByKey.mockResolvedValue(stored)
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://fresh.example.com/report.pdf')
    mockUploadExecutionFile.mockResolvedValue({
      id: 'new',
      key: 'execution/11111111-1111-4111-8111-111111111111/workflow/run/new.txt',
      name: 'new.txt',
      type: 'text/plain',
      size: 3,
      url: 'https://fresh.example.com/new.txt',
    })
  })
  it.each(['file[]', 'files'])(
    'normalizes %s on the selected trigger while preserving ordinary inputs',
    async (type) => {
      const input = {
        documents: [existing],
        title: 'Run',
        count: 2,
        enabled: false,
        config: { nested: 1 },
        items: [1, 'two'],
      }
      const result = await processInputFileFields(
        input,
        [trigger('first', 'unused'), trigger('selected', 'documents', type)],
        scope,
        'request',
        'actor',
        'selected',
        undefined,
        'workspace'
      )
      expect(result).toEqual({
        ...input,
        documents: [
          {
            ...existing,
            id: stored.id,
            name: stored.originalName,
            size: stored.sizeBytes,
            type: stored.contentType,
            context: 'workspace',
            url: 'https://fresh.example.com/report.pdf',
          },
        ],
      })
      expect(mockGetFileMetadataByKey).toHaveBeenCalledTimes(1)
      expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    }
  )
  it('preserves mixed batch order and resolves canonical stored identity while uploading only new bytes', async () => {
    const files = await processExecutionFiles(
      [existing, { type: 'file', name: 'new.txt', data: 'data:text/plain;base64,YWJj' }, existing],
      scope,
      'request',
      'actor',
      'workspace'
    )
    expect(files.map((file) => file.id)).toEqual([stored.id, 'new', stored.id])
    expect(mockUploadExecutionFile).toHaveBeenCalledTimes(1)
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      scope,
      Buffer.from('abc'),
      'new.txt',
      'text/plain',
      'actor'
    )
  })
  it('resolves an ID-only reference against active workspace metadata', async () => {
    const result = await processExecutionFiles(
      { id: 'metadata-id' },
      scope,
      'request',
      'actor',
      'workspace'
    )
    expect(result[0]).toMatchObject({ id: 'metadata-id', name: 'report.pdf', size: 24 })
    expect(mockGetFileMetadataById).toHaveBeenCalledWith('metadata-id')
  })
  it('resolves an existing internal URL when its client identity differs from the metadata ID', async () => {
    const { key, ...file } = existing
    const result = await processExecutionFiles(
      { ...file, url: `/api/files/serve/s3/${encodeURIComponent(key)}?context=workspace` },
      scope,
      'request',
      'actor',
      'workspace'
    )
    expect(mockGetFileMetadataByKey).toHaveBeenCalledWith(key)
    expect(mockGetFileMetadataById).not.toHaveBeenCalled()
    expect(result[0]).toMatchObject({
      id: stored.id,
      key,
      url: 'https://fresh.example.com/report.pdf',
    })
  })
  it('delivers typed values and ordered file arrays through the real Start output builder', async () => {
    const block = trigger('start', 'documents')
    block.config.params.inputFormat = [
      { name: 'documents', type: 'file[]' },
      { name: 'count', type: 'number' },
      { name: 'enabled', type: 'boolean' },
      { name: 'config', type: 'object' },
      { name: 'items', type: 'array' },
    ]
    const workflowInput = await processInputFileFields(
      {
        documents: [
          existing,
          { type: 'file', name: 'new.txt', data: 'data:text/plain;base64,YWJj' },
        ],
        count: '2',
        enabled: 'false',
        config: '{"nested":1}',
        items: '[1,"two"]',
      },
      [block],
      scope,
      'request',
      'actor',
      'start',
      undefined,
      'workspace'
    )
    const output = buildStartBlockOutput({
      resolution: { blockId: block.id, block, path: StartBlockPath.UNIFIED },
      workflowInput,
      workspaceId: scope.workspaceId,
    })
    expect(output).toMatchObject({
      documents: [
        { id: stored.id, url: 'https://fresh.example.com/report.pdf' },
        { id: 'new', url: 'https://fresh.example.com/new.txt' },
      ],
      count: 2,
      enabled: false,
      config: { nested: 1 },
      items: [1, 'two'],
    })
  })
  it('materializes an empty serialized file default as an array downstream', async () => {
    const block = trigger('start', 'documents')
    block.config.params.inputFormat = [{ name: 'documents', type: 'file[]', value: '[]' }]
    const workflowInput = await processInputFileFields(
      {},
      [block],
      scope,
      'request',
      'actor',
      'start',
      undefined,
      'workspace'
    )
    expect(
      buildStartBlockOutput({
        resolution: { blockId: block.id, block, path: StartBlockPath.UNIFIED },
        workflowInput,
        workspaceId: scope.workspaceId,
      }).documents
    ).toEqual([])
  })
  it.each([
    null,
    { ...stored, deletedAt: new Date() },
    { ...stored, workspaceId: 'foreign' },
    { ...stored, key: 'workspace/foreign/file.pdf' },
  ])('rejects missing, deleted, and foreign file bindings before signing', async (record) => {
    mockGetFileMetadataByKey.mockResolvedValue(record)
    await expect(
      processExecutionFiles([existing], scope, 'request', 'actor', 'workspace')
    ).rejects.toThrow('File not found in this workspace')
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })
  it('grants only successfully resolved declared and reserved file inputs, not arbitrary JSON', async () => {
    const granted = vi.fn()
    const result = await processInputFileFields(
      {
        documents: [existing],
        files: [existing],
        config: { nested: { id: 'untrusted', key: 'execution/foreign' } },
      },
      [trigger('start', 'documents')],
      scope,
      'request',
      'actor',
      'start',
      granted,
      'workspace'
    )
    expect(granted).toHaveBeenCalledTimes(2)
    expect(granted.mock.calls.map(([file]) => file.key)).toEqual([stored.key, stored.key])
    expect(result).toMatchObject({ config: { nested: { key: 'execution/foreign' } } })
  })

  it('never grants rejected cross-workspace file input', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ ...stored, workspaceId: 'foreign' })
    const granted = vi.fn()
    await expect(
      processInputFileFields(
        { documents: [existing] },
        [trigger('start', 'documents')],
        scope,
        'request',
        'actor',
        'start',
        granted,
        'workspace'
      )
    ).rejects.toThrow('File not found')
    expect(granted).not.toHaveBeenCalled()
  })

  it('normalizes Mothership attachment storage context for downstream materialization', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({ ...stored, context: 'mothership' })
    const [file] = await processExecutionFiles([existing], scope, 'request', 'actor', 'workspace')
    expect(file).toMatchObject({ id: stored.id, context: 'workspace', key: stored.key })
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(stored.key, 'workspace', 300)
    await assertUserFileContentAccess(file, {
      ...scope,
      principal: { kind: 'session', userId: 'actor' },
    })
    expect(mocks.readWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { key: stored.key, assertedWorkspaceId: scope.workspaceId },
      })
    )
  })

  it('accepts the published MCP base64 form', async () => {
    await processExecutionFiles(
      [{ name: 'new.txt', data: 'YWJj', mimeType: 'text/plain' }],
      scope,
      'request',
      'actor',
      'workspace'
    )
    expect(mockUploadExecutionFile).toHaveBeenCalledWith(
      scope,
      Buffer.from('abc'),
      'new.txt',
      'text/plain',
      'actor'
    )
  })
  it('normalizes nested Start fields and stored defaults using the same workspace checks', async () => {
    const block = trigger('start', 'documents')
    const nested = await processInputFileFields(
      { input: { documents: [existing], query: 'keep' } },
      [block],
      scope,
      'request',
      'actor',
      'start',
      undefined,
      'workspace'
    )
    expect(nested).toMatchObject({
      input: {
        documents: [{ id: stored.id, url: 'https://fresh.example.com/report.pdf' }],
        query: 'keep',
      },
    })
    block.config.params.inputFormat = [
      { name: 'documents', type: 'file[]', value: JSON.stringify([existing]) },
    ]
    const defaults = await processInputFileFields({}, [block], scope, 'request', 'actor', 'start')
    expect(defaults).toMatchObject({
      documents: [{ id: stored.id, url: 'https://fresh.example.com/report.pdf' }],
    })
  })
  it('preserves event payload files that are not declared file inputs', async () => {
    const block = trigger('event', 'other', 'string')
    block.metadata!.id = 'github_webhook'
    const input = { files: ['src/index.ts'] }
    const workflowInput = await processInputFileFields(
      input,
      [block],
      scope,
      'request',
      'actor',
      'event'
    )
    expect(workflowInput).toEqual(input)
    expect(
      buildStartBlockOutput({
        resolution: { blockId: block.id, block, path: StartBlockPath.EXTERNAL_TRIGGER },
        workflowInput,
        workspaceId: scope.workspaceId,
      }).files
    ).toEqual(input.files)
    expect(mockGetFileMetadataByKey).not.toHaveBeenCalled()
  })
  it('normalizes reserved files for chat and Start entrypoints', async () => {
    await processInputFileFields(
      { files: [existing] },
      [trigger('start', 'other')],
      scope,
      'request',
      'actor',
      'start',
      undefined,
      'workspace'
    )
    expect(mockGetFileMetadataByKey).toHaveBeenCalledWith(existing.key)
  })

  describe('stored references from callers outside the workspace', () => {
    const priorRun = {
      ...stored,
      key: 'execution/11111111-1111-4111-8111-111111111111/other-workflow/old-run/secret.txt',
      context: 'execution',
    }
    const references = [
      { key: priorRun.key },
      { id: 'metadata-id' },
      {
        id: 'client-id',
        url: `/api/files/serve/s3/${encodeURIComponent(priorRun.key)}?context=execution`,
      },
    ]

    it.each([
      ['a public API principal', 'execution' as const],
      ['an omitted scope', undefined],
    ])(
      'rejects key, ID, and internal URL references from %s and grants nothing',
      async (_, scopeOption) => {
        for (const record of [priorRun, stored]) {
          mockGetFileMetadataByKey.mockResolvedValue(record)
          mockGetFileMetadataById.mockResolvedValue(record)
          for (const reference of references) {
            const granted = vi.fn()
            await expect(
              processInputFileFields(
                { documents: [reference] },
                [trigger('start', 'documents')],
                scope,
                'request',
                'actor',
                'start',
                granted,
                scopeOption
              )
            ).rejects.toThrow('Stored file references require workspace member access')
            expect(granted).not.toHaveBeenCalled()
          }
        }
        expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
      }
    )

    it('does not reveal whether a rejected reference exists', async () => {
      mockGetFileMetadataByKey.mockResolvedValue(null)
      await expect(
        processExecutionFiles([{ key: priorRun.key }], scope, 'request')
      ).rejects.toThrow('Stored file references require workspace member access')
    })

    it('refuses a key from another execution before looking it up', async () => {
      await expect(
        processExecutionFiles([{ key: priorRun.key }], scope, 'request')
      ).rejects.toThrow('Stored file references require workspace member access')
      expect(mockGetFileMetadataByKey).not.toHaveBeenCalled()
    })

    it('treats an internal file URL upload as a stored reference, not a download', async () => {
      mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('secret'))
      await expect(
        processExecutionFiles(
          [
            {
              type: 'url',
              name: 'secret.txt',
              data: `/api/files/serve/s3/${encodeURIComponent(priorRun.key)}?context=execution`,
            },
          ],
          scope,
          'request',
          'actor'
        )
      ).rejects.toThrow('Stored file references require workspace member access')
      expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
      expect(mockUploadExecutionFile).not.toHaveBeenCalled()
    })

    it('keeps downloading internal file URL uploads for a workspace member', async () => {
      mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('bytes'))
      await processExecutionFiles(
        [
          {
            type: 'url',
            name: 'secret.txt',
            data: `/api/files/serve/s3/${encodeURIComponent(priorRun.key)}?context=execution`,
          },
        ],
        scope,
        'request',
        'actor',
        'workspace'
      )
      expect(mockDownloadFileFromUrl).toHaveBeenCalledTimes(1)
      expect(mockUploadExecutionFile).toHaveBeenCalledTimes(1)
    })

    it('still resolves files this execution stored before handing its input on', async () => {
      const ownKey = `execution/${scope.workspaceId}/${scope.workflowId}/${scope.executionId}/upload.txt`
      mockGetFileMetadataByKey.mockResolvedValue({ ...priorRun, key: ownKey })
      const granted = vi.fn()
      await processInputFileFields(
        { files: [{ id: 'upload', key: ownKey }] },
        [trigger('start', 'other')],
        scope,
        'request',
        'actor',
        'start',
        granted
      )
      expect(granted.mock.calls.map(([file]) => file.key)).toEqual([ownKey])
    })

    it('resolves the same prior-run reference for a workspace member and grants it', async () => {
      mockGetFileMetadataByKey.mockResolvedValue(priorRun)
      const granted = vi.fn()
      await processInputFileFields(
        { documents: [{ key: priorRun.key }] },
        [trigger('start', 'documents')],
        scope,
        'request',
        'actor',
        'start',
        granted,
        'workspace'
      )
      expect(granted.mock.calls.map(([file]) => file.key)).toEqual([priorRun.key])
    })
  })

  describe('getStoredFileReferenceScope', () => {
    const workspaceId = scope.workspaceId
    const workflowId = scope.workflowId
    const delegation = {
      workspaceId,
      delegationId: 'delegation',
      audience: 'workflow-execution',
      issuedAt: new Date(),
      expiresAt: new Date(),
    }
    it.each<WorkflowExecutionPrincipal>([
      { kind: 'session', userId: 'user', sessionId: 'session' },
      { kind: 'personal_api_key', userId: 'user', keyId: 'key' },
      {
        kind: 'oauth_access_token',
        userId: 'user',
        clientId: 'client',
        tokenId: 'token',
        scopes: [],
        expiresAt: new Date(),
      },
      { kind: 'workspace_api_key', workspaceId, keyId: 'key' },
      { kind: 'delegated', serviceId: 'copilot', subjectUserId: 'user', ...delegation },
    ])('lets authorized member principal $kind reference workspace files', (principal) => {
      expect(getStoredFileReferenceScope(principal)).toBe('workspace')
    })
    it.each<WorkflowExecutionPrincipal>([
      { kind: 'system', serviceId: 'public_api', workspaceId, workflowId },
      { kind: 'system', serviceId: 'internal', workspaceId, workflowId },
      { kind: 'system', serviceId: 'schedule', workspaceId, workflowId },
      { kind: 'system', serviceId: 'table', workspaceId, workflowId },
      { kind: 'system', serviceId: 'chat', workspaceId, workflowId },
      {
        kind: 'system',
        serviceId: 'webhook',
        workspaceId,
        workflowId,
        webhookId: 'webhook',
        provider: 'generic',
      },
    ])('limits system principal $serviceId to its own execution files', (principal) => {
      expect(getStoredFileReferenceScope(principal)).toBe('execution')
    })
  })
})
