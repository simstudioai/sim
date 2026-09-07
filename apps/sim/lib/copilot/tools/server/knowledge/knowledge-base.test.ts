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
  mockIsKnowledgeMemberAccessAvailable,
  knowledgeOperations,
} = vi.hoisted(() => {
  const defineOperation = (id: string, minimumRole: 'read' | 'write') =>
    Object.freeze({
      id,
      minimumRole,
      workspaceApiKey: 'deny' as const,
      principalKinds: ['session', 'personal_api_key', 'delegated'] as const,
      delegatedServices: ['copilot'] as const,
    })

  return {
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
    mockIsKnowledgeMemberAccessAvailable: vi.fn(),
    knowledgeOperations: {
      addWorkspaceFiles: defineOperation('knowledge.documents.add_workspace_files', 'write'),
      bulkDelete: defineOperation('knowledge.bulk_delete', 'write'),
      bulkDeleteDocuments: defineOperation('knowledge.documents.bulk_delete', 'write'),
      create: defineOperation('knowledge.create', 'write'),
      createConnector: defineOperation('knowledge.connectors.create', 'write'),
      createTag: defineOperation('knowledge.tags.create', 'write'),
      deleteConnector: defineOperation('knowledge.connectors.delete', 'write'),
      deleteTag: defineOperation('knowledge.tags.delete', 'write'),
      listTags: defineOperation('knowledge.tags.list', 'read'),
      read: defineOperation('knowledge.read', 'read'),
      readTagUsage: defineOperation('knowledge.tags.read_usage', 'read'),
      search: defineOperation('knowledge.search', 'read'),
      syncConnector: defineOperation('knowledge.connectors.sync', 'write'),
      update: defineOperation('knowledge.update', 'write'),
      updateConnector: defineOperation('knowledge.connectors.update', 'write'),
      updateDocument: defineOperation('knowledge.documents.update', 'write'),
      updateTag: defineOperation('knowledge.tags.update', 'write'),
    },
  }
})

vi.mock('@/lib/copilot/chat/organization-chats', () => ({
  authorizeOrganizationChatDelegation: { execute: vi.fn() },
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  ManageKnowledgeBase: { id: 'manage_knowledge_base' },
}))
const { mockGetEffectiveDecryptedEnv } = vi.hoisted(() => ({
  mockGetEffectiveDecryptedEnv: vi.fn(),
}))
vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: mockGetEffectiveDecryptedEnv,
}))
vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    knowledgeBaseCreated: mockKnowledgeBaseCreated,
    knowledgeBaseDeleted: mockKnowledgeBaseDeleted,
    knowledgeBaseDocumentsUploaded: mockKnowledgeBaseDocumentsUploaded,
  },
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))
vi.mock('@/lib/knowledge/application/operations', () => ({ knowledgeOperations }))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: mockIsKnowledgeMemberAccessAvailable,
}))
vi.mock('@/lib/knowledge/application/add-workspace-files', () => ({
  addWorkspaceFilesToKnowledgeBase: {
    operation: knowledgeOperations.addWorkspaceFiles,
    execute: mockAddWorkspaceFiles,
  },
}))
vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  bulkDeleteKnowledgeBases: {
    operation: knowledgeOperations.bulkDelete,
    execute: mockBulkDeleteKnowledgeBases,
  },
  createKnowledgeBase: {
    operation: knowledgeOperations.create,
    execute: mockCreateKnowledgeBase,
  },
  readKnowledgeBase: { operation: knowledgeOperations.read, execute: mockReadKnowledgeBase },
  updateKnowledgeBaseOperation: {
    operation: knowledgeOperations.update,
    execute: mockUpdateKnowledgeBase,
  },
}))
vi.mock('@/lib/knowledge/application/documents', () => ({
  bulkDeleteKnowledgeDocuments: {
    operation: knowledgeOperations.bulkDeleteDocuments,
    execute: mockBulkDeleteKnowledgeDocuments,
  },
  updateKnowledgeDocument: {
    operation: knowledgeOperations.updateDocument,
    execute: mockUpdateKnowledgeDocument,
  },
}))
vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { operation: knowledgeOperations.search, execute: mockSearchKnowledge },
}))
vi.mock('@/lib/knowledge/application/connectors', () => ({
  createKnowledgeConnector: {
    operation: knowledgeOperations.createConnector,
    execute: mockCreateKnowledgeConnector,
  },
  updateKnowledgeConnector: {
    operation: knowledgeOperations.updateConnector,
    execute: mockUpdateKnowledgeConnector,
  },
  deleteKnowledgeConnector: {
    operation: knowledgeOperations.deleteConnector,
    execute: mockDeleteKnowledgeConnector,
  },
  syncKnowledgeConnector: {
    operation: knowledgeOperations.syncConnector,
    execute: mockSyncKnowledgeConnector,
  },
}))
vi.mock('@/lib/knowledge/application/tags', () => ({
  createKnowledgeTag: {
    operation: knowledgeOperations.createTag,
    execute: mockCreateKnowledgeTag,
  },
  deleteKnowledgeTag: {
    operation: knowledgeOperations.deleteTag,
    execute: mockDeleteKnowledgeTag,
  },
  listKnowledgeTags: {
    operation: knowledgeOperations.listTags,
    execute: mockListKnowledgeTags,
  },
  readKnowledgeTagUsage: {
    operation: knowledgeOperations.readTagUsage,
    execute: mockReadKnowledgeTagUsage,
  },
  updateKnowledgeTag: {
    operation: knowledgeOperations.updateTag,
    execute: mockUpdateKnowledgeTag,
  },
}))

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

const BILLED_CONTEXT = {
  ...CONTEXT,
  billingAttribution: {
    actorUserId: 'external-admin',
    workspaceId: 'workspace-paid',
    billedAccountUserId: 'workspace-owner',
    organizationId: null,
    billingEntity: { type: 'user' as const, id: 'workspace-owner' },
    billingPeriod: {
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-09-01T00:00:00.000Z',
    },
    payerSubscription: null,
  },
} satisfies ServerToolContext

function expectDelegatedPrincipal(call: unknown): void {
  expect(call).toMatchObject({
    principal: {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'external-admin',
      workspaceId: 'workspace-paid',
      delegationId: 'tool-call-1',
      audience: 'sim:knowledge',
      resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
    },
  })
}

describe('manage_knowledge_base trusted application delegation', () => {
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
    mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(true)
    mockSearchKnowledge.mockResolvedValue({
      results: [],
      query: 'query',
      knowledgeBaseIds: [KNOWLEDGE_BASE.id],
      knowledgeBases: [{ id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name }],
      topK: 5,
      totalResults: 0,
    })
    mockCreateKnowledgeConnector.mockResolvedValue({
      connector: {
        id: 'connector-1',
        knowledgeBaseId: KNOWLEDGE_BASE.id,
        connectorType: 'notion',
        status: 'active',
        syncIntervalMinutes: 1440,
      },
      workspaceId: 'workspace-paid',
    })
    mockDeleteKnowledgeConnector.mockResolvedValue({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      workspaceId: 'workspace-paid',
      connectorId: 'connector-1',
      connectorType: 'notion',
      documentsDeleted: 0,
      documentsKept: 2,
    })
    mockSyncKnowledgeConnector.mockResolvedValue({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      workspaceId: 'workspace-paid',
      connectorId: 'connector-1',
      connectorType: 'notion',
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
    const controller = new AbortController()
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
      { ...CONTEXT, resolvedSecretTraceRegistry: registry, abortSignal: controller.signal }
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
      surface: 'copilot',
      resultSecretRegistry: registry,
      signal: controller.signal,
    })
    expect(mockReadKnowledgeBase).not.toHaveBeenCalled()
  })

  it('asks for citations where per-member access is on', async () => {
    const result = await knowledgeBaseServerTool.execute(
      { operation: 'query', args: { knowledgeBaseId: KNOWLEDGE_BASE.id, query: 'query' } },
      { ...CONTEXT, resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry() }
    )

    expect(result.message).toContain('<source>')
    expect(mockIsKnowledgeMemberAccessAvailable).toHaveBeenCalledWith({
      workspaceId: 'workspace-paid',
    })
  })

  it('asks for no citation where the workspace cannot render one', async () => {
    mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(false)

    const result = await knowledgeBaseServerTool.execute(
      { operation: 'query', args: { knowledgeBaseId: KNOWLEDGE_BASE.id, query: 'query' } },
      { ...CONTEXT, resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry() }
    )

    expect(result).toMatchObject({ success: true })
    expect(result.message).toBe('Found 0 result(s) for query "query".')
  })

  it('answers without citations when the eligibility lookup fails, rather than failing the query', async () => {
    mockIsKnowledgeMemberAccessAvailable.mockRejectedValueOnce(new Error('billing unavailable'))

    const result = await knowledgeBaseServerTool.execute(
      { operation: 'query', args: { knowledgeBaseId: KNOWLEDGE_BASE.id, query: 'query' } },
      { ...CONTEXT, resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry() }
    )

    expect(result).toMatchObject({ success: true })
    expect(result.message).toBe('Found 0 result(s) for query "query".')
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
      deletedDocuments: [
        {
          id: 'document-1',
          filename: 'guide.pdf',
          fileSize: 42,
          mimeType: 'application/pdf',
        },
      ],
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
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'external-admin',
      'knowledge_base_document_deleted',
      expect.objectContaining({ knowledge_base_id: KNOWLEDGE_BASE.id }),
      expect.any(Object)
    )
  })

  it.each([
    [
      'add_connector',
      {
        knowledgeBaseId: KNOWLEDGE_BASE.id,
        connectorType: 'notion',
        credentialId: 'credential-1',
      },
      'knowledge_base_connector_added',
    ],
    ['delete_connector', { connectorId: 'connector-1' }, 'knowledge_base_connector_removed'],
    ['sync_connector', { connectorId: 'connector-1' }, 'knowledge_base_connector_synced'],
  ])(
    'records %s product analytics only after application success',
    async (operation, args, event) => {
      const result = await knowledgeBaseServerTool.execute({ operation, args }, BILLED_CONTEXT)

      expect(result.success).toBe(true)
      expect(mockCaptureServerEvent).toHaveBeenCalledWith(
        'external-admin',
        event,
        expect.objectContaining({ workspace_id: 'workspace-paid' }),
        expect.any(Object)
      )
    }
  )

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

  it('delegates per-document typed tag values by tag definition ID', async () => {
    mockUpdateKnowledgeDocument.mockResolvedValueOnce({
      document: {},
      updatedFields: ['tag1', 'number1'],
    })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'update_document',
        args: {
          knowledgeBaseId: KNOWLEDGE_BASE.id,
          documentId: 'document-1',
          tagValues: [
            { tagDefinitionId: 'category-tag', value: 'support' },
            { tagDefinitionId: 'priority-tag', value: 2 },
          ],
        },
      },
      CONTEXT
    )

    expect(result).toMatchObject({
      success: true,
      data: {
        documentId: 'document-1',
        tagDefinitionIds: ['category-tag', 'priority-tag'],
      },
    })
    const call = mockUpdateKnowledgeDocument.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toEqual({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      documentId: 'document-1',
      assertedWorkspaceId: 'workspace-paid',
      tagValues: [
        { tagDefinitionId: 'category-tag', value: 'support' },
        { tagDefinitionId: 'priority-tag', value: 2 },
      ],
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

  it('passes trusted billing attribution for a source-change sync', async () => {
    mockUpdateKnowledgeConnector.mockResolvedValueOnce({
      connector: {
        id: 'connector-1',
        knowledgeBaseId: KNOWLEDGE_BASE.id,
        connectorType: 'notion',
        sourceConfig: { pageIds: ['page-2'] },
        status: 'active',
      },
    })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'update_connector',
        args: { connectorId: 'connector-1', sourceConfig: { pageIds: ['page-2'] } },
      },
      BILLED_CONTEXT
    )

    expect(result).toMatchObject({
      success: true,
      message: 'Connector updated successfully. Synchronization was queued for the source change.',
    })
    const call = mockUpdateKnowledgeConnector.mock.calls[0]?.[0] as {
      input?: { resolveBillingAttribution?: (workspaceId: string) => Promise<unknown> }
    }
    expectDelegatedPrincipal(call)
    if (!call.input?.resolveBillingAttribution) {
      throw new Error('Copilot connector update did not provide billing attribution')
    }
    await expect(call.input.resolveBillingAttribution('workspace-paid')).resolves.toEqual(
      BILLED_CONTEXT.billingAttribution
    )
  })

  it.each([
    [
      'update_document',
      {
        knowledgeBaseId: KNOWLEDGE_BASE.id,
        documentId: 'document-1',
        filename: 'renamed.pdf',
      },
      mockUpdateKnowledgeDocument,
    ],
    [
      'update_tag',
      {
        knowledgeBaseId: KNOWLEDGE_BASE.id,
        tagDefinitionId: 'tag-1',
        displayName: 'Renamed',
      },
      mockUpdateKnowledgeTag,
    ],
  ])('does not expose %s infrastructure details to the model', async (operation, args, useCase) => {
    useCase.mockRejectedValueOnce(new Error('database password=private'))

    const result = await knowledgeBaseServerTool.execute({ operation, args }, CONTEXT)

    expect(result.success).toBe(false)
    expect(result.message).not.toContain('database')
    expect(result.message).not.toContain('private')
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

  it('preserves credential access guidance for connector creation', async () => {
    mockCreateKnowledgeConnector.mockRejectedValueOnce(
      new OrchestrationError(
        'validation',
        'Credential is not available to you in this workspace. Ask a credential administrator to grant access or select another credential.'
      )
    )

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'add_connector',
        args: {
          knowledgeBaseId: KNOWLEDGE_BASE.id,
          connectorType: 'notion',
          credentialId: 'credential-1',
        },
      },
      CONTEXT
    )

    expect(result).toEqual({
      success: false,
      message:
        'Credential is not available to you in this workspace. Ask a credential administrator to grant access or select another credential.',
    })
  })

  it.each(['{{SIM_GITHUB_PAT}}', '$SIM_GITHUB_PAT', 'SIM_GITHUB_PAT'])(
    'resolves the %s environment reference into the connector API key',
    async (ref) => {
      mockGetEffectiveDecryptedEnv.mockResolvedValue({ SIM_GITHUB_PAT: 'ghp_realtoken' })

      const result = await knowledgeBaseServerTool.execute(
        {
          operation: 'add_connector',
          args: { knowledgeBaseId: KNOWLEDGE_BASE.id, connectorType: 'github', apiKey: ref },
        },
        BILLED_CONTEXT
      )

      expect(result.success).toBe(true)
      const call = mockCreateKnowledgeConnector.mock.calls.at(-1)?.[0] as {
        input: { apiKey?: string }
      }
      expect(call.input.apiKey).toBe('ghp_realtoken')
    }
  )

  it('names the missing variable instead of sending a placeholder upstream', async () => {
    mockGetEffectiveDecryptedEnv.mockResolvedValue({})

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'add_connector',
        args: {
          knowledgeBaseId: KNOWLEDGE_BASE.id,
          connectorType: 'github',
          apiKey: '{{SIM_GITHUB_PAT}}',
        },
      },
      BILLED_CONTEXT
    )

    expect(result.success).toBe(false)
    expect(result.message).toContain('SIM_GITHUB_PAT')
    expect(result.message).toContain('not set')
    expect(mockCreateKnowledgeConnector).not.toHaveBeenCalled()
  })

  it('passes a raw API key through untouched', async () => {
    mockGetEffectiveDecryptedEnv.mockResolvedValue({ SIM_GITHUB_PAT: 'ghp_realtoken' })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'add_connector',
        args: {
          knowledgeBaseId: KNOWLEDGE_BASE.id,
          connectorType: 'github',
          apiKey: 'ghp_literal_key',
        },
      },
      BILLED_CONTEXT
    )

    expect(result.success).toBe(true)
    const call = mockCreateKnowledgeConnector.mock.calls.at(-1)?.[0] as {
      input: { apiKey?: string }
    }
    expect(call.input.apiKey).toBe('ghp_literal_key')
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

describe('manage_knowledge_base add_file delegation', () => {
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
    expect(mockKnowledgeBaseDocumentsUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBaseId: KNOWLEDGE_BASE.id, documentsCount: 1 })
    )
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'external-admin',
      'knowledge_base_document_uploaded',
      expect.objectContaining({ knowledge_base_id: KNOWLEDGE_BASE.id }),
      expect.any(Object)
    )
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
