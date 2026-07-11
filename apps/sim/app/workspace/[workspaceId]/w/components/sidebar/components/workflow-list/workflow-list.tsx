'use client'

import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { useShallow } from 'zustand/react/shallow'
import { buildFolderTree, getFolderPath } from '@/lib/folders/tree'
import { EmptyAreaContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/empty-area-context-menu'
import { FolderItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/folder-item/folder-item'
import { WorkflowItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/workflow-item/workflow-item'
import {
  SidebarListContext,
  useContextMenu,
  useDragDrop,
  useFolderSelection,
  useSidebarListContextValue,
  useWorkflowSelection,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  compareByOrder,
  groupWorkflowsByFolder,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import { useFolderMap, useFolders } from '@/hooks/queries/folders'
import { usePinnedItems } from '@/hooks/queries/pinned-items'
import { useFolderStore } from '@/stores/folders/store'
import type { FolderTreeNode } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const TREE_SPACING = {
  INDENT_PER_LEVEL: 20,
} as const

interface WorkflowListProps {
  workspaceId: string
  workflowId: string | undefined
  regularWorkflows: WorkflowMetadata[]
  isLoading?: boolean
  canReorder?: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  onCreateWorkflow?: () => void
  onCreateFolder?: () => void
  disableCreate?: boolean
}

const DropIndicatorLine = memo(function DropIndicatorLine({
  show,
  level = 0,
  position = 'before',
}: {
  show: boolean
  level?: number
  position?: 'before' | 'after'
}) {
  if (!show) return null

  const positionStyle = position === 'before' ? { top: '-2px' } : { bottom: '-2px' }

  return (
    <div
      className='pointer-events-none absolute right-0 left-0 z-20'
      style={{ ...positionStyle, paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}
    >
      <div className='h-[2px] rounded-full bg-[var(--text-subtle)]' />
    </div>
  )
})

export const WorkflowList = memo(function WorkflowList({
  workspaceId,
  workflowId,
  regularWorkflows,
  isLoading = false,
  canReorder = true,
  scrollContainerRef,
  onCreateWorkflow,
  onCreateFolder,
  disableCreate = false,
}: WorkflowListProps) {
  const { isLoading: foldersLoading } = useFolders(workspaceId)
  const { data: folderMap = {} } = useFolderMap(workspaceId)
  const { expandedFolders, setExpanded } = useFolderStore(
    useShallow((s) => ({
      expandedFolders: s.expandedFolders,
      setExpanded: s.setExpanded,
    }))
  )

  const {
    isOpen: isEmptyAreaMenuOpen,
    position: emptyAreaMenuPosition,
    menuRef: emptyAreaMenuRef,
    handleContextMenu: handleEmptyAreaContextMenu,
    closeMenu: closeEmptyAreaMenu,
  } = useContextMenu()

  const {
    dropIndicator,
    isDragging,
    disabled: dragDisabled,
    setScrollContainer,
    createWorkflowDragHandlers,
    createFolderDragHandlers,
    createEmptyFolderDropZone,
    createFolderContentDropZone,
    createRootDropZone,
    createEdgeDropZone,
    handleDragStart,
    handleDragEnd,
  } = useDragDrop({ disabled: !canReorder })

  useEffect(() => {
    if (scrollContainerRef.current) {
      setScrollContainer(scrollContainerRef.current)
    }
  }, [scrollContainerRef, setScrollContainer])

  const folderTree = useMemo(
    () => (workspaceId ? buildFolderTree(folderMap, workspaceId) : []),
    [workspaceId, folderMap]
  )

  /** Flat `id -> FolderTreeNode` lookup, used to resolve pinned folder ids against the tree. */
  const folderTreeById = useMemo(() => {
    const map = new Map<string, FolderTreeNode>()
    const walk = (nodes: FolderTreeNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node)
        walk(node.children)
      }
    }
    walk(folderTree)
    return map
  }, [folderTree])

  const activeWorkflowFolderId = useMemo(() => {
    if (!workflowId || isLoading || foldersLoading) return null
    const activeWorkflow = regularWorkflows.find((workflow) => workflow.id === workflowId)
    return activeWorkflow?.folderId || null
  }, [workflowId, regularWorkflows, isLoading, foldersLoading])

  const workflowsByFolder = useMemo(
    () => groupWorkflowsByFolder(regularWorkflows),
    [regularWorkflows]
  )

  const orderedWorkflowIds = useMemo(() => {
    const ids: string[] = []

    const collectFromFolder = (folder: FolderTreeNode) => {
      const workflowsInFolder = workflowsByFolder[folder.id] || []
      const childItems: Array<{
        type: 'folder' | 'workflow'
        id: string
        sortOrder: number
        createdAt?: Date
        data: FolderTreeNode | WorkflowMetadata
      }> = []
      for (const child of folder.children) {
        childItems.push({
          type: 'folder',
          id: child.id,
          sortOrder: child.sortOrder,
          createdAt: child.createdAt,
          data: child,
        })
      }
      for (const wf of workflowsInFolder) {
        childItems.push({
          type: 'workflow',
          id: wf.id,
          sortOrder: wf.sortOrder,
          createdAt: wf.createdAt,
          data: wf,
        })
      }
      childItems.sort(compareByOrder)
      for (const item of childItems) {
        if (item.type === 'workflow') {
          ids.push(item.id)
        } else {
          collectFromFolder(item.data as FolderTreeNode)
        }
      }
    }

    const rootLevelItems: Array<{
      type: 'folder' | 'workflow'
      id: string
      sortOrder: number
      createdAt?: Date
      data: FolderTreeNode | WorkflowMetadata
    }> = []
    for (const folder of folderTree) {
      rootLevelItems.push({
        type: 'folder',
        id: folder.id,
        sortOrder: folder.sortOrder,
        createdAt: folder.createdAt,
        data: folder,
      })
    }
    const rootWfs = workflowsByFolder.root || []
    for (const wf of rootWfs) {
      rootLevelItems.push({
        type: 'workflow',
        id: wf.id,
        sortOrder: wf.sortOrder,
        createdAt: wf.createdAt,
        data: wf,
      })
    }
    rootLevelItems.sort(compareByOrder)

    for (const item of rootLevelItems) {
      if (item.type === 'workflow') {
        ids.push(item.id)
      } else {
        collectFromFolder(item.data as FolderTreeNode)
      }
    }

    return ids
  }, [folderTree, workflowsByFolder])

  const orderedFolderIds = useMemo(() => {
    const ids: string[] = []

    const collectFromFolder = (folder: FolderTreeNode) => {
      ids.push(folder.id)
      const workflowsInFolder = workflowsByFolder[folder.id] || []
      const childItems: Array<{
        type: 'folder' | 'workflow'
        id: string
        sortOrder: number
        createdAt?: Date
        data: FolderTreeNode | WorkflowMetadata
      }> = []
      for (const child of folder.children) {
        childItems.push({
          type: 'folder',
          id: child.id,
          sortOrder: child.sortOrder,
          createdAt: child.createdAt,
          data: child,
        })
      }
      for (const wf of workflowsInFolder) {
        childItems.push({
          type: 'workflow',
          id: wf.id,
          sortOrder: wf.sortOrder,
          createdAt: wf.createdAt,
          data: wf,
        })
      }
      childItems.sort(compareByOrder)
      for (const item of childItems) {
        if (item.type === 'folder') {
          collectFromFolder(item.data as FolderTreeNode)
        }
      }
    }

    const rootLevelItems: Array<{
      type: 'folder' | 'workflow'
      id: string
      sortOrder: number
      createdAt?: Date
      data: FolderTreeNode | WorkflowMetadata
    }> = []
    for (const folder of folderTree) {
      rootLevelItems.push({
        type: 'folder',
        id: folder.id,
        sortOrder: folder.sortOrder,
        createdAt: folder.createdAt,
        data: folder,
      })
    }
    const rootWfs = workflowsByFolder.root || []
    for (const wf of rootWfs) {
      rootLevelItems.push({
        type: 'workflow',
        id: wf.id,
        sortOrder: wf.sortOrder,
        createdAt: wf.createdAt,
        data: wf,
      })
    }
    rootLevelItems.sort(compareByOrder)

    for (const item of rootLevelItems) {
      if (item.type === 'folder') {
        collectFromFolder(item.data as FolderTreeNode)
      }
    }

    return ids
  }, [folderTree, workflowsByFolder])

  const {
    workflowAncestorFolderIds,
    folderDescendantWorkflowIds,
    folderAncestorIds,
    folderDescendantIds,
  } = useMemo(() => {
    const wfAncestors: Record<string, string[]> = {}
    const fDescWfs: Record<string, string[]> = {}
    const fAncestors: Record<string, string[]> = {}
    const fDescendants: Record<string, string[]> = {}

    const buildMaps = (folder: FolderTreeNode, ancestors: string[]) => {
      fAncestors[folder.id] = ancestors
      const wfsInFolder = (workflowsByFolder[folder.id] || []).map((w) => w.id)
      const allDescWfs = [...wfsInFolder]
      const allDescFolders: string[] = []

      for (const child of folder.children) {
        buildMaps(child, [...ancestors, folder.id])
        allDescFolders.push(child.id, ...(fDescendants[child.id] || []))
        allDescWfs.push(...(fDescWfs[child.id] || []))
      }

      fDescendants[folder.id] = allDescFolders
      fDescWfs[folder.id] = allDescWfs
    }

    for (const folder of folderTree) {
      buildMaps(folder, [])
    }

    for (const wf of regularWorkflows) {
      if (wf.folderId && fAncestors[wf.folderId] !== undefined) {
        wfAncestors[wf.id] = [wf.folderId, ...fAncestors[wf.folderId]]
      }
    }

    return {
      workflowAncestorFolderIds: wfAncestors,
      folderDescendantWorkflowIds: fDescWfs,
      folderAncestorIds: fAncestors,
      folderDescendantIds: fDescendants,
    }
  }, [folderTree, workflowsByFolder, regularWorkflows])

  const { handleWorkflowClick } = useWorkflowSelection({
    workflowIds: orderedWorkflowIds,
    activeWorkflowId: workflowId,
    workflowAncestorFolderIds,
  })

  const { handleFolderClick } = useFolderSelection({
    folderIds: orderedFolderIds,
    folderDescendantWorkflowIds,
    folderAncestorIds,
    folderDescendantIds,
  })

  /** Mirror `workflowId` into a stable ref so the list context stays referentially stable across navigation. */
  const activeWorkflowIdRef = useRef(workflowId)
  activeWorkflowIdRef.current = workflowId

  const listContextValue = useSidebarListContextValue({
    isAnyDragActive: isDragging,
    dragDisabled,
    activeWorkflowIdRef,
    onWorkflowClick: handleWorkflowClick,
    onFolderClick: handleFolderClick,
    onItemDragStart: handleDragStart,
    onItemDragEnd: handleDragEnd,
  })

  const isWorkflowActive = useCallback((wfId: string) => wfId === workflowId, [workflowId])

  /**
   * Pinned items visible in the sidebar. Only `workflow`/`folder` pins can be
   * resolved here — this surface has no file/knowledge-base/table data loaded,
   * so pins from other resource types simply don't render in this section.
   */
  const { data: pinnedItems } = usePinnedItems(workspaceId)

  const workflowById = useMemo(() => {
    const map = new Map<string, WorkflowMetadata>()
    for (const wf of regularWorkflows) map.set(wf.id, wf)
    return map
  }, [regularWorkflows])

  /**
   * Pinned resourceIds by type, derived once from the single `pinnedItems`
   * fetch above. Passed down as a `pinned` boolean prop rather than letting
   * every `WorkflowItem`/`FolderItem` row subscribe to its own filtered
   * query — that would both triple the network fetches (one per resource
   * type) and re-render every row whenever any pin changes, defeating their
   * `React.memo` wrapper.
   */
  const { pinnedWorkflowIds, pinnedFolderIds } = useMemo(() => {
    const workflows = new Set<string>()
    const folders = new Set<string>()
    for (const item of pinnedItems ?? []) {
      if (item.resourceType === 'workflow') workflows.add(item.resourceId)
      else if (item.resourceType === 'folder') folders.add(item.resourceId)
    }
    return { pinnedWorkflowIds: workflows, pinnedFolderIds: folders }
  }, [pinnedItems])

  const pinnedEntries = useMemo(() => {
    if (!pinnedItems || pinnedItems.length === 0) return []
    const entries: Array<
      | { type: 'workflow'; id: string; data: WorkflowMetadata }
      | { type: 'folder'; id: string; data: FolderTreeNode }
    > = []
    for (const item of pinnedItems) {
      if (item.resourceType === 'workflow') {
        const workflow = workflowById.get(item.resourceId)
        if (workflow) entries.push({ type: 'workflow', id: workflow.id, data: workflow })
      } else if (item.resourceType === 'folder') {
        const folder = folderTreeById.get(item.resourceId)
        if (folder) entries.push({ type: 'folder', id: folder.id, data: folder })
      }
    }
    return entries
  }, [pinnedItems, workflowById, folderTreeById])

  useEffect(() => {
    if (!workflowId || isLoading || foldersLoading) return

    if (activeWorkflowFolderId) {
      const folderPath = getFolderPath(folderMap, activeWorkflowFolderId)
      folderPath.forEach((folder) => setExpanded(folder.id, true))
    }

    const { selectedWorkflows, selectOnly } = useFolderStore.getState()
    if (!selectedWorkflows.has(workflowId)) {
      selectOnly(workflowId)
    }
  }, [workflowId, activeWorkflowFolderId, isLoading, foldersLoading, folderMap, setExpanded])

  const renderWorkflowItem = useCallback(
    (workflow: WorkflowMetadata, level: number, folderId: string | null = null) => {
      const showBefore =
        dropIndicator?.targetId === workflow.id && dropIndicator?.position === 'before'
      const showAfter =
        dropIndicator?.targetId === workflow.id && dropIndicator?.position === 'after'

      return (
        <div key={workflow.id} className='relative'>
          <DropIndicatorLine show={showBefore} level={level} position='before' />
          <div
            style={{ paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}
            {...createWorkflowDragHandlers(workflow.id, folderId)}
          >
            <WorkflowItem
              workspaceId={workspaceId}
              workflow={workflow}
              active={isWorkflowActive(workflow.id)}
              pinned={pinnedWorkflowIds.has(workflow.id)}
            />
          </div>
          <DropIndicatorLine show={showAfter} level={level} position='after' />
        </div>
      )
    },
    [workspaceId, dropIndicator, isWorkflowActive, createWorkflowDragHandlers, pinnedWorkflowIds]
  )

  const renderFolderSection = useCallback(
    (
      folder: FolderTreeNode,
      level: number,
      parentFolderId: string | null = null
    ): React.ReactNode => {
      const workflowsInFolder = workflowsByFolder[folder.id] || []
      const isExpanded = expandedFolders.has(folder.id)
      const hasChildren = workflowsInFolder.length > 0 || folder.children.length > 0

      const showBefore =
        dropIndicator?.targetId === folder.id && dropIndicator?.position === 'before'
      const showAfter = dropIndicator?.targetId === folder.id && dropIndicator?.position === 'after'
      const showInside =
        dropIndicator?.targetId === folder.id && dropIndicator?.position === 'inside'

      const childItems: Array<{
        type: 'folder' | 'workflow'
        id: string
        sortOrder: number
        createdAt?: Date
        data: FolderTreeNode | WorkflowMetadata
      }> = []
      for (const childFolder of folder.children) {
        childItems.push({
          type: 'folder',
          id: childFolder.id,
          sortOrder: childFolder.sortOrder,
          createdAt: childFolder.createdAt,
          data: childFolder,
        })
      }
      for (const workflow of workflowsInFolder) {
        childItems.push({
          type: 'workflow',
          id: workflow.id,
          sortOrder: workflow.sortOrder,
          createdAt: workflow.createdAt,
          data: workflow,
        })
      }
      childItems.sort(compareByOrder)

      return (
        <div key={folder.id} className='relative'>
          <DropIndicatorLine show={showBefore} level={level} position='before' />
          <div
            className={clsx(
              'pointer-events-none absolute inset-0 z-10 rounded-sm',
              showInside && isDragging ? 'bg-[var(--text-subtle)] opacity-10' : 'hidden'
            )}
          />
          <div
            style={{ paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}
            {...createFolderDragHandlers(folder.id, parentFolderId)}
          >
            <FolderItem
              workspaceId={workspaceId}
              folder={folder}
              pinned={pinnedFolderIds.has(folder.id)}
            />
          </div>
          <DropIndicatorLine show={showAfter} level={level} position='after' />

          {isExpanded && (hasChildren || isDragging) && (
            <div className='relative' {...createFolderContentDropZone(folder.id)}>
              <div
                className='pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--border)]'
                style={{ left: `${level * TREE_SPACING.INDENT_PER_LEVEL + 12}px` }}
              />
              <div className='mt-0.5 space-y-0.5 pl-0.5'>
                {childItems.map((item) =>
                  item.type === 'folder'
                    ? renderFolderSection(item.data as FolderTreeNode, level + 1, folder.id)
                    : renderWorkflowItem(item.data as WorkflowMetadata, level + 1, folder.id)
                )}
                {!hasChildren && isDragging && (
                  <div className='h-[24px]' {...createEmptyFolderDropZone(folder.id)} />
                )}
              </div>
            </div>
          )}
        </div>
      )
    },
    [
      workspaceId,
      workflowsByFolder,
      expandedFolders,
      dropIndicator,
      isDragging,
      createFolderDragHandlers,
      createEmptyFolderDropZone,
      createFolderContentDropZone,
      renderWorkflowItem,
      pinnedFolderIds,
    ]
  )

  const rootDropZoneHandlers = createRootDropZone()
  const rootWorkflows = workflowsByFolder.root || []

  const rootItems = useMemo(() => {
    const items: Array<{
      type: 'folder' | 'workflow'
      id: string
      sortOrder: number
      createdAt?: Date
      data: FolderTreeNode | WorkflowMetadata
    }> = []
    for (const folder of folderTree) {
      items.push({
        type: 'folder',
        id: folder.id,
        sortOrder: folder.sortOrder,
        createdAt: folder.createdAt,
        data: folder,
      })
    }
    for (const workflow of rootWorkflows) {
      items.push({
        type: 'workflow',
        id: workflow.id,
        sortOrder: workflow.sortOrder,
        createdAt: workflow.createdAt,
        data: workflow,
      })
    }
    return items.sort(compareByOrder)
  }, [folderTree, rootWorkflows])

  const hasRootItems = rootItems.length > 0
  const firstItemId = rootItems[0]?.id ?? null
  const lastItemId = rootItems[rootItems.length - 1]?.id ?? null
  const showRootInside = dropIndicator?.targetId === 'root' && dropIndicator?.position === 'inside'

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return
      const { selectOnly, clearAllSelection } = useFolderStore.getState()
      workflowId ? selectOnly(workflowId) : clearAllSelection()
    },
    [workflowId]
  )

  const handleContainerContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const isOnEmptyArea =
        target === e.currentTarget ||
        target.classList.contains('space-y-0.5') ||
        target.closest('[data-empty-area]')
      if (!isOnEmptyArea) return
      if (!onCreateWorkflow && !onCreateFolder) return
      handleEmptyAreaContextMenu(e)
    },
    [handleEmptyAreaContextMenu, onCreateWorkflow, onCreateFolder]
  )

  return (
    <SidebarListContext.Provider value={listContextValue}>
      <div
        role='tree'
        aria-label='Workflows'
        className='flex min-h-full flex-col pb-2'
        onClick={handleContainerClick}
        onContextMenu={handleContainerContextMenu}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target !== e.currentTarget) return
            const { selectOnly, clearAllSelection } = useFolderStore.getState()
            workflowId ? selectOnly(workflowId) : clearAllSelection()
          }
        }}
        data-empty-area
      >
        {pinnedEntries.length > 0 && (
          <div className='mb-2 flex flex-col'>
            <div className='mb-1 flex h-[18px] flex-shrink-0 items-center text-[var(--text-muted)] text-small'>
              Pinned
            </div>
            <div className='space-y-0.5'>
              {pinnedEntries.map((entry) =>
                entry.type === 'workflow' ? (
                  <WorkflowItem
                    key={`pinned-workflow-${entry.id}`}
                    workspaceId={workspaceId}
                    workflow={entry.data}
                    active={isWorkflowActive(entry.id)}
                    pinned
                  />
                ) : (
                  <FolderItem
                    key={`pinned-folder-${entry.id}`}
                    workspaceId={workspaceId}
                    folder={entry.data}
                    pinned
                  />
                )
              )}
            </div>
          </div>
        )}
        <div
          className={clsx('relative flex-1 rounded-sm', !hasRootItems && 'min-h-[26px]')}
          {...rootDropZoneHandlers}
          data-empty-area
        >
          <div
            className={clsx(
              'pointer-events-none absolute inset-0 z-10 rounded-sm',
              showRootInside && isDragging ? 'bg-[var(--text-subtle)] opacity-10' : 'hidden'
            )}
          />
          {isDragging && hasRootItems && (
            <div
              className='absolute top-0 right-0 left-0 z-30 h-[12px]'
              {...createEdgeDropZone(firstItemId, 'before')}
            />
          )}
          <div className='space-y-0.5' data-empty-area>
            {rootItems.map((item) =>
              item.type === 'folder'
                ? renderFolderSection(item.data as FolderTreeNode, 0, null)
                : renderWorkflowItem(item.data as WorkflowMetadata, 0, null)
            )}
          </div>
          {isDragging && hasRootItems && (
            <div
              className='absolute right-0 bottom-0 left-0 z-30 h-[12px]'
              {...createEdgeDropZone(lastItemId, 'after')}
            />
          )}
        </div>
      </div>

      {onCreateWorkflow && onCreateFolder && (
        <EmptyAreaContextMenu
          isOpen={isEmptyAreaMenuOpen}
          position={emptyAreaMenuPosition}
          menuRef={emptyAreaMenuRef}
          onClose={closeEmptyAreaMenu}
          onCreateWorkflow={onCreateWorkflow}
          onCreateFolder={onCreateFolder}
          disableCreateWorkflow={disableCreate}
          disableCreateFolder={disableCreate}
        />
      )}
    </SidebarListContext.Provider>
  )
})
