/**
 * @vitest-environment node
 */

import { workflowExecutionLogs } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readLogDetail: vi.fn(),
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/logs/fetch-log-detail', () => ({
  readLogDetail: mocks.readLogDetail,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (held: string | null, required: string) =>
    held === 'admin' || held === required || (held === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import { readLogDetailUseCase } from '@/lib/logs/application/read-log-detail'

const WORKSPACE_ID = 'workspace-1'
const EXECUTION_ID = 'execution-1'

const SCHEDULED_PRINCIPAL = createTestRuntimePrincipal({
  principal: {
    kind: 'system',
    serviceId: 'schedule',
    workspaceId: WORKSPACE_ID,
    workflowId: 'workflow-1',
  },
  currentWorkflow: {
    workflowId: 'workflow-1',
    mode: 'deployment',
    deploymentVersionId: 'version-1',
  },
})

const HUMAN_PRINCIPAL = createTestRuntimePrincipal({
  principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  currentWorkflow: {
    workflowId: 'workflow-1',
    mode: 'deployment',
    deploymentVersionId: 'version-1',
  },
})

function queueLogRow(): void {
  queueTableRows(workflowExecutionLogs, [{ workspaceId: WORKSPACE_ID, executionId: EXECUTION_ID }])
}

describe('readLogDetailUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveWorkspace.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
    })
    mocks.readLogDetail.mockResolvedValue({ id: 'log-1', executionId: EXECUTION_ID })
    mocks.resolvePermission.mockResolvedValue('admin')
  })

  afterAll(resetDbChainMock)

  it('reads a run for an actorless schedule, passing no viewer', async () => {
    queueLogRow()

    const result = await readLogDetailUseCase.execute({
      principal: SCHEDULED_PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, lookupColumn: 'executionId', lookupValue: EXECUTION_ID },
    })

    expect(result.detail).toMatchObject({ id: 'log-1' })
    expect(mocks.readLogDetail).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, viewerUserId: undefined })
    )
  })

  it('still names the human behind a run that has one', async () => {
    queueLogRow()

    await readLogDetailUseCase.execute({
      principal: HUMAN_PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, lookupColumn: 'executionId', lookupValue: EXECUTION_ID },
    })

    expect(mocks.readLogDetail).toHaveBeenCalledWith(
      expect.objectContaining({ viewerUserId: 'user-1' })
    )
  })
})
