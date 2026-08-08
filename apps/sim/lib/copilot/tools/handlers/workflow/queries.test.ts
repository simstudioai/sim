import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ensureWorkflowAccessMock,
  getEffectiveBlockOutputPathsMock,
  hasTriggerCapabilityMock,
  getBlockMock,
  listCustomToolsMock,
  listWorkspaceCustomToolsMock,
  discoverMcpToolsMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  getEffectiveBlockOutputPathsMock: vi.fn(),
  hasTriggerCapabilityMock: vi.fn(),
  getBlockMock: vi.fn(),
  listCustomToolsMock: vi.fn(),
  listWorkspaceCustomToolsMock: vi.fn(),
  discoverMcpToolsMock: vi.fn(),
}))

const loadWorkflowFromNormalizedTablesMock =
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables
const getWorkflowByIdMock = workflowsUtilsMockFns.mockGetWorkflowById

vi.mock('../access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
  ensureWorkspaceAccess: vi.fn(),
  getDefaultWorkspaceId: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/blocks/block-outputs', () => ({
  getEffectiveBlockOutputPaths: getEffectiveBlockOutputPathsMock,
}))

vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  hasTriggerCapability: hasTriggerCapabilityMock,
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: getBlockMock,
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workflows/custom-tools/operations', () => ({
  listCustomTools: listCustomToolsMock,
  listWorkspaceCustomTools: listWorkspaceCustomToolsMock,
}))

vi.mock('@/lib/mcp/service', () => ({
  mcpService: { discoverTools: discoverMcpToolsMock },
}))

import { executeGetBlockOutputs, executeGetWorkflowData } from './queries'

describe('executeGetBlockOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', userId: 'user-1', workspaceId: 'ws-1' },
      workspaceId: 'ws-1',
    })
    getWorkflowByIdMock.mockResolvedValue({ variables: {} })
    getBlockMock.mockReturnValue({ category: 'core' })
    hasTriggerCapabilityMock.mockReturnValue(false)
    getEffectiveBlockOutputPathsMock.mockReturnValue(['content'])
  })

  it('returns display outputs and block-relative outputs for chat deployment', async () => {
    loadWorkflowFromNormalizedTablesMock.mockResolvedValue({
      blocks: {
        'agent-1': {
          type: 'agent',
          name: 'Support Agent',
          subBlocks: {},
        },
        'loop-1': {
          type: 'loop',
          name: 'Items Loop',
        },
      },
      loops: {
        'loop-1': {
          loopType: 'forEach',
        },
      },
      parallels: {},
    })

    const result = await executeGetBlockOutputs({ blockIds: ['agent-1', 'loop-1'] }, {
      workflowId: 'wf-1',
      userId: 'user-1',
    } as any)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      blocks: [
        {
          blockId: 'agent-1',
          blockName: 'Support Agent',
          blockType: 'agent',
          outputs: ['supportagent.content'],
          relativeOutputs: ['content'],
          triggerMode: undefined,
        },
        {
          blockId: 'loop-1',
          blockName: 'Items Loop',
          blockType: 'loop',
          outputs: [],
          relativeOutputs: [],
          insideSubflowOutputs: ['itemsloop.index', 'itemsloop.currentItem', 'itemsloop.items'],
          outsideSubflowOutputs: ['itemsloop.results'],
          relativeInsideSubflowOutputs: ['index', 'currentItem', 'items'],
          relativeOutsideSubflowOutputs: ['results'],
          triggerMode: undefined,
        },
      ],
      variables: [],
    })
  })

  it('lists only workspace custom tools for a credentialless context', async () => {
    listWorkspaceCustomToolsMock.mockResolvedValue([
      {
        id: 'tool-workspace',
        title: 'Workspace tool',
        schema: { function: { name: 'workspace_tool', description: 'Shared', parameters: {} } },
      },
    ])

    const result = await executeGetWorkflowData({ workflowId: 'wf-1', data_type: 'custom_tools' }, {
      workflowId: 'wf-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      secretActorUserId: null,
    } as any)

    expect(result.success).toBe(true)
    expect(listWorkspaceCustomToolsMock).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(listCustomToolsMock).not.toHaveBeenCalled()
    expect(result.output).toEqual({
      customTools: [
        {
          id: 'tool-workspace',
          title: 'Workspace tool',
          functionName: 'workspace_tool',
          description: 'Shared',
          parameters: {},
        },
      ],
    })
  })

  it('does not discover MCP tools for a credentialless context', async () => {
    const result = await executeGetWorkflowData({ workflowId: 'wf-1', data_type: 'mcp_tools' }, {
      workflowId: 'wf-1',
      userId: 'key-creator',
      workspaceId: 'ws-1',
      secretActorUserId: null,
    } as any)

    expect(result).toEqual({
      success: false,
      error: 'MCP tools are not available without credential access.',
    })
    expect(discoverMcpToolsMock).not.toHaveBeenCalled()
  })
})
