import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, queryClient, useFolderStoreMock, useWorkflowRegistryMock } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  queryClient: {
    cancelQueries: vi.fn().mockResolvedValue(undefined),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
  useFolderStoreMock: Object.assign(vi.fn(), {
    getState: vi.fn(),
    setState: vi.fn(),
  }),
  useWorkflowRegistryMock: Object.assign(vi.fn(), {
    getState: vi.fn(),
    setState: vi.fn(),
  }),
}))

let folderState: {
  folders: Record<string, any>
}

let workflowRegistryState: {
  workflows: Record<string, any>
}

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
  useMutation: vi.fn((options) => options),
}))

vi.mock('@/stores/folders/store', () => ({
  useFolderStore: useFolderStoreMock,
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: useWorkflowRegistryMock,
}))

vi.mock('@/hooks/queries/workflows', () => ({
  workflowKeys: {
    list: (workspaceId: string | undefined) => ['workflows', 'list', workspaceId ?? ''],
  },
}))

import { useCreateFolder, useDuplicateFolderMutation } from '@/hooks/queries/folders'

function getOptimisticFolderByName(name: string) {
  return Object.values(folderState.folders).find((folder: any) => folder.name === name) as
    | { sortOrder: number }
    | undefined
}

describe('folder optimistic top insertion ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFolderStoreMock.getState.mockImplementation(() => folderState)
    useFolderStoreMock.setState.mockImplementation((updater: any) => {
      if (typeof updater === 'function') {
        const next = updater(folderState)
        if (next) {
          folderState = { ...folderState, ...next }
        }
        return
      }

      folderState = { ...folderState, ...updater }
    })
    useWorkflowRegistryMock.getState.mockImplementation(() => workflowRegistryState)

    folderState = {
      folders: {
        'folder-parent-match': {
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
        'folder-other-parent': {
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
      },
    }

    workflowRegistryState = {
      workflows: {
        'workflow-parent-match': {
          id: 'workflow-parent-match',
          name: 'Existing sibling workflow',
          workspaceId: 'ws-1',
          folderId: 'parent-1',
          sortOrder: 2,
        },
        'workflow-other-parent': {
          id: 'workflow-other-parent',
          name: 'Other parent workflow',
          workspaceId: 'ws-1',
          folderId: 'parent-2',
          sortOrder: -50,
        },
      },
    }
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
