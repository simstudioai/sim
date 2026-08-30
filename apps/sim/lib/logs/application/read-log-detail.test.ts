/**
 * @vitest-environment node
 */

import type { Principal } from '@sim/auth/principal'
import { workflowExecutionLogs } from '@sim/db/schema'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readLogDetail: vi.fn(),
  resolveWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
}))

const resolveGroupConfigMock = permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

vi.mock('@/lib/logs/fetch-log-detail', () => ({
  readLogDetail: mocks.readLogDetail,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.resolveWorkspace,
}))

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (held: string | null, required: string) =>
    held === 'admin' || held === required || (held === 'write' && required === 'read'),
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { readLogDetailUseCase } from '@/lib/logs/application/read-log-detail'

const WORKSPACE_ID = 'workspace-1'
const EXECUTION_ID = 'execution-1'

/**
 * What a scheduled run actually holds: a delegation whose workflow principal is the
 * actorless `system:schedule`, so `subjectUserId` is absent. Its workspace reach comes
 * from running a deployment, which is the branch `workspace-authorization.ts` admits
 * without a subject — so this exercises the real authorization path, not a stub.
 */
const SCHEDULED_PRINCIPAL: Principal = {
  kind: 'delegated',
  serviceId: 'executor',
  workspaceId: WORKSPACE_ID,
  delegationId: 'delegation-1',
  audience: 'sim:logs',
  issuedAt: new Date(Date.now() - 1_000),
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
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
  },
}

const HUMAN_PRINCIPAL: Principal = {
  ...SCHEDULED_PRINCIPAL,
  subjectUserId: 'user-1',
  delegationContext: {
    kind: 'workflow_execution',
    workflowId: 'workflow-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment',
      deploymentVersionId: 'version-1',
    },
  },
}

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
    resolveGroupConfigMock.mockResolvedValue(null)
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

  /**
   * A projection, not a refusal: the loader is still asked for the log, just
   * told to leave the spend out of it.
   */
  it('tells the loader to withhold spend when the group does', async () => {
    queueLogRow()
    resolveGroupConfigMock.mockResolvedValue({ hideCostInfo: true })

    await readLogDetailUseCase.execute({
      principal: HUMAN_PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, lookupColumn: 'executionId', lookupValue: EXECUTION_ID },
    })

    expect(mocks.readLogDetail).toHaveBeenCalledWith(
      expect.objectContaining({ hideCostInfo: true })
    )
  })

  it('leaves spend in place when no group withholds it', async () => {
    queueLogRow()

    await readLogDetailUseCase.execute({
      principal: HUMAN_PRINCIPAL,
      input: { workspaceId: WORKSPACE_ID, lookupColumn: 'executionId', lookupValue: EXECUTION_ID },
    })

    expect(mocks.readLogDetail).toHaveBeenCalledWith(
      expect.objectContaining({ hideCostInfo: false })
    )
  })
})
