/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'

const mocks = vi.hoisted(() => ({
  createExecutorPrincipalFromExecutionContext: vi.fn(),
  createChunkOperation: vi.fn(),
  createDocumentsOperation: vi.fn(),
  deleteChunkOperation: vi.fn(),
  deleteDocumentOperation: vi.fn(),
  listChunksOperation: vi.fn(),
  listConnectorsOperation: vi.fn(),
  listDocumentsOperation: vi.fn(),
  listTagsOperation: vi.fn(),
  readConnectorOperation: vi.fn(),
  readDocumentOperation: vi.fn(),
  searchOperation: vi.fn(),
  syncConnectorOperation: vi.fn(),
  updateChunkOperation: vi.fn(),
  upsertDocumentOperation: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createExecutorPrincipalFromExecutionContext,
}))

vi.mock('@/lib/internal/knowledge/operations', () => ({
  createChunkOperation: mocks.createChunkOperation,
  createDocumentsOperation: mocks.createDocumentsOperation,
  deleteChunkOperation: mocks.deleteChunkOperation,
  deleteDocumentOperation: mocks.deleteDocumentOperation,
  listChunksOperation: mocks.listChunksOperation,
  listConnectorsOperation: mocks.listConnectorsOperation,
  listDocumentsOperation: mocks.listDocumentsOperation,
  listTagsOperation: mocks.listTagsOperation,
  readConnectorOperation: mocks.readConnectorOperation,
  readDocumentOperation: mocks.readDocumentOperation,
  searchOperation: mocks.searchOperation,
  syncConnectorOperation: mocks.syncConnectorOperation,
  updateChunkOperation: mocks.updateChunkOperation,
  upsertDocumentOperation: mocks.upsertDocumentOperation,
}))

import { executeKnowledgeTool, KNOWLEDGE_TOOL_IDS } from '@/lib/internal/knowledge/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const principal = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  subjectUserId: 'trusted-user',
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'sim:knowledge',
  issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-01T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution' as const, workflowId: 'workflow-1' },
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'knowledge_list_tags',
    input: { knowledgeBaseId: 'kb-1' },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'trusted-user',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeKnowledgeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createExecutorPrincipalFromExecutionContext.mockResolvedValue(principal)
    mocks.listTagsOperation.mockResolvedValue({
      body: {
        success: true,
        data: [
          {
            id: 'tag-1',
            tagSlot: 'tag1',
            displayName: 'Team',
            fieldType: 'text',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    })
  })

  it('validates operation input and calls the direct operation with trusted scope', async () => {
    const controller = new AbortController()
    const request = createRequest({ signal: controller.signal })

    const response = await executeKnowledgeTool(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true })
    expect(mocks.createExecutorPrincipalFromExecutionContext).toHaveBeenCalledWith({
      context: request.context,
      audience: 'sim:knowledge',
    })
    expect(mocks.listTagsOperation).toHaveBeenCalledWith(
      'kb-1',
      expect.objectContaining({
        principal,
        headers: request.headers,
        executionActorUserId: 'trusted-user',
        signal: controller.signal,
      })
    )
  })

  it('rejects malformed operation input before application work', async () => {
    const response = await executeKnowledgeTool(createRequest({ input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Validation error',
      details: expect.any(Array),
    })
    expect(mocks.listTagsOperation).not.toHaveBeenCalled()
  })

  it('returns canonical validation errors for invalid query input', async () => {
    const response = await executeKnowledgeTool(
      createRequest({
        toolId: 'knowledge_list_documents',
        input: { knowledgeBaseId: 'kb-1', limit: '101' },
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Validation error',
      details: expect.any(Array),
    })
    expect(mocks.listDocumentsOperation).not.toHaveBeenCalled()
  })

  it('propagates cancellation before principal construction', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeKnowledgeTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.createExecutorPrincipalFromExecutionContext).not.toHaveBeenCalled()
  })

  it('preserves the internal auth error when delegation no longer binds', async () => {
    mocks.createExecutorPrincipalFromExecutionContext.mockRejectedValue(
      new InvalidInternalDelegationBindingError()
    )

    const response = await executeKnowledgeTool(createRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' })
    expect(mocks.listTagsOperation).not.toHaveBeenCalled()
  })

  it('declares the complete canonical tool ID set', () => {
    expect(KNOWLEDGE_TOOL_IDS).toHaveLength(14)
    expect(new Set(KNOWLEDGE_TOOL_IDS).size).toBe(KNOWLEDGE_TOOL_IDS.length)
  })

  it('returns a deterministic error for unsupported Knowledge tools', async () => {
    const response = await executeKnowledgeTool(createRequest({ toolId: 'knowledge_unknown' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported Knowledge tool: knowledge_unknown',
    })
  })
})
