/**
 * @vitest-environment node
 */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    deploymentSummary: vi.fn(),
    loadWorkspace: vi.fn(),
    permission: vi.fn(),
    redeployment: vi.fn(),
  },
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.permission,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@/lib/workflows/deployment-status', () => ({
  checkNeedsRedeployment: mocks.redeployment,
}))

vi.mock('@/lib/workflows/orchestration', () => ({
  getWorkflowDeploymentSummary: mocks.deploymentSummary,
}))

import {
  MAX_WORKFLOW_MCP_STATUS_SCHEMA_BYTES,
  MAX_WORKFLOW_MCP_STATUS_TOOLS,
  MAX_WORKFLOW_MCP_STATUS_TOTAL_SCHEMA_BYTES,
  readWorkflowDeploymentOverview,
} from '@/lib/workflows/application/read-workflow-deployment-overview'

const workflowRecord = {
  id: 'workflow-1',
  workspaceId: 'workspace-1',
  name: 'Workflow',
  archivedAt: null,
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot' as const,
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'tool-call-1',
  audience: 'sim:workflows',
  issuedAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2099-01-01T00:00:00Z'),
}

describe('readWorkflowDeploymentOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.deploymentSummary.mockResolvedValue({
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [],
    })
    mocks.redeployment.mockResolvedValue(false)
  })

  it('caps workflow MCP status rows and reports truncation', async () => {
    queueTableRows(schemaMock.workflow, [
      {
        workflowId: workflowRecord.id,
        workflow: workflowRecord,
        workspaceId: workflowRecord.workspaceId,
      },
    ])
    queueTableRows(schemaMock.chat, [])
    queueTableRows(
      schemaMock.workflowMcpTool,
      Array.from({ length: MAX_WORKFLOW_MCP_STATUS_TOOLS + 1 }, (_, index) => ({
        serverId: `server-${index}`,
        serverName: `Server ${index}`,
        toolName: `tool_${index}`,
        toolDescription: null,
        parameterSchema: {},
        parameterSchemaBytes: 2,
        toolId: `tool-${index}`,
      }))
    )

    const result = await readWorkflowDeploymentOverview.execute({
      principal,
      input: { workflowId: workflowRecord.id },
    })

    expect(result.mcpTools).toHaveLength(MAX_WORKFLOW_MCP_STATUS_TOOLS)
    expect(result.mcpToolsTruncated).toBe(true)
  })

  it('truncates schema materialization at individual and aggregate byte budgets', async () => {
    queueTableRows(schemaMock.workflow, [
      {
        workflowId: workflowRecord.id,
        workflow: workflowRecord,
        workspaceId: workflowRecord.workspaceId,
      },
    ])
    queueTableRows(schemaMock.chat, [])
    const aggregateRows = Array.from(
      {
        length: MAX_WORKFLOW_MCP_STATUS_TOTAL_SCHEMA_BYTES / MAX_WORKFLOW_MCP_STATUS_SCHEMA_BYTES,
      },
      (_, index) => ({
        serverId: 'server-1',
        serverName: 'Server 1',
        toolName: `within-budget-${index}`,
        toolDescription: null,
        parameterSchema: { type: 'object' },
        parameterSchemaBytes: MAX_WORKFLOW_MCP_STATUS_SCHEMA_BYTES,
        toolId: `tool-${index + 2}`,
      })
    )
    queueTableRows(schemaMock.workflowMcpTool, [
      {
        serverId: 'server-1',
        serverName: 'Server 1',
        toolName: 'oversized',
        toolDescription: null,
        parameterSchema: null,
        parameterSchemaBytes: MAX_WORKFLOW_MCP_STATUS_SCHEMA_BYTES + 1,
        toolId: 'tool-1',
      },
      ...aggregateRows,
      {
        serverId: 'server-1',
        serverName: 'Server 1',
        toolName: 'past-budget',
        toolDescription: null,
        parameterSchema: { type: 'object' },
        parameterSchemaBytes: 1,
        toolId: 'tool-last',
      },
    ])

    const result = await readWorkflowDeploymentOverview.execute({
      principal,
      input: { workflowId: workflowRecord.id },
    })

    expect(result.mcpTools).toHaveLength(1 + aggregateRows.length)
    expect(result.mcpTools[0].parameterSchema).toEqual({
      truncated: true,
      bytes: MAX_WORKFLOW_MCP_STATUS_SCHEMA_BYTES + 1,
    })
    expect(result.mcpToolsTruncated).toBe(true)
  })

  it('returns forbidden for a cross-workspace delegated principal before protected status loads', async () => {
    queueTableRows(schemaMock.workflow, [
      {
        workflowId: workflowRecord.id,
        workflow: workflowRecord,
        workspaceId: workflowRecord.workspaceId,
      },
    ])

    await expect(
      readWorkflowDeploymentOverview.execute({
        principal: { ...principal, workspaceId: 'workspace-2' },
        input: { workflowId: workflowRecord.id },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(mocks.deploymentSummary).not.toHaveBeenCalled()
  })
})
