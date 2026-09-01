/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  snapshot: vi.fn(),
}))

vi.mock('@/lib/logs/application/list-logs', () => ({
  listLogsUseCase: { execute: mocks.list },
}))
vi.mock('@/lib/logs/application/read-log-detail', () => ({
  readLogDetailUseCase: { execute: mocks.detail },
}))
vi.mock('@/lib/logs/application/read-execution-snapshot', () => ({
  readExecutionSnapshotUseCase: { execute: mocks.snapshot },
}))

import {
  executeLogsGet,
  executeLogsGetExecution,
  executeLogsGetRunDetails,
  executeLogsList,
  type LogsToolOperationContext,
} from '@/lib/internal/logs/operations'

const PRINCIPAL = createTestRuntimePrincipal()

function context(): LogsToolOperationContext {
  return { principal: PRINCIPAL, workspaceId: 'workspace-canonical', signal: undefined }
}

describe('Logs direct operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue({ data: [], nextCursor: null })
    mocks.detail.mockResolvedValue({ detail: { id: 'log-1' } })
    mocks.snapshot.mockResolvedValue({ executionId: 'execution-1' })
  })

  it('uses the canonical delegated workspace for list and detail reads', async () => {
    await executeLogsList(
      {
        workspaceId: 'workspace-forged',
        limit: 25,
        sortBy: 'date',
        sortOrder: 'desc',
      },
      context()
    )
    await executeLogsGet('log-1', context())
    await executeLogsGetRunDetails('execution-1', context())

    expect(mocks.list).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: expect.objectContaining({
        workspaceId: 'workspace-canonical',
        limit: 25,
        signal: undefined,
      }),
    })
    expect(mocks.detail).toHaveBeenNthCalledWith(1, {
      principal: PRINCIPAL,
      input: expect.objectContaining({
        workspaceId: 'workspace-canonical',
        lookupColumn: 'id',
        lookupValue: 'log-1',
      }),
    })
    expect(mocks.detail).toHaveBeenNthCalledWith(2, {
      principal: PRINCIPAL,
      input: expect.objectContaining({
        workspaceId: 'workspace-canonical',
        lookupColumn: 'executionId',
        lookupValue: 'execution-1',
      }),
    })
  })

  it('resolves execution snapshots through the authorized application operation', async () => {
    await executeLogsGetExecution('execution-1', context())
    expect(mocks.snapshot).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        executionId: 'execution-1',
        assertedWorkspaceId: 'workspace-canonical',
        signal: undefined,
      },
    })
  })
})
