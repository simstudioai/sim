'use client'

import { memo, useCallback, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { useParams, usePathname } from 'next/navigation'
import { FolderItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/folder-item/folder-item'
import { WorkflowItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/workflow-item/workflow-item'
import {
  useDragDrop,
  useWorkflowSelection,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useFolders } from '@/hooks/queries/folders'
import { useFolderStore } from '@/stores/folders/store'
import type { FolderTreeNode } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const TREE_SPACING = {
  INDENT_PER_LEVEL: 20,
} as const

function compareByOrder<T extends { sortOrder: number; createdAt?: Date; id: string }>(
  a: T,
  b: T
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const timeA = a.createdAt?.getTime() ?? 0
  const timeB = b.createdAt?.getTime() ?? 0
  if (timeA !== timeB) return timeA - timeB
  return a.id.localeCompare(b.id)
}

interface WorkflowListProps {
  regularWorkflows: WorkflowMetadata[]
  isLoading?: boolean
  canReorder?: boolean
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

const DropIndicatorLine = memo(function DropIndicatorLine({
  show,
  level = 0,
}: {
  show: boolean
  level?: number
}) {
  if (!show) return null
  return (
    <div
      className='pointer-events-none absolute right-0 left-0 z-20 flex items-center'
      style={{ paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}
    >
      <div className='h-[2px] flex-1 rounded-full bg-[#33b4ff]/70' />
    </div>
  )
})

export function WorkflowList({
  regularWorkflows,
  isLoading = false,
  canReorder = true,
  handleFileChange,
  fileInputRef,
  scrollContainerRef,
}: WorkflowListProps) {
  const pathname = usePathname()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string

  const { isLoading: foldersLoading } = useFolders(workspaceId)
  const { getFolderTree, expandedFolders, getFolderPath, setExpanded } = useFolderStore()

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
    handleDragStart,
    handleDragEnd,
  } = useDragDrop({ disabled: !canReorder })

  useEffect(() => {
    if (scrollContainerRef.current) {
      setScrollContainer(scrollContainerRef.current)
    }
  }, [scrollContainerRef, setScrollContainer])

  const folderTree = workspaceId ? getFolderTree(workspaceId) : []

  const activeWorkflowFolderId = useMemo(() => {
    if (!workflowId || isLoading || foldersLoading) return null
    const activeWorkflow = regularWorkflows.find((workflow) => workflow.id === workflowId)
    return activeWorkflow?.folderId || null
  }, [workflowId, regularWorkflows, isLoading, foldersLoading])

  const workflowsByFolder = useMemo(() => {
    const grouped = regularWorkflows.reduce(
      (acc, workflow) => {
        const folderId = workflow.folderId || 'root'
        if (!acc[folderId]) acc[folderId] = []
        acc[folderId].push(workflow)
        return acc
      },
      {} as Record<string, WorkflowMetadata[]>
    )
    for (const folderId of Object.keys(grouped)) {
      grouped[folderId].sort(compareByOrder)
    }
    return grouped
  }, [regularWorkflows])

  const orderedWorkflowIds = useMemo(() => {
    const ids: string[] = []

    const collectWorkflowIds = (folder: FolderTreeNode) => {
      const workflowsInFolder = workflowsByFolder[folder.id] || []
      for (const workflow of workflowsInFolder) {
        ids.push(workflow.id)
      }
      for (const childFolder of folder.children) {
        collectWorkflowIds(childFolder)
      }
    }

    for (const folder of folderTree) {
      collectWorkflowIds(folder)
    }

    const rootWorkflows = workflowsByFolder.root || []
    for (const workflow of rootWorkflows) {
      ids.push(workflow.id)
    }

    return ids
  }, [folderTree, workflowsByFolder])

  const { handleWorkflowClick } = useWorkflowSelection({
    workflowIds: orderedWorkflowIds,
    activeWorkflowId: workflowId,
  })

  const isWorkflowActive = useCallback(
    (wfId: string) => pathname === `/workspace/${workspaceId}/w/${wfId}`,
    [pathname, workspaceId]
  )

  useEffect(() => {
    if (!workflowId || isLoading || foldersLoading) return

    if (activeWorkflowFolderId) {
      const folderPath = getFolderPath(activeWorkflowFolderId)
      folderPath.forEach((folder) => setExpanded(folder.id, true))
    }

    const { selectedWorkflows, selectOnly } = useFolderStore.getState()
    if (!selectedWorkflows.has(workflowId)) {
      selectOnly(workflowId)
    }
  }, [workflowId, activeWorkflowFolderId, isLoading, foldersLoading, getFolderPath, setExpanded])

  const renderWorkflowItem = useCallback(
    (workflow: WorkflowMetadata, level: number, folderId: string | null = null) => {
      const showBefore =
        dropIndicator?.targetId === workflow.id && dropIndicator?.position === 'before'
      const showAfter =
        dropIndicator?.targetId === workflow.id && dropIndicator?.position === 'after'

      return (
        <div key={workflow.id} className='relative'>
          <DropIndicatorLine show={showBefore} level={level} />
          <div
            style={{ paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}
            {...createWorkflowDragHandlers(workflow.id, folderId)}
          >
            <WorkflowItem
              workflow={workflow}
              active={isWorkflowActive(workflow.id)}
              level={level}
              dragDisabled={dragDisabled}
              onWorkflowClick={handleWorkflowClick}
              onDragStart={() => handleDragStart('workflow', folderId)}
              onDragEnd={handleDragEnd}
            />
          </div>
          <DropIndicatorLine show={showAfter} level={level} />
        </div>
      )
    },
    [
      dropIndicator,
      isWorkflowActive,
      dragDisabled,
      createWorkflowDragHandlers,
      handleWorkflowClick,
      handleDragStart,
      handleDragEnd,
    ]
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
          <DropIndicatorLine show={showBefore} level={level} />
          {/* Drop target highlight overlay - covers entire folder section */}
          <div
            className={clsx(
              'pointer-events-none absolute inset-0 z-10 rounded-[4px] transition-opacity duration-75',
              showInside && isDragging ? 'bg-[#33b4ff1a] opacity-100' : 'opacity-0'
            )}
          />
          <div
            style={{ paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}
            {...createFolderDragHandlers(folder.id, parentFolderId)}
          >
            <FolderItem
              folder={folder}
              level={level}
              dragDisabled={dragDisabled}
              onDragStart={() => handleDragStart('folder', parentFolderId)}
              onDragEnd={handleDragEnd}
            />
          </div>
          <DropIndicatorLine show={showAfter} level={level} />

          {isExpanded && (hasChildren || isDragging) && (
            <div className='relative' {...createFolderContentDropZone(folder.id)}>
              <div
                className='pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--border)]'
                style={{ left: `${level * TREE_SPACING.INDENT_PER_LEVEL + 12}px` }}
              />
              <div className='mt-[2px] space-y-[2px] pl-[2px]'>
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
      workflowsByFolder,
      expandedFolders,
      dropIndicator,
      isDragging,
      dragDisabled,
      createFolderDragHandlers,
      createEmptyFolderDropZone,
      createFolderContentDropZone,
      handleDragStart,
      handleDragEnd,
      renderWorkflowItem,
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
  const showRootInside = dropIndicator?.targetId === 'root' && dropIndicator?.position === 'inside'

  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return
      const { selectOnly, clearSelection } = useFolderStore.getState()
      workflowId ? selectOnly(workflowId) : clearSelection()
    },
    [workflowId]
  )

  return (
    <div className='flex min-h-full flex-col pb-[8px]' onClick={handleContainerClick}>
      <div
        className={clsx('relative flex-1 rounded-[4px]', !hasRootItems && 'min-h-[26px]')}
        {...rootDropZoneHandlers}
      >
        {/* Root drop target highlight overlay */}
        <div
          className={clsx(
            'pointer-events-none absolute inset-0 z-10 rounded-[4px] transition-opacity duration-75',
            showRootInside && isDragging ? 'bg-[#33b4ff1a] opacity-100' : 'opacity-0'
          )}
        />
        <div className='space-y-[2px]'>
          {rootItems.map((item) =>
            item.type === 'folder'
              ? renderFolderSection(item.data as FolderTreeNode, 0, null)
              : renderWorkflowItem(item.data as WorkflowMetadata, 0, null)
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type='file'
        accept='.json,.zip'
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}
