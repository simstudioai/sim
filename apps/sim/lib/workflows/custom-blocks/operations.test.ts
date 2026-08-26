/**
 * @vitest-environment node
 */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { extractInputFieldsFromBlocks, loadDeployedWorkflowState } = vi.hoisted(() => ({
  extractInputFieldsFromBlocks: vi.fn(),
  loadDeployedWorkflowState: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  isOrganizationOnEnterprisePlan: vi.fn(),
}))

vi.mock('@/lib/workflows/input-format', () => ({
  extractInputFieldsFromBlocks,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: vi.fn(),
}))

import {
  CustomBlockValidationError,
  listCustomBlocksWithInputs,
  publishCustomBlock,
  updateCustomBlock,
} from '@/lib/workflows/custom-blocks/operations'

const publishParams = {
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  userId: 'user-1',
  name: 'Enrich Lead',
  description: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

describe('custom block input hydration', () => {
  it('passes the joined source workspace to deployed-state loading', async () => {
    const block = {
      id: 'custom-block-1',
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      type: 'custom_block_enrich',
      name: 'Enrich Lead',
      description: '',
      iconUrl: null,
      enabled: true,
      traceChildRuns: false,
      inputs: [],
      outputs: [],
    }
    queueTableRows(schemaMock.customBlock, [
      {
        block,
        workflowName: 'Lead workflow',
        workspaceId: 'workspace-source',
        workspaceName: 'Source workspace',
      },
    ])
    loadDeployedWorkflowState.mockResolvedValue({ blocks: { start: { type: 'start' } } })
    extractInputFieldsFromBlocks.mockReturnValue([])

    const result = await listCustomBlocksWithInputs('org-1')

    expect(result).toHaveLength(1)
    expect(loadDeployedWorkflowState).toHaveBeenCalledWith('workflow-1', 'workspace-source')
  })

  it('bounds concurrent deployed-state hydration', async () => {
    queueTableRows(
      schemaMock.customBlock,
      Array.from({ length: 11 }, (_, index) => ({
        block: {
          id: `custom-block-${index}`,
          organizationId: 'org-1',
          workflowId: `workflow-${index}`,
          type: `custom_block_${index}`,
          name: `Block ${index}`,
          description: '',
          iconUrl: null,
          enabled: true,
          traceChildRuns: false,
          inputs: [],
          outputs: [],
        },
        workflowName: `Workflow ${index}`,
        workspaceId: 'workspace-source',
        workspaceName: 'Source workspace',
      }))
    )
    let active = 0
    let maxActive = 0
    loadDeployedWorkflowState.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active--
      return { blocks: { start: { type: 'start' } } }
    })
    extractInputFieldsFromBlocks.mockReturnValue([])

    const result = await listCustomBlocksWithInputs('org-1')

    expect(result).toHaveLength(11)
    expect(maxActive).toBe(10)
  })
})

describe('reserved exposed-output names', () => {
  it('publishCustomBlock rejects an output named cost', async () => {
    await expect(
      publishCustomBlock({
        ...publishParams,
        exposedOutputs: [{ blockId: 'b1', path: 'price', name: 'cost' }],
      })
    ).rejects.toThrow(CustomBlockValidationError)
  })

  it('publishCustomBlock rejects reserved names case-insensitively', async () => {
    await expect(
      publishCustomBlock({
        ...publishParams,
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'Success' }],
      })
    ).rejects.toThrow('"Success" is a reserved output name (success, error, cost)')
  })

  it('updateCustomBlock rejects a reserved output name', async () => {
    await expect(
      updateCustomBlock('cb-1', {
        exposedOutputs: [{ blockId: 'b1', path: 'content', name: 'error' }],
      })
    ).rejects.toThrow(CustomBlockValidationError)
  })
})
