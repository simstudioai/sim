import { beforeEach, describe, expect, it, vi } from 'vitest'

const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/workflows/persistence/utils', () => ({ loadDeployedWorkflowState: load }))

import { prepareFileWorkflowInput } from '@/lib/workspace-files/workflows/input'

describe('file workflow input', () => {
  beforeEach(() => {
    load.mockReset()
    load.mockResolvedValue({ deploymentVersionId: 'deployment-1', blocks: {} })
  })

  it('uses one cache key for every omitted or empty zero-field input', async () => {
    const omitted = await prepareFileWorkflowInput('workflow-1', 'workspace-1', undefined)
    const empty = await prepareFileWorkflowInput('workflow-1', 'workspace-1', {})
    expect(omitted).toEqual(empty)
    expect(omitted.input).toEqual({})
    await expect(
      prepareFileWorkflowInput('workflow-1', 'workspace-1', { invented: 'value' })
    ).rejects.toThrow('invented')
    await expect(prepareFileWorkflowInput('workflow-1', 'workspace-1', null)).rejects.toThrow(
      'JSON object'
    )
  })

  it('hashes equivalent input objects identically but separates distinct values', async () => {
    load.mockResolvedValue({
      deploymentVersionId: 'deployment-1',
      blocks: {
        start: {
          type: 'start_trigger',
          subBlocks: {
            inputFormat: {
              value: [
                { name: 'incidentId', type: 'string' },
                { name: 'options', type: 'object' },
              ],
            },
          },
        },
      },
    })
    const first = await prepareFileWorkflowInput('workflow-1', 'workspace-1', {
      options: { severity: 'high', active: true },
      incidentId: '123',
    })
    const same = await prepareFileWorkflowInput('workflow-1', 'workspace-1', {
      incidentId: '123',
      options: { active: true, severity: 'high' },
    })
    const different = await prepareFileWorkflowInput('workflow-1', 'workspace-1', {
      incidentId: '124',
    })
    expect(first.inputHash).toBe(same.inputHash)
    expect(first.inputHash).not.toBe(different.inputHash)
  })
})
