import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, mockGetFolderMap, mockGetWorkflows, queryClient } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockGetFolderMap: vi.fn(() => ({})),
  mockGetWorkflows: vi.fn(() => []),
  queryClient: {
    cancelQueries: vi.fn().mockResolvedValue(undefined),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
  },
}))

let folderMapState: Record<string, any>
let folderListState: any[]

let workflowList: Array<{
  id: string
  name: string
  workspaceId: string
  folderId: string
  sortOrder: number
}>

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
  useMutation: vi.fn((options) => options),
}))

vi.mock('@/hooks/queries/utils/workflow-cache', () => ({
  getWorkflows: mockGetWorkflows,
}))

vi.mock('@/hooks/queries/utils/folder-cache', () => ({
  getFolderMap: mockGetFolderMap,
}))

vi.mock('@/hooks/queries/utils/workflow-keys', () => ({
  workflowKeys: {
    list: (workspaceId: string | undefined) => ['workflows', 'list', workspaceId ?? ''],
  },
}))

import { useCreateFolder, useDuplicateFolderMutation } from '@/hooks/queries/folders'

function getOptimisticFolderByName(name: string) {
  return Object.values(folderMapState).find((folder: any) => folder.name === name) as
    | { sortOrder: number }
    | undefined
}

describe('folder optimistic top insertion ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.getQueryData.mockImplementation(() => folderListState)
    queryClient.setQueryData.mockImplementation((_key: unknown, updater: any) => {
      folderListState = typeof updater === 'function' ? updater(folderListState) : updater
      folderMapState = Object.fromEntries(
        (folderListState ?? []).map((folder: any) => [folder.id, folder])
      )
    })
    mockGetFolderMap.mockImplementation(() => folderMapState)
    mockGetWorkflows.mockImplementation(() => workflowList)

    folderListState = [
      {
        id: 'folder-parent-match',
        name: 'Existing sibling folder',
        userId: 'user-1',
        workspaceId: 'ws-1',
        parentId: 'parent-1',
        color: '#808080',
        isExpanded: false,
        sortOrder: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'folder-other-parent',
        name: 'Other parent folder',
        userId: 'user-1',
        workspaceId: 'ws-1',
        parentId: 'parent-2',
        color: '#808080',
        isExpanded: false,
        sortOrder: -100,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]
    folderMapState = Object.fromEntries(folderListState.map((folder) => [folder.id, folder]))

    workflowList = [
      {
        id: 'workflow-parent-match',
        name: 'Existing sibling workflow',
        workspaceId: 'ws-1',
        folderId: 'parent-1',
        sortOrder: 2,
      },
      {
        id: 'workflow-other-parent',
        name: 'Other parent workflow',
        workspaceId: 'ws-1',
        folderId: 'parent-2',
        sortOrder: -50,
      },
    ]
  })

  it('creates folders at top of mixed non-root siblings', async () => {
    const mutation = useCreateFolder()

    await mutation.onMutate({
      workspaceId: 'ws-1',
      name: 'New child folder',
      parentId: 'parent-1',
    })

    const optimisticFolder = getOptimisticFolderByName('New child folder')
    expect(optimisticFolder).toBeDefined()
    expect(optimisticFolder?.sortOrder).toBe(1)
  })

  it('duplicates folders at top of mixed non-root siblings', async () => {
    const mutation = useDuplicateFolderMutation()

    await mutation.onMutate({
      workspaceId: 'ws-1',
      id: 'folder-parent-match',
      name: 'Duplicated child folder',
      parentId: 'parent-1',
    })

    const optimisticFolder = getOptimisticFolderByName('Duplicated child folder')
    expect(optimisticFolder).toBeDefined()
    expect(optimisticFolder?.sortOrder).toBe(1)
  })

  it('uses source parent scope when duplicate parentId is undefined', async () => {
    const mutation = useDuplicateFolderMutation()

    await mutation.onMutate({
      workspaceId: 'ws-1',
      id: 'folder-parent-match',
      name: 'Duplicated with inherited parent',
      // parentId intentionally omitted to mirror duplicate fallback behavior
    })

    const optimisticFolder = getOptimisticFolderByName('Duplicated with inherited parent') as
      | { parentId: string | null; sortOrder: number }
      | undefined
    expect(optimisticFolder).toBeDefined()
    expect(optimisticFolder?.parentId).toBe('parent-1')
    expect(optimisticFolder?.sortOrder).toBe(1)
  })
})
