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

import { executeKnowledgeTool } from '@/lib/internal/knowledge/execute-tool'
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

  it('preserves the internal auth error when delegation no longer binds', async () => {
    mocks.createExecutorPrincipalFromExecutionContext.mockRejectedValue(
      new InvalidInternalDelegationBindingError()
    )

    const response = await executeKnowledgeTool(createRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' })
    expect(mocks.listTagsOperation).not.toHaveBeenCalled()
  })
})
