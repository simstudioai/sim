/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAddWorkspaceFiles,
  mockBulkDeleteKnowledgeBases,
  mockBulkDeleteKnowledgeDocuments,
  mockCaptureServerEvent,
  mockCreateKnowledgeBase,
  mockDeleteKnowledgeConnector,
  mockDeleteKnowledgeTag,
  mockKnowledgeBaseCreated,
  mockKnowledgeBaseDeleted,
  mockKnowledgeBaseDocumentsUploaded,
  mockReadKnowledgeBase,
  mockReadKnowledgeTagUsage,
  mockSearchKnowledge,
  mockSyncKnowledgeConnector,
  mockUpdateKnowledgeBase,
  mockUpdateKnowledgeConnector,
  mockUpdateKnowledgeDocument,
  mockUpdateKnowledgeTag,
  mockCreateKnowledgeConnector,
  mockCreateKnowledgeTag,
  mockListKnowledgeTags,
} = vi.hoisted(() => ({
  mockAddWorkspaceFiles: vi.fn(),
  mockBulkDeleteKnowledgeBases: vi.fn(),
  mockBulkDeleteKnowledgeDocuments: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockCreateKnowledgeBase: vi.fn(),
  mockDeleteKnowledgeConnector: vi.fn(),
  mockDeleteKnowledgeTag: vi.fn(),
  mockKnowledgeBaseCreated: vi.fn(),
  mockKnowledgeBaseDeleted: vi.fn(),
  mockKnowledgeBaseDocumentsUploaded: vi.fn(),
  mockReadKnowledgeBase: vi.fn(),
  mockReadKnowledgeTagUsage: vi.fn(),
  mockSearchKnowledge: vi.fn(),
  mockSyncKnowledgeConnector: vi.fn(),
  mockUpdateKnowledgeBase: vi.fn(),
  mockUpdateKnowledgeConnector: vi.fn(),
  mockUpdateKnowledgeDocument: vi.fn(),
  mockUpdateKnowledgeTag: vi.fn(),
  mockCreateKnowledgeConnector: vi.fn(),
  mockCreateKnowledgeTag: vi.fn(),
  mockListKnowledgeTags: vi.fn(),
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  KnowledgeBase: { id: 'knowledge_base' },
}))
vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    knowledgeBaseCreated: mockKnowledgeBaseCreated,
    knowledgeBaseDeleted: mockKnowledgeBaseDeleted,
    knowledgeBaseDocumentsUploaded: mockKnowledgeBaseDocumentsUploaded,
  },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))
vi.mock('@/lib/knowledge/application/add-workspace-files', () => ({
  addWorkspaceFilesToKnowledgeBase: {
    operation: { id: 'knowledge.documents.add_workspace_files' },
    execute: mockAddWorkspaceFiles,
  },
}))
vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  bulkDeleteKnowledgeBases: {
    operation: { id: 'knowledge.bulk_delete' },
    execute: mockBulkDeleteKnowledgeBases,
  },
  createKnowledgeBase: { operation: { id: 'knowledge.create' }, execute: mockCreateKnowledgeBase },
  readKnowledgeBase: { operation: { id: 'knowledge.read' }, execute: mockReadKnowledgeBase },
  updateKnowledgeBaseOperation: {
    operation: { id: 'knowledge.update' },
    execute: mockUpdateKnowledgeBase,
  },
}))
vi.mock('@/lib/knowledge/application/documents', () => ({
  bulkDeleteKnowledgeDocuments: {
    operation: { id: 'knowledge.documents.bulk_delete' },
    execute: mockBulkDeleteKnowledgeDocuments,
  },
  updateKnowledgeDocument: {
    operation: { id: 'knowledge.documents.update' },
    execute: mockUpdateKnowledgeDocument,
  },
}))
vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { operation: { id: 'knowledge.search' }, execute: mockSearchKnowledge },
}))
vi.mock('@/lib/knowledge/application/connectors', () => ({
  createKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.create' },
    execute: mockCreateKnowledgeConnector,
  },
  updateKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.update' },
    execute: mockUpdateKnowledgeConnector,
  },
  deleteKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.delete' },
    execute: mockDeleteKnowledgeConnector,
  },
  syncKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.sync' },
    execute: mockSyncKnowledgeConnector,
  },
}))
vi.mock('@/lib/knowledge/application/tags', () => ({
  createKnowledgeTag: {
    operation: { id: 'knowledge.tags.create' },
    execute: mockCreateKnowledgeTag,
  },
  deleteKnowledgeTag: {
    operation: { id: 'knowledge.tags.delete' },
    execute: mockDeleteKnowledgeTag,
  },
  listKnowledgeTags: {
    operation: { id: 'knowledge.tags.list' },
    execute: mockListKnowledgeTags,
  },
  readKnowledgeTagUsage: {
    operation: { id: 'knowledge.tags.read_usage' },
    execute: mockReadKnowledgeTagUsage,
  },
  updateKnowledgeTag: {
    operation: { id: 'knowledge.tags.update' },
    execute: mockUpdateKnowledgeTag,
  },
}))
vi.mock('@/app/api/auth/oauth/utils', () => ({ getCredential: vi.fn() }))

import type { ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const KNOWLEDGE_BASE = {
  id: 'knowledge-base-1',
  name: 'Private KB',
  description: 'Private documentation',
  workspaceId: 'workspace-paid',
  docCount: 2,
  tokenCount: 42,
  embeddingModel: 'text-embedding-3-small',
  chunkingConfig: { maxSize: 1024, minSize: 100, overlap: 200 },
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
}

const CONTEXT = {
  userId: 'external-admin',
  workspaceId: 'workspace-paid',
  chatId: 'chat-1',
  executionId: 'execution-1',
  toolCallId: 'tool-call-1',
  copilotToolExecution: true,
} satisfies ServerToolContext

function expectDelegatedPrincipal(call: unknown): void {
  expect(call).toMatchObject({
    principal: {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'external-admin',
      workspaceId: 'workspace-paid',
      delegationId: 'copilot-tool:tool-call-1',
      audience: 'sim:knowledge',
      resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
    },
  })
}

describe('knowledge_base trusted application delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadKnowledgeBase.mockResolvedValue({ knowledgeBase: KNOWLEDGE_BASE, folderPath: '/' })
    mockCreateKnowledgeBase.mockResolvedValue({ knowledgeBase: KNOWLEDGE_BASE, folderPath: '/' })
    mockUpdateKnowledgeBase.mockResolvedValue({ knowledgeBase: KNOWLEDGE_BASE, folderPath: '/' })
    mockBulkDeleteKnowledgeBases.mockResolvedValue({
      deleted: [{ id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name }],
      notFound: [],
      failed: [],
    })
    mockBulkDeleteKnowledgeDocuments.mockResolvedValue({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      deleted: ['document-1'],
      failed: [],
      deletedDocuments: [],
    })
    mockAddWorkspaceFiles.mockResolvedValue({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      knowledgeBaseName: KNOWLEDGE_BASE.name,
      added: [
        {
          documentId: 'document-1',
          filename: 'report.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
        },
      ],
      failed: [],
    })
    mockSearchKnowledge.mockResolvedValue({
      results: [],
      query: 'query',
      knowledgeBaseIds: [KNOWLEDGE_BASE.id],
      knowledgeBases: [{ id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name }],
      topK: 5,
      totalResults: 0,
    })
  })

  it.each([
    [{ ...CONTEXT, copilotToolExecution: false }, 'trusted Copilot execution context'],
    [{ ...CONTEXT, workspaceId: undefined }, 'workspace ID'],
    [{ ...CONTEXT, toolCallId: undefined }, 'tool call ID'],
    [{ ...CONTEXT, userId: '' }, 'authenticated user ID'],
  ])('rejects incomplete server-authored context', async (context, message) => {
    await expect(
      knowledgeBaseServerTool.execute(
        { operation: 'get', args: { knowledgeBaseId: KNOWLEDGE_BASE.id } },
        context
      )
    ).rejects.toThrow(message)
    expect(mockReadKnowledgeBase).not.toHaveBeenCalled()
  })

  it('creates in the trusted workspace and ignores a model workspace field', async () => {
    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'create',
        args: { name: 'Private KB', workspaceId: 'model-controlled-workspace' },
      },
      CONTEXT
    )

    expect(result.success).toBe(true)
    const call = mockCreateKnowledgeBase.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toMatchObject({
      workspaceId: 'workspace-paid',
      name: 'Private KB',
      source: 'agent',
    })
    expect(mockKnowledgeBaseCreated).toHaveBeenCalledWith({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      name: KNOWLEDGE_BASE.name,
      workspaceId: 'workspace-paid',
    })
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'external-admin',
      'knowledge_base_created',
      expect.objectContaining({ workspace_id: 'workspace-paid' }),
      expect.any(Object)
    )
  })

  it('reads through the canonical application operation', async () => {
    const result = await knowledgeBaseServerTool.execute(
      { operation: 'get', args: { knowledgeBaseId: KNOWLEDGE_BASE.id } },
      CONTEXT
    )

    expect(result.success).toBe(true)
    const call = mockReadKnowledgeBase.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toEqual({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      assertedWorkspaceId: 'workspace-paid',
    })
  })

  it('projects query secrets before delegating search and passes only the trusted registry', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'KB_QUERY',
        plaintext: 'private query',
        encryptedValue: 'encrypted-query',
      },
    ])
    registry.recordResolved('KB_QUERY', 'private query')
    mockSearchKnowledge.mockResolvedValueOnce({
      results: [
        {
          embeddingId: 'embedding-1',
          documentId: 'document-1',
          documentName: 'doc.pdf',
          sourceUrl: null,
          content: 'result',
          chunkIndex: 0,
          metadata: {},
          similarity: 0.9,
        },
      ],
      query: '{{KB_QUERY}}',
      knowledgeBaseIds: [KNOWLEDGE_BASE.id],
      knowledgeBases: [{ id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name }],
      topK: 5,
      totalResults: 1,
    })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'query',
        args: { knowledgeBaseId: KNOWLEDGE_BASE.id, query: 'private query' },
      },
      { ...CONTEXT, resolvedSecretTraceRegistry: registry }
    )

    expect(result).toMatchObject({
      success: true,
      data: { query: 'private query', results: [{ similarity: 0.9 }] },
    })
    const call = mockSearchKnowledge.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toEqual({
      workspaceId: 'workspace-paid',
      knowledgeBaseIds: [KNOWLEDGE_BASE.id],
      query: '{{KB_QUERY}}',
      topK: 5,
      resultSecretRegistry: registry,
    })
    expect(mockReadKnowledgeBase).not.toHaveBeenCalled()
  })

  it('returns a safe model result for search infrastructure failures', async () => {
    mockSearchKnowledge.mockRejectedValueOnce(new Error('database unavailable'))

    const result = await knowledgeBaseServerTool.execute(
      { operation: 'query', args: { knowledgeBaseId: KNOWLEDGE_BASE.id, query: 'query' } },
      { ...CONTEXT, resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry() }
    )

    expect(result).toEqual({ success: false, message: 'Failed to query knowledge base' })
    expect(result.message).not.toContain('database unavailable')
  })

  it('updates through the semantic operation', async () => {
    const result = await knowledgeBaseServerTool.execute(
      { operation: 'update', args: { knowledgeBaseId: KNOWLEDGE_BASE.id, name: 'Renamed' } },
      CONTEXT
    )

    expect(result.success).toBe(true)
    const call = mockUpdateKnowledgeBase.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toMatchObject({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      assertedWorkspaceId: 'workspace-paid',
      name: 'Renamed',
      source: 'agent',
    })
  })

  it('delegates the unexposed delete compatibility path once to the bulk command', async () => {
    const result = await knowledgeBaseServerTool.execute(
      { operation: 'delete', args: { knowledgeBaseId: KNOWLEDGE_BASE.id } },
      CONTEXT
    )

    expect(result).toMatchObject({
      success: true,
      data: { deleted: [{ id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name }] },
    })
    const call = mockBulkDeleteKnowledgeBases.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toMatchObject({
      assertedWorkspaceId: 'workspace-paid',
      knowledgeBaseIds: [KNOWLEDGE_BASE.id],
      source: 'agent',
    })
  })

  it('keeps classified delete failures in the batch result', async () => {
    mockBulkDeleteKnowledgeBases.mockResolvedValueOnce({
      deleted: [],
      notFound: [],
      failed: [
        { id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name, reason: 'Knowledge base is locked' },
      ],
    })

    const result = await knowledgeBaseServerTool.execute(
      { operation: 'delete', args: { knowledgeBaseId: KNOWLEDGE_BASE.id } },
      CONTEXT
    )

    expect(result).toMatchObject({
      success: false,
      data: {
        notFound: [],
        failed: [
          { id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name, reason: 'Knowledge base is locked' },
        ],
      },
    })
  })

  it('delegates document deletion and retains partial batch results', async () => {
    mockBulkDeleteKnowledgeDocuments.mockResolvedValueOnce({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      deleted: ['document-1'],
      failed: ['missing'],
      deletedDocuments: [],
    })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'delete_document',
        args: { knowledgeBaseId: KNOWLEDGE_BASE.id, documentIds: ['missing', 'document-1'] },
      },
      CONTEXT
    )

    expect(result).toMatchObject({
      success: true,
      data: { deleted: ['document-1'], failed: ['missing'] },
    })
    expectDelegatedPrincipal(mockBulkDeleteKnowledgeDocuments.mock.calls[0][0])
    expect(mockBulkDeleteKnowledgeDocuments).toHaveBeenCalledOnce()
  })

  it('delegates document updates with only the trusted workspace assertion', async () => {
    mockUpdateKnowledgeDocument.mockResolvedValueOnce({ document: {}, updatedFields: ['filename'] })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'update_document',
        args: {
          knowledgeBaseId: KNOWLEDGE_BASE.id,
          documentId: 'document-1',
          filename: 'renamed.pdf',
        },
      },
      CONTEXT
    )

    expect(result).toMatchObject({ success: true, data: { documentId: 'document-1' } })
    const call = mockUpdateKnowledgeDocument.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toEqual({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      documentId: 'document-1',
      assertedWorkspaceId: 'workspace-paid',
      filename: 'renamed.pdf',
      source: 'agent',
    })
  })

  it('does not expose connector infrastructure errors to the model', async () => {
    mockUpdateKnowledgeConnector.mockRejectedValueOnce(new Error('sql host=private-db'))

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'update_connector',
        args: { connectorId: 'connector-1', connectorStatus: 'paused' },
      },
      CONTEXT
    )

    expect(result).toEqual({
      success: false,
      message: 'Failed to update connector',
    })
    expect(result.message).not.toContain('private-db')
  })

  it('preserves caller-actionable connector failure messages', async () => {
    mockUpdateKnowledgeConnector.mockRejectedValueOnce(
      new OrchestrationError('validation', 'At least one connector update is required')
    )

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'update_connector',
        args: { connectorId: 'connector-1', connectorStatus: 'paused' },
      },
      CONTEXT
    )

    expect(result).toEqual({
      success: false,
      message: 'At least one connector update is required',
    })
  })

  it('preserves caller-actionable tag provenance conflicts', async () => {
    mockDeleteKnowledgeTag.mockRejectedValueOnce(
      new OrchestrationError(
        'conflict',
        'Tag definitions cannot be deleted while resolved-secret document provenance is present'
      )
    )

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'delete_tag',
        args: { knowledgeBaseId: KNOWLEDGE_BASE.id, tagDefinitionId: 'tag-1' },
      },
      CONTEXT
    )

    expect(result).toEqual({
      success: false,
      message:
        'Failed to delete_tag knowledge base: Tag definitions cannot be deleted while resolved-secret document provenance is present',
    })
  })

  it.each([
    {
      operation: 'add_file',
      args: { knowledgeBaseId: KNOWLEDGE_BASE.id, filePaths: Array(101).fill('files/doc.pdf') },
    },
    {
      operation: 'delete',
      args: { knowledgeBaseIds: Array.from({ length: 101 }, (_, index) => `kb-${index}`) },
    },
    {
      operation: 'delete_document',
      args: {
        knowledgeBaseId: KNOWLEDGE_BASE.id,
        documentIds: Array.from({ length: 101 }, (_, index) => `document-${index}`),
      },
    },
  ])(
    'rejects oversized $operation batches before application work',
    async ({ operation, args }) => {
      const result = await knowledgeBaseServerTool.execute({ operation, args }, CONTEXT)

      expect(result.success).toBe(false)
      expect(result.message).toContain('Maximum is 100')
      expect(mockReadKnowledgeBase).not.toHaveBeenCalled()
      expect(mockBulkDeleteKnowledgeBases).not.toHaveBeenCalled()
      expect(mockBulkDeleteKnowledgeDocuments).not.toHaveBeenCalled()
      expect(mockAddWorkspaceFiles).not.toHaveBeenCalled()
    }
  )
})

describe('knowledge_base add_file delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAddWorkspaceFiles.mockResolvedValue({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      knowledgeBaseName: KNOWLEDGE_BASE.name,
      added: [
        {
          documentId: 'document-1',
          filename: 'report.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
        },
      ],
      failed: [],
    })
  })

  it('maps aliases and delegates the complete batch once to the application command', async () => {
    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'add_file',
        args: { knowledgeBaseId: KNOWLEDGE_BASE.id, filePaths: ['files/report.pdf'] },
      },
      CONTEXT
    )

    expect(result).toMatchObject({
      success: true,
      data: { added: [{ documentId: 'document-1', filename: 'report.pdf' }] },
    })
    const call = mockAddWorkspaceFiles.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toMatchObject({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      assertedWorkspaceId: 'workspace-paid',
      fileReferences: ['files/report.pdf'],
      source: 'agent',
    })
    expect(mockAddWorkspaceFiles).toHaveBeenCalledOnce()
  })

  it('preserves explicit partial failures returned by the application command', async () => {
    mockAddWorkspaceFiles.mockResolvedValueOnce({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      knowledgeBaseName: KNOWLEDGE_BASE.name,
      added: [],
      failed: ['files/report.pdf'],
    })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'add_file',
        args: { knowledgeBaseId: KNOWLEDGE_BASE.id, filePaths: ['files/report.pdf'] },
      },
      CONTEXT
    )

    expect(result.success).toBe(false)
    expect(result).toMatchObject({ data: { added: [], failed: ['files/report.pdf'] } })
  })

  it('does not expose add-file infrastructure failures to the model', async () => {
    mockAddWorkspaceFiles.mockRejectedValueOnce(new Error('storage host=private-bucket'))

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'add_file',
        args: { knowledgeBaseId: KNOWLEDGE_BASE.id, filePaths: ['files/report.pdf'] },
      },
      CONTEXT
    )

    expect(result).toEqual({ success: false, message: 'Failed to add_file knowledge base' })
    expect(result.message).not.toContain('private-bucket')
  })

  it('rechecks cancellation after application composition before presenting a partial result', async () => {
    const controller = new AbortController()
    mockAddWorkspaceFiles.mockImplementationOnce(async () => {
      controller.abort('user stopped')
      return {
        knowledgeBaseId: KNOWLEDGE_BASE.id,
        knowledgeBaseName: KNOWLEDGE_BASE.name,
        added: [{ documentId: 'document-1', filename: 'report.pdf' }],
        failed: [],
        cancelled: true,
      }
    })

    await expect(
      knowledgeBaseServerTool.execute(
        {
          operation: 'add_file',
          args: { knowledgeBaseId: KNOWLEDGE_BASE.id, filePaths: ['files/report.pdf'] },
        },
        { ...CONTEXT, userStopSignal: controller.signal }
      )
    ).rejects.toThrow('Request aborted before knowledge mutation could be applied')

    expect(mockAddWorkspaceFiles).toHaveBeenCalledOnce()
  })
})
