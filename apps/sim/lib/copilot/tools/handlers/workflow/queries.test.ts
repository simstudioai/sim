import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ensureWorkflowAccessMock,
  getEffectiveBlockOutputPathsMock,
  hasTriggerCapabilityMock,
  getBlockMock,
  executeWorkflowUseCaseMock,
} = vi.hoisted(() => ({
  ensureWorkflowAccessMock: vi.fn(),
  getEffectiveBlockOutputPathsMock: vi.fn(),
  hasTriggerCapabilityMock: vi.fn(),
  getBlockMock: vi.fn(),
  executeWorkflowUseCaseMock: vi.fn(),
}))

const loadWorkflowFromNormalizedTablesMock =
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables
const getWorkflowByIdMock = workflowsUtilsMockFns.mockGetWorkflowById

vi.mock('../access', () => ({
  ensureWorkflowAccess: ensureWorkflowAccessMock,
  ensureWorkspaceAccess: vi.fn(),
  getDefaultWorkspaceId: vi.fn(),
}))

vi.mock('@/lib/copilot/application/execute-workflow-use-case', () => ({
  executeCopilotWorkflowUseCase: executeWorkflowUseCaseMock,
  messageForCopilotWorkflowError: (error: unknown) =>
    getErrorMessage(error, 'Workflow operation failed'),
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

import { executeGetBlockOutputs } from './queries'

describe('executeGetBlockOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureWorkflowAccessMock.mockResolvedValue({
      workflow: { id: 'wf-1', userId: 'user-1', workspaceId: 'ws-1' },
    })
    executeWorkflowUseCaseMock.mockImplementation(async () => ({
      workflow: { id: 'wf-1', userId: 'user-1', workspaceId: 'ws-1', variables: {} },
      workspaceId: 'ws-1',
      state: await loadWorkflowFromNormalizedTablesMock('wf-1'),
    }))
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
