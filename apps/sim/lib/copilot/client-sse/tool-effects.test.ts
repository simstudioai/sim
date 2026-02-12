/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

const mocked = vi.hoisted(() => ({
  setProposedChanges: vi.fn().mockResolvedValue(undefined),
  loadEnvironmentVariables: vi.fn(),
  loadVariablesForWorkflow: vi.fn(),
  getWorkflowDeploymentStatus: vi.fn().mockReturnValue(null),
  setDeploymentStatus: vi.fn(),
  registryState: {
    activeWorkflowId: 'workflow-active',
  },
}))

vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: {
    getState: () => ({
      setProposedChanges: mocked.setProposedChanges,
    }),
  },
}))

vi.mock('@/stores/settings/environment/store', () => ({
  useEnvironmentStore: {
    getState: () => ({
      loadEnvironmentVariables: mocked.loadEnvironmentVariables,
    }),
  },
}))

vi.mock('@/stores/panel/variables/store', () => ({
  useVariablesStore: {
    getState: () => ({
      loadForWorkflow: mocked.loadVariablesForWorkflow,
    }),
  },
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({
      activeWorkflowId: mocked.registryState.activeWorkflowId,
      getWorkflowDeploymentStatus: mocked.getWorkflowDeploymentStatus,
      setDeploymentStatus: mocked.setDeploymentStatus,
    }),
  },
}))

import { applyToolEffects } from '@/lib/copilot/client-sse/tool-effects'

describe('applyToolEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.registryState.activeWorkflowId = 'workflow-active'
  })

  it('applies workflow_change fallback diff when effects are absent', () => {
    const workflowState = {
      blocks: {
        start: { id: 'start', metadata: { id: 'start', type: 'start' }, inputs: {}, outputs: {} },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    applyToolEffects({
      effectsRaw: [],
      toolCall: {
        id: 'tool-1',
        name: 'workflow_change',
        state: 'success',
        params: { workflowId: 'workflow-123' },
      } as any,
      resultPayload: {
        workflowState,
      },
    })

    expect(mocked.setProposedChanges).toHaveBeenCalledTimes(1)
    expect(mocked.setProposedChanges).toHaveBeenCalledWith(workflowState)
  })

  it('applies workflow_change fallback diff from nested editResult.workflowState', () => {
    const workflowState = {
      blocks: {
        start: { id: 'start', metadata: { id: 'start', type: 'start' }, inputs: {}, outputs: {} },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    applyToolEffects({
      effectsRaw: [],
      toolCall: {
        id: 'tool-2',
        name: 'workflow_change',
        state: 'success',
      } as any,
      resultPayload: {
        editResult: {
          workflowState,
        },
      },
    })

    expect(mocked.setProposedChanges).toHaveBeenCalledTimes(1)
    expect(mocked.setProposedChanges).toHaveBeenCalledWith(workflowState)
  })

  it('applies explicit workflow.diff.proposed effect', () => {
    const workflowState = {
      blocks: {
        start: { id: 'start', metadata: { id: 'start', type: 'start' }, inputs: {}, outputs: {} },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    applyToolEffects({
      effectsRaw: [
        {
          kind: 'workflow.diff.proposed',
          payload: {
            workflowState,
          },
        },
      ],
      toolCall: {
        id: 'tool-3',
        name: 'workflow_change',
        state: 'success',
      } as any,
    })

    expect(mocked.setProposedChanges).toHaveBeenCalledTimes(1)
    expect(mocked.setProposedChanges).toHaveBeenCalledWith(workflowState)
  })

  it('does not apply fallback diff for non-workflow_change tools', () => {
    const workflowState = {
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    }

    applyToolEffects({
      effectsRaw: [],
      toolCall: {
        id: 'tool-4',
        name: 'list_workflows',
        state: 'success',
      } as any,
      resultPayload: {
        workflowState,
      },
    })

    expect(mocked.setProposedChanges).not.toHaveBeenCalled()
  })
})
