import { auditMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { mcpPubsubMock } from '@sim/testing/mocks/mcp-pubsub.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/mcp/pubsub', () => mcpPubsubMock)
vi.mock('@/lib/workflows/triggers/utils.server', () => ({
  hasValidStartBlock: vi.fn(),
}))
vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  generateParameterSchemaForWorkflow: vi.fn().mockResolvedValue({ type: 'object', properties: {} }),
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_MCP_PARAMETER_SCHEMA_BYTES, MAX_MCP_TOOLS_PER_SERVER } from '@/lib/mcp/constants'
import {
  performCreateWorkflowMcpServer,
  performUpdateWorkflowMcpTool,
} from '@/lib/mcp/orchestration/workflow-mcp-lifecycle'
import { generateParameterSchemaForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { hasValidStartBlock } from '@/lib/workflows/triggers/utils.server'

describe('workflow MCP lifecycle orchestration', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('rejects over-limit workflow server creation before inserting a server row', async () => {
    const result = await performCreateWorkflowMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Too Many Tools',
      workflowIds: Array.from(
        { length: MAX_MCP_TOOLS_PER_SERVER + 1 },
        (_, index) => `wf-${index}`
      ),
    })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'validation',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects duplicate workflow IDs before inserting a server row', async () => {
    const result = await performCreateWorkflowMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Duplicate Tools',
      workflowIds: ['wf-1', 'wf-1'],
    })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'validation',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rechecks deployed workflow state inside the create transaction', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([
      {
        id: 'wf-1',
        name: 'Workflow',
        description: null,
        isDeployed: true,
        workspaceId: 'workspace-1',
        deployedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])
    vi.mocked(hasValidStartBlock).mockResolvedValueOnce(true)
    dbChainMockFns.for.mockResolvedValueOnce([
      {
        id: 'wf-1',
        name: 'Workflow',
        description: null,
        isDeployed: false,
        workspaceId: 'workspace-1',
        deployedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])

    const result = await performCreateWorkflowMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Server',
      workflowIds: ['wf-1'],
    })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'validation',
    })
    expect(dbChainMockFns.transaction).toHaveBeenCalled()
    expect(dbChainMockFns.for).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('answers an unpublishable workflow input as a validation failure naming the field', async () => {
    const message =
      'Workflow input "payload" has unsupported type "integer". Use one of: string, number.'
    vi.mocked(hasValidStartBlock).mockResolvedValueOnce(true)
    vi.mocked(generateParameterSchemaForWorkflow).mockRejectedValueOnce(
      new OrchestrationError('validation', message)
    )
    dbChainMockFns.where.mockResolvedValueOnce([
      {
        id: 'wf-1',
        name: 'Workflow',
        description: null,
        isDeployed: true,
        workspaceId: 'workspace-1',
        deployedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])

    const result = await performCreateWorkflowMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Server',
      workflowIds: ['wf-1'],
    })

    expect(result).toEqual({ success: false, error: message, errorCode: 'validation' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects workflow MCP server fan-out above the per-workflow limit', async () => {
    vi.mocked(hasValidStartBlock).mockResolvedValueOnce(true)
    dbChainMockFns.where.mockResolvedValueOnce([
      {
        id: 'wf-1',
        name: 'Workflow',
        description: null,
        isDeployed: true,
        workspaceId: 'workspace-1',
        deployedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])
    dbChainMockFns.for.mockResolvedValueOnce([
      {
        id: 'wf-1',
        name: 'Workflow',
        description: null,
        isDeployed: true,
        workspaceId: 'workspace-1',
        deployedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ])
    dbChainMockFns.groupBy.mockResolvedValueOnce([{ workflowId: 'wf-1', serverCount: 100 }])

    const result = await performCreateWorkflowMcpServer({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Server',
      workflowIds: ['wf-1'],
    })

    expect(result).toMatchObject({
      success: false,
      errorCode: 'validation',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('answers an unpublishable workflow input on a tool update as a validation failure', async () => {
    const message = 'Workflow input name "__proto__" is reserved. Rename this input field.'
    vi.mocked(generateParameterSchemaForWorkflow).mockRejectedValueOnce(
      new OrchestrationError('validation', message)
    )
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'server-1' }]).mockResolvedValueOnce([
      {
        id: 'tool-1',
        workflowId: 'wf-1',
        toolName: 'tool_a',
        toolDescription: null,
        parameterSchemaBytes: 10,
      },
    ])

    const result = await performUpdateWorkflowMcpTool({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      serverId: 'server-1',
      toolId: 'tool-1',
      parameterDescriptionOverrides: { input: 'The request to answer' },
    })

    expect(result).toEqual({ success: false, error: message, errorCode: 'validation' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('allows updating tool metadata when an unchanged stored schema exceeds the new cap', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'server-1' }]).mockResolvedValueOnce([
      {
        id: 'tool-1',
        toolName: 'tool_a',
        toolDescription: null,
        parameterSchemaBytes: MAX_MCP_PARAMETER_SCHEMA_BYTES + 1,
      },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([
      {
        id: 'tool-1',
        serverId: 'server-1',
        toolName: 'tool_a',
        toolDescription: 'Updated description',
      },
    ])

    const result = await performUpdateWorkflowMcpTool({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      serverId: 'server-1',
      toolId: 'tool-1',
      toolDescription: 'Updated description',
    })

    expect(result).toMatchObject({
      success: true,
      tool: {
        toolDescription: 'Updated description',
      },
    })
    expect(dbChainMockFns.update).toHaveBeenCalled()
  })
})
