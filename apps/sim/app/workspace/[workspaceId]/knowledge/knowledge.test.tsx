/** @vitest-environment jsdom */
import { act, type MouseEvent, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import type { ResourceRow } from '@/app/workspace/[workspaceId]/components'
import type { WorkflowFolder } from '@/stores/folders/types'

const mocks = vi.hoisted(() => ({
  bases: [] as KnowledgeBaseData[],
  folders: [] as WorkflowFolder[],
  permissions: { canEdit: true, canAdmin: false, isLoading: false },
  selection: new Set<string>(),
  deleteKey: undefined as (() => void) | undefined,
  table: undefined as
    | { rows: ResourceRow[]; onRowContextMenu: (event: MouseEvent, id: string) => void }
    | undefined,
  menu: undefined as { showDelete: boolean; onDelete: () => void } | undefined,
  folderMenu: undefined as
    | { canDelete: boolean; deleteDisabledReason?: string; onDelete: () => void }
    | undefined,
  actionDelete: undefined as (() => void) | undefined,
  singleModal: undefined as { isOpen: boolean; onConfirm: () => Promise<void> } | undefined,
  remove: vi.fn(),
  bulkRemove: vi.fn(),
  removeFolder: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  usePathname: () => '/workspace/workspace-1/knowledge',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('nuqs', () => ({
  useQueryStates: () => [{ search: '', connector: [], content: [], owner: [] }, vi.fn()],
}))
vi.mock('@/hooks/use-permission-config', () => ({ usePermissionConfig: () => ({ config: {} }) }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => mocks.permissions,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/global-commands-provider', () => ({
  useRegisterGlobalCommands: () => {},
}))
vi.mock('@/hooks/kb/use-knowledge', () => ({
  useKnowledgeBasesList: () => ({
    knowledgeBases: mocks.bases,
    isLoading: false,
    isPlaceholderData: false,
  }),
}))
vi.mock('@/hooks/queries/workspace', () => ({ useWorkspaceMembersQuery: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/pinned-items', () => ({
  usePinnedIds: () => new Set(),
  usePinItem: () => ({}),
  useUnpinItem: () => ({}),
}))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useDeleteKnowledgeBase: () => ({ mutateAsync: mocks.remove }),
  useBulkDeleteKnowledgeBases: () => ({ mutateAsync: mocks.bulkRemove }),
  useBulkMoveKnowledgeBases: () => ({}),
  useUpdateKnowledgeBase: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/hooks/queries/folders', () => ({
  useCreateFolder: () => ({}),
  useUpdateFolder: () => ({}),
  useDeleteFolderMutation: () => ({ mutateAsync: mocks.removeFolder }),
}))
vi.mock('@/hooks/use-context-menu', () => ({
  useContextMenu: () => ({
    isOpen: true,
    position: { x: 0, y: 0 },
    handleContextMenu: vi.fn(),
    closeMenu: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-inline-rename', () => ({ useInlineRename: () => ({ editingId: null }) }))
vi.mock('@/hooks/use-debounced-search-setter', () => ({
  useDebouncedSearchSetter: (setter: unknown) => setter,
}))
vi.mock('@/hooks/use-search-filter-value', () => ({
  useSearchFilterValue: (value: string) => value,
}))
vi.mock('@/hooks/use-url-sort', () => ({
  useUrlSort: () => ({ sort: 'name', dir: 'asc', onSort: vi.fn() }),
}))
vi.mock('@/hooks/use-resource-list-preferences', () => ({
  useResourceListPreferences: () => ({ isReady: true }),
}))
vi.mock('@/blocks/brand-icon', () => ({ BrandIcon: () => null }))
vi.mock('@/connectors/registry', () => ({ CONNECTOR_META_REGISTRY: {} }))
vi.mock('@/app/workspace/[workspaceId]/knowledge/[id]/components/base-tags-modal', () => ({
  BaseTagsModal: () => null,
}))
vi.mock('@/app/workspace/[workspaceId]/knowledge/components', () => ({
  CreateBaseModal: () => null,
  EditKnowledgeBaseModal: () => null,
  KnowledgeListContextMenu: () => null,
  KnowledgeBaseContextMenu: (props: typeof mocks.menu) => {
    mocks.menu = props
    return null
  },
  DeleteKnowledgeBaseModal: (props: typeof mocks.singleModal) => {
    mocks.singleModal = props
    return null
  },
}))
vi.mock('@/app/workspace/[workspaceId]/components/resource/components/action-bar', () => ({
  ResourceActionBar: ({ onDelete }: { onDelete?: () => void }) => {
    mocks.actionDelete = onDelete
    return null
  },
}))
vi.mock('@/app/workspace/[workspaceId]/components', () => ({
  Resource: Object.assign(({ children }: { children: ReactNode }) => <>{children}</>, {
    Header: () => null,
    Options: () => null,
    Table: ({ overlay, ...props }: NonNullable<typeof mocks.table> & { overlay: ReactNode }) => {
      mocks.table = props
      return <>{overlay}</>
    },
  }),
  useResourceRowSelection: ({ onDeleteSelected }: { onDeleteSelected: () => void }) => {
    mocks.deleteKey = onDeleteSelected
    return {
      selectedRowIds: mocks.selection,
      selectable: {},
      replaceSelection: vi.fn(),
      clearSelection: vi.fn(),
    }
  },
  ownerCell: () => ({ label: '' }),
  OwnerAvatar: () => null,
  timeCell: () => ({ label: '' }),
  resourceListState: () => 'ready',
  selectionLabel: () => 'selected items',
  reportBulkOutcome: vi.fn(),
  EMPTY_CELL_PLACEHOLDER: '',
  FILTER_SECTION_LABEL_CLASS: '',
}))
vi.mock('@/app/workspace/[workspaceId]/components/folders/use-folder-navigation', () => ({
  useFolderNavigation: () => ({
    currentFolderId: null,
    setCurrentFolderId: vi.fn(),
    openFolder: vi.fn(),
    ancestors: [],
    folders: mocks.folders,
    folderById: new Map(mocks.folders.map((folder) => [folder.id, folder])),
    foldersResolved: true,
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/components/folders/use-folder-row-drag-drop', () => ({
  useFolderRowDragDrop: () => ({}),
}))
vi.mock('@/app/workspace/[workspaceId]/components/folders/folder-context-menu', () => ({
  FolderContextMenu: (props: typeof mocks.folderMenu) => {
    mocks.folderMenu = props
    return null
  },
}))

import { Knowledge } from '@/app/workspace/[workspaceId]/knowledge/knowledge'

const base: KnowledgeBaseData = {
  id: 'search-index',
  name: 'Renamed search index',
  isSearchIndex: true,
  userId: 'author',
  workspaceId: 'workspace-1',
  description: null,
  folderId: null,
  tokenCount: 12,
  embeddingModel: 'embedding',
  embeddingDimension: 1536,
  chunkingConfig: {},
  createdAt: '2026-09-04',
  updatedAt: '2026-09-04',
  deletedAt: null,
  docCount: 2,
}
function folder(id: string, parentId: string | null = null): WorkflowFolder {
  return {
    id,
    parentId,
    name: id,
    workspaceId: 'workspace-1',
    userId: 'author',
    resourceType: 'knowledge_base',
    locked: false,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

describe('knowledge list Search index delete controls', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    mocks.bases = [base]
    mocks.folders = []
    mocks.permissions = { canEdit: true, canAdmin: false, isLoading: false }
    mocks.selection = new Set()
    mocks.menu = undefined
    mocks.folderMenu = undefined
    mocks.singleModal = undefined
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  async function render() {
    await act(async () => root.render(<Knowledge />))
  }
  async function openRow(id: string) {
    await act(async () =>
      mocks.table?.onRowContextMenu({ preventDefault() {}, stopPropagation() {} } as MouseEvent, id)
    )
  }
  it('hides delete for a renamed Search index and refuses stale menu callbacks for an editor', async () => {
    await render()
    await openRow('search-index')
    expect(mocks.menu?.showDelete).toBe(false)
    await act(async () => mocks.menu?.onDelete())
    expect(mocks.singleModal?.isOpen).toBe(false)
    await act(async () => mocks.singleModal?.onConfirm())
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('lets a workspace admin delete the canonical index directly', async () => {
    mocks.permissions.canAdmin = true
    await render()
    await openRow('search-index')
    expect(mocks.menu?.showDelete).toBe(true)
    await act(async () => mocks.menu?.onDelete())
    expect(mocks.singleModal?.isOpen).toBe(true)
    await act(async () => mocks.singleModal?.onConfirm())
    expect(mocks.remove).toHaveBeenCalledWith({ knowledgeBaseId: 'search-index' })
  })
  it('preserves editor deletion of an ordinary knowledge base', async () => {
    mocks.bases = [{ ...base, isSearchIndex: false }]
    await render()
    await openRow('search-index')
    expect(mocks.menu?.showDelete).toBe(true)
    await act(async () => mocks.menu?.onDelete())
    await act(async () => mocks.singleModal?.onConfirm())
    expect(mocks.remove).toHaveBeenCalledOnce()
  })
  it('blocks a mixed bulk selection from the action bar and Delete-key callback', async () => {
    mocks.bases = [base, { ...base, id: 'ordinary', isSearchIndex: false }]
    mocks.selection = new Set(['search-index', 'ordinary'])
    await render()
    expect(mocks.actionDelete).toBeUndefined()
    await act(async () => mocks.deleteKey?.())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.bulkRemove).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'blocks folder cascades around the canonical index (admin=%s)',
    async (canAdmin) => {
      mocks.permissions.canAdmin = canAdmin
      mocks.folders = [folder('parent'), folder('child', 'parent')]
      mocks.bases = [{ ...base, folderId: 'child' }]
      mocks.selection = new Set(['folder:parent'])
      await render()
      expect(mocks.actionDelete).toBeUndefined()
      await openRow('folder:parent')
      expect(mocks.folderMenu?.deleteDisabledReason).toBe('Delete the search knowledge base first')
      await act(async () => mocks.folderMenu?.onDelete())
      await act(async () => mocks.deleteKey?.())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.removeFolder).not.toHaveBeenCalled()
      expect(mocks.bulkRemove).not.toHaveBeenCalled()
    }
  )
})
