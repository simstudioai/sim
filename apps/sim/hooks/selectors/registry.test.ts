/**
 * @vitest-environment node
 */
import type { QueryClient } from '@tanstack/react-query'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as getQueryClientModule from '@/app/_shell/providers/get-query-client'
import * as folderCacheModule from '@/hooks/queries/utils/folder-cache'
import * as workflowCacheModule from '@/hooks/queries/utils/workflow-cache'
import * as workflowListQueryModule from '@/hooks/queries/utils/workflow-list-query'
import { getSelectorDefinition } from '@/hooks/selectors/registry'

const mockEnsureQueryData = vi.fn().mockResolvedValue(undefined)

/**
 * Spy on the real module namespaces instead of vi.mock: under `isolate: false`
 * `@/hooks/selectors/registry` may already be cached bound to the real
 * cache/query modules, so patching the shared namespaces is the only wiring
 * that always applies.
 */
const getQueryClientSpy = vi
  .spyOn(getQueryClientModule, 'getQueryClient')
  .mockImplementation(() => ({ ensureQueryData: mockEnsureQueryData }) as unknown as QueryClient)
const mockGetWorkflows = vi.spyOn(workflowCacheModule, 'getWorkflows')
const getWorkflowByIdSpy = vi
  .spyOn(workflowCacheModule, 'getWorkflowById')
  .mockImplementation((workspaceId: string, workflowId: string) =>
    mockGetWorkflows(workspaceId).find((workflow: { id: string }) => workflow.id === workflowId)
  )
const mockGetFolderMap = vi.spyOn(folderCacheModule, 'getFolderMap').mockReturnValue({})
const getWorkflowListQueryOptionsSpy = vi
  .spyOn(workflowListQueryModule, 'getWorkflowListQueryOptions')
  .mockImplementation(
    (workspaceId: string) =>
      ({
        queryKey: ['workflows', 'list', workspaceId, 'active'],
      }) as unknown as ReturnType<typeof workflowListQueryModule.getWorkflowListQueryOptions>
  )

afterAll(() => {
  getQueryClientSpy.mockRestore()
  mockGetWorkflows.mockRestore()
  getWorkflowByIdSpy.mockRestore()
  mockGetFolderMap.mockRestore()
  getWorkflowListQueryOptionsSpy.mockRestore()
})

describe('sim.workflows selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureQueryData.mockResolvedValue(undefined)
    getQueryClientSpy.mockImplementation(
      () => ({ ensureQueryData: mockEnsureQueryData }) as unknown as QueryClient
    )
    getWorkflowByIdSpy.mockImplementation((workspaceId: string, workflowId: string) =>
      mockGetWorkflows(workspaceId).find((workflow: { id: string }) => workflow.id === workflowId)
    )
    getWorkflowListQueryOptionsSpy.mockImplementation(
      (workspaceId: string) =>
        ({
          queryKey: ['workflows', 'list', workspaceId, 'active'],
        }) as unknown as ReturnType<typeof workflowListQueryModule.getWorkflowListQueryOptions>
    )
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

    const options = await definition.fetchList!({
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
    const options = await definition.fetchList!({
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
