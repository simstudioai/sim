/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnsureQueryData, mockGetWorkflows, mockGetFolderMap } = vi.hoisted(() => ({
  mockEnsureQueryData: vi.fn().mockResolvedValue(undefined),
  mockGetWorkflows: vi.fn(),
  mockGetFolderMap: vi.fn().mockReturnValue({}),
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

vi.mock('@/hooks/queries/utils/folder-cache', () => ({
  getFolderMap: mockGetFolderMap,
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
    mockEnsureQueryData.mockResolvedValue(undefined)
    mockGetWorkflows.mockReturnValue([
      { id: 'wf-1', name: 'Alpha Workflow', folderId: null },
      { id: 'wf-2', name: 'Bravo Workflow', folderId: null },
    ])
    mockGetFolderMap.mockReturnValue({})
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

  it('disambiguates duplicate workflow names with their folder path', async () => {
    mockGetWorkflows.mockReturnValue([
      { id: 'wf-root', name: 'Pipeline', folderId: null },
      { id: 'wf-eng', name: 'Pipeline', folderId: 'folder-eng' },
      { id: 'wf-eng-backend', name: 'Pipeline', folderId: 'folder-backend' },
      { id: 'wf-unique', name: 'Solo Workflow', folderId: 'folder-eng' },
    ])
    mockGetFolderMap.mockReturnValue({
      'folder-eng': {
        id: 'folder-eng',
        name: 'Engineering',
        parentId: null,
        workspaceId: 'ws-1',
      },
      'folder-backend': {
        id: 'folder-backend',
        name: 'Backend',
        parentId: 'folder-eng',
        workspaceId: 'ws-1',
      },
    })

    const definition = getSelectorDefinition('sim.workflows')
    const options = await definition.fetchList({
      key: 'sim.workflows',
      context: { workspaceId: 'ws-1' },
    })

    const labelById = Object.fromEntries(options.map((o) => [o.id, o.label]))
    expect(labelById['wf-root']).toBe('Pipeline (Root)')
    expect(labelById['wf-eng']).toBe('Pipeline (Engineering)')
    expect(labelById['wf-eng-backend']).toBe('Pipeline (Engineering / Backend)')
    expect(labelById['wf-unique']).toBe('Solo Workflow')
  })

  it('disambiguates a single workflow lookup when its name has duplicates', async () => {
    mockGetWorkflows.mockReturnValue([
      { id: 'wf-1', name: 'Pipeline', folderId: 'folder-a' },
      { id: 'wf-2', name: 'Pipeline', folderId: null },
    ])
    mockGetFolderMap.mockReturnValue({
      'folder-a': {
        id: 'folder-a',
        name: 'Alpha',
        parentId: null,
        workspaceId: 'ws-1',
      },
    })

    const definition = getSelectorDefinition('sim.workflows')
    const option = await definition.fetchById?.({
      key: 'sim.workflows',
      context: { workspaceId: 'ws-1' },
      detailId: 'wf-1',
    })

    expect(option).toEqual({ id: 'wf-1', label: 'Pipeline (Alpha)' })
  })
})
