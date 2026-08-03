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
  listUserWorkspacesMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  getEffectiveBlockOutputPathsMock: vi.fn(),
  hasTriggerCapabilityMock: vi.fn(),
  getBlockMock: vi.fn(),
  listUserWorkspacesMock: vi.fn(),
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

vi.mock('@/lib/workspaces/utils', () => ({
  listUserWorkspaces: listUserWorkspacesMock,
}))

import { executeGetBlockOutputs, executeListUserWorkspaces } from './queries'

describe('executeListUserWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the current workspace in the accessible workspace list', async () => {
    listUserWorkspacesMock.mockResolvedValue([
      { workspaceId: 'workspace-1', workspaceName: 'One', role: 'owner' },
      { workspaceId: 'workspace-2', workspaceName: 'Two', role: 'read' },
    ])

    const result = await executeListUserWorkspaces({
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-2',
    })

    expect(listUserWorkspacesMock).toHaveBeenCalledWith('user-1')
    expect(result).toEqual({
      success: true,
      output: {
        workspaces: [
          {
            workspaceId: 'workspace-1',
            workspaceName: 'One',
            role: 'owner',
            isCurrent: false,
          },
          {
            workspaceId: 'workspace-2',
            workspaceName: 'Two',
            role: 'read',
            isCurrent: true,
          },
        ],
      },
    })
  })
})

describe('executeGetBlockOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', userId: 'user-1', workspaceId: 'ws-1' },
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
})
