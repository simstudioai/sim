/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCaptureServerEvent,
  mockCreateKnowledgeBase,
  mockDeleteKnowledgeBase,
  mockDeleteKnowledgeDocument,
  mockGetBoundWorkspaceFileSecretProvenance,
  mockKnowledgeBaseCreated,
  mockKnowledgeBaseDeleted,
  mockKnowledgeBaseDocumentsUploaded,
  mockReadKnowledgeBase,
  mockResolveWorkspaceFileReference,
  mockSearchKnowledge,
  mockUpdateKnowledgeBase,
  mockUploadKnowledgeDocument,
} = vi.hoisted(() => ({
  mockCaptureServerEvent: vi.fn(),
  mockCreateKnowledgeBase: vi.fn(),
  mockDeleteKnowledgeBase: vi.fn(),
  mockDeleteKnowledgeDocument: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenance: vi.fn(),
  mockKnowledgeBaseCreated: vi.fn(),
  mockKnowledgeBaseDeleted: vi.fn(),
  mockKnowledgeBaseDocumentsUploaded: vi.fn(),
  mockReadKnowledgeBase: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockSearchKnowledge: vi.fn(),
  mockUpdateKnowledgeBase: vi.fn(),
  mockUploadKnowledgeDocument: vi.fn(),
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
vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  createKnowledgeBase: { execute: mockCreateKnowledgeBase },
  deleteKnowledgeBaseOperation: { execute: mockDeleteKnowledgeBase },
  readKnowledgeBase: { execute: mockReadKnowledgeBase },
  updateKnowledgeBaseOperation: { execute: mockUpdateKnowledgeBase },
}))
vi.mock('@/lib/knowledge/application/documents', () => ({
  deleteKnowledgeDocument: { execute: mockDeleteKnowledgeDocument },
  uploadKnowledgeDocument: { execute: mockUploadKnowledgeDocument },
}))
vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { execute: mockSearchKnowledge },
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  createSingleDocument: vi.fn(),
}))
vi.mock('@/lib/knowledge/orchestration', () => ({
  performCreateKnowledgeConnector: vi.fn(),
  performDeleteKnowledgeConnector: vi.fn(),
  performSyncKnowledgeConnector: vi.fn(),
  performUpdateKnowledgeConnector: vi.fn(),
  performUpdateKnowledgeDocument: vi.fn(),
}))
vi.mock('@/lib/knowledge/tags/service', () => ({
  createTagDefinition: vi.fn(),
  deleteTagDefinition: vi.fn(),
  getDocumentTagDefinitions: vi.fn(),
  getNextAvailableSlot: vi.fn(),
  getTagDefinitionById: vi.fn(),
  getTagUsageStats: vi.fn(),
  updateTagDefinition: vi.fn(),
}))
vi.mock('@/lib/uploads', () => ({
  StorageService: { generatePresignedDownloadUrl: vi.fn().mockResolvedValue('https://file.test') },
}))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mockResolveWorkspaceFileReference,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenance: mockGetBoundWorkspaceFileSecretProvenance,
}))
vi.mock('@/app/api/auth/oauth/utils', () => ({ getCredential: vi.fn() }))
vi.mock('@/app/api/knowledge/utils', () => ({
  checkDocumentWriteAccess: vi.fn(),
  checkKnowledgeBaseAccess: vi.fn(),
  checkKnowledgeBaseWriteAccess: vi.fn(),
}))

import type { ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import {
  knowledgeBaseServerTool,
  normalizeKnowledgeQueryTopK,
} from '@/lib/copilot/tools/server/knowledge/knowledge-base'
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
      delegationId: 'tool-call-1',
      audience: 'sim:knowledge',
      resourceScope: { chatId: 'chat-1', executionId: 'execution-1' },
    },
  })
}

describe('knowledge query result limit', () => {
  it.each([
    { input: undefined, expected: 5 },
    { input: 0, expected: 5 },
    { input: -1, expected: 5 },
    { input: 1.5, expected: 5 },
    { input: 12, expected: 12 },
    { input: 10_000, expected: 50 },
  ])('normalizes $input to $expected', ({ input, expected }) => {
    expect(normalizeKnowledgeQueryTopK(input)).toBe(expected)
  })
})

describe('knowledge_base trusted application delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadKnowledgeBase.mockResolvedValue({ knowledgeBase: KNOWLEDGE_BASE, folderPath: '/' })
    mockCreateKnowledgeBase.mockResolvedValue({ knowledgeBase: KNOWLEDGE_BASE, folderPath: '/' })
    mockUpdateKnowledgeBase.mockResolvedValue({ knowledgeBase: KNOWLEDGE_BASE, folderPath: '/' })
    mockDeleteKnowledgeBase.mockResolvedValue({ id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name })
    mockSearchKnowledge.mockResolvedValue({
      results: [],
      query: 'query',
      knowledgeBaseIds: [KNOWLEDGE_BASE.id],
      topK: 5,
      totalResults: 0,
    })
    mockDeleteKnowledgeDocument.mockResolvedValue({ id: 'document-1', filename: 'doc.pdf' })
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
  })

  it('propagates search infrastructure failures', async () => {
    mockSearchKnowledge.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(
      knowledgeBaseServerTool.execute(
        { operation: 'query', args: { knowledgeBaseId: KNOWLEDGE_BASE.id, query: 'query' } },
        { ...CONTEXT, resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry() }
      )
    ).rejects.toThrow('database unavailable')
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

  it('keeps the unexposed delete compatibility path on the shared delete operation', async () => {
    const result = await knowledgeBaseServerTool.execute(
      { operation: 'delete', args: { knowledgeBaseId: KNOWLEDGE_BASE.id } },
      CONTEXT
    )

    expect(result).toMatchObject({
      success: true,
      data: { deleted: [{ id: KNOWLEDGE_BASE.id, name: KNOWLEDGE_BASE.name }] },
    })
    const call = mockDeleteKnowledgeBase.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toEqual({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      assertedWorkspaceId: 'workspace-paid',
      source: 'agent',
    })
    expect(mockKnowledgeBaseDeleted).toHaveBeenCalledWith({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
    })
  })

  it('keeps classified delete failures in the batch result', async () => {
    mockDeleteKnowledgeBase.mockRejectedValueOnce(
      new OrchestrationError('conflict', 'Knowledge base is locked')
    )

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
    mockDeleteKnowledgeDocument.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Document not found')
    )

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
    expectDelegatedPrincipal(mockDeleteKnowledgeDocument.mock.calls[1][0])
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'external-admin',
      'knowledge_base_document_deleted',
      expect.objectContaining({ knowledge_base_id: KNOWLEDGE_BASE.id }),
      expect.any(Object)
    )
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
      expect(mockDeleteKnowledgeBase).not.toHaveBeenCalled()
      expect(mockDeleteKnowledgeDocument).not.toHaveBeenCalled()
      expect(mockUploadKnowledgeDocument).not.toHaveBeenCalled()
    }
  )
})

describe('knowledge_base add_file delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadKnowledgeBase.mockResolvedValue({ knowledgeBase: KNOWLEDGE_BASE, folderPath: '/' })
    mockResolveWorkspaceFileReference.mockResolvedValue({
      id: 'file-1',
      key: 'workspace/workspace-paid/report.pdf',
      name: 'report.pdf',
      size: 100,
      type: 'application/pdf',
    })
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValue({ status: 'exact', entries: [] })
    mockUploadKnowledgeDocument.mockResolvedValue({
      created: true,
      document: {
        id: 'document-1',
        filename: 'report.pdf',
        fileSize: 100,
        mimeType: 'application/pdf',
      },
    })
  })

  it('preserves file resolution and performs current admission inside uploadKnowledgeDocument', async () => {
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
    expect(mockResolveWorkspaceFileReference).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-paid', reference: 'files/report.pdf' })
    )
    const call = mockUploadKnowledgeDocument.mock.calls[0][0]
    expectDelegatedPrincipal(call)
    expect(call.input).toMatchObject({
      knowledgeBaseId: KNOWLEDGE_BASE.id,
      assertedWorkspaceId: 'workspace-paid',
      startProcessing: true,
      source: 'agent',
      document: { filename: 'report.pdf', fileSize: 100, mimeType: 'application/pdf' },
    })
    expect(call.input).not.toHaveProperty('usageAdmission')
    expect(mockKnowledgeBaseDocumentsUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBaseId: KNOWLEDGE_BASE.id, documentsCount: 1 })
    )
  })

  it('rejects files carrying resolved-secret provenance before durable registration', async () => {
    mockGetBoundWorkspaceFileSecretProvenance.mockResolvedValueOnce({
      status: 'exact',
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
    })

    const result = await knowledgeBaseServerTool.execute(
      {
        operation: 'add_file',
        args: { knowledgeBaseId: KNOWLEDGE_BASE.id, filePaths: ['files/report.pdf'] },
      },
      CONTEXT
    )

    expect(result.success).toBe(false)
    expect(mockUploadKnowledgeDocument).not.toHaveBeenCalled()
  })
})
