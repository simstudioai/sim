/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureQueryData, mockGetWorkflows } = vi.hoisted(() => ({
  mockEnsureQueryData: vi.fn().mockResolvedValue(undefined),
  mockGetWorkflows: vi.fn(),
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: vi.fn(() => ({
    ensureQueryData: mockEnsureQueryData,
  })),
}))

vi.mock('@/hooks/queries/utils/workflow-cache', () => ({
  getWorkflows: mockGetWorkflows,
  getWorkflowById: vi.fn((workspaceId: string, workflowId: string) =>
    mockGetWorkflows(workspaceId).find((workflow: { id: string }) => workflow.id === workflowId)
  ),
}))

vi.mock('@/hooks/queries/utils/workflow-list-query', () => ({
  getWorkflowListQueryOptions: vi.fn((workspaceId: string) => ({
    queryKey: ['workflows', 'list', workspaceId, 'active'],
  })),
}))

import { getSelectorDefinition } from '@/hooks/selectors/registry'

describe('sim.workflows selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkflows.mockReturnValue([
      { id: 'wf-1', name: 'Alpha Workflow' },
      { id: 'wf-2', name: 'Bravo Workflow' },
    ])
  })

  it('requires an explicit workspaceId in selector context', () => {
    const definition = getSelectorDefinition('sim.workflows')

    expect(definition.enabled?.({ key: 'sim.workflows', context: {} })).toBe(false)
    expect(definition.staleTime).toBe(60_000)
    expect(
      definition.getQueryKey({
        key: 'sim.workflows',
        context: { workspaceId: 'ws-1', excludeWorkflowId: 'wf-2' },
      })
    ).toEqual(['selectors', 'sim.workflows', 'ws-1', 'wf-2'])
  })

  it('reads workflow options from the scoped workflow cache', async () => {
    const definition = getSelectorDefinition('sim.workflows')

    const options = await definition.fetchList({
      key: 'sim.workflows',
      context: { workspaceId: 'ws-1', excludeWorkflowId: 'wf-2' },
    })

    expect(mockEnsureQueryData).toHaveBeenCalledWith({
      queryKey: ['workflows', 'list', 'ws-1', 'active'],
    })
    expect(mockGetWorkflows).toHaveBeenCalledWith('ws-1')
    expect(options).toEqual([{ id: 'wf-1', label: 'Alpha Workflow' }])
  })

  it('resolves workflow labels by id using the same workspace scope', async () => {
    const definition = getSelectorDefinition('sim.workflows')

    const option = await definition.fetchById?.({
      key: 'sim.workflows',
      context: { workspaceId: 'ws-1' },
      detailId: 'wf-2',
    })

    expect(mockEnsureQueryData).toHaveBeenCalledWith({
      queryKey: ['workflows', 'list', 'ws-1', 'active'],
    })
    expect(mockGetWorkflows).toHaveBeenCalledWith('ws-1')
    expect(option).toEqual({ id: 'wf-2', label: 'Bravo Workflow' })
  })
})
