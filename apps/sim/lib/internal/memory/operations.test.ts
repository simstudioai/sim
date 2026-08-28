/**
 * @vitest-environment node
 */

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  requestsProvenance: vi.fn(),
  readWriteProvenance: vi.fn(),
}))

vi.mock('@/lib/memory/application/use-cases', () => ({
  appendMemoryUseCase: { execute: mocks.append },
  listMemoriesUseCase: { execute: mocks.list },
  readMemoryUseCase: { execute: mocks.read },
  deleteMemoryUseCase: { execute: mocks.remove },
}))

vi.mock('@/lib/internal/memory/provenance', () => ({
  memoryToolRequestsProvenance: mocks.requestsProvenance,
  readMemoryWriteProvenance: mocks.readWriteProvenance,
}))

import {
  executeMemoryAdd,
  executeMemoryDelete,
  executeMemoryGet,
  executeMemoryList,
  type MemoryToolOperationContext,
} from '@/lib/internal/memory/operations'

const PRINCIPAL: WorkflowExecutionDelegatedPrincipal = {
  kind: 'delegated',
  serviceId: 'executor',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-canonical',
  delegationId: 'delegation-1',
  audience: 'sim:memory',
  issuedAt: new Date('2026-08-27T00:00:00.000Z'),
  expiresAt: new Date('2026-08-27T00:05:00.000Z'),
  delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
}

const RECORD = {
  id: 'memory-1',
  key: 'conversation-1',
  data: [{ role: 'user', content: 'hello' }],
  secretProvenanceVersion: null,
}

function context(): MemoryToolOperationContext {
  return { principal: PRINCIPAL, headers: new Headers() }
}

describe('Memory direct operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestsProvenance.mockReturnValue(false)
    mocks.readWriteProvenance.mockReturnValue(undefined)
    mocks.append.mockResolvedValue({ record: RECORD })
    mocks.list.mockResolvedValue({ records: [RECORD] })
    mocks.read.mockResolvedValue({ record: RECORD })
    mocks.remove.mockResolvedValue({ deletedCount: 1 })
  })

  it('binds append authority and provenance to the canonical delegated workspace', async () => {
    const writeProvenance = { status: 'exact', entries: [] }
    mocks.requestsProvenance.mockReturnValue(true)
    mocks.readWriteProvenance.mockReturnValue(writeProvenance)

    await executeMemoryAdd(
      {
        key: 'conversation-1',
        workspaceId: 'workspace-forged',
        data: { role: 'user', content: 'hello' },
      },
      context()
    )

    expect(mocks.append).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        workspaceId: 'workspace-canonical',
        key: 'conversation-1',
        writeProvenance,
        includePersistedSecretProvenance: true,
      }),
    })
  })

  it('preserves list, read, and delete semantics without trusting workspace parameters', async () => {
    await executeMemoryList({ workspaceId: 'workspace-forged', query: null, limit: 50 }, context())
    await executeMemoryGet('conversation-1', context())
    const deleted = await executeMemoryDelete(
      { workspaceId: 'workspace-forged', conversationId: 'conversation-1' },
      context()
    )

    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({ workspaceId: 'workspace-canonical', limit: 50 }),
    })
    expect(mocks.read).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        workspaceId: 'workspace-canonical',
        key: 'conversation-1',
      }),
    })
    expect(mocks.remove).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        workspaceId: 'workspace-canonical',
        key: 'conversation-1',
      }),
    })
    expect(deleted.body).toEqual({
      success: true,
      data: { message: 'Successfully deleted 1 memories', deletedCount: 1 },
    })
  })
})
