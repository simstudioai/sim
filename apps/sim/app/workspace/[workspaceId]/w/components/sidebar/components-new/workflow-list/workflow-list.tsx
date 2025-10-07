'use client'

import { useCallback, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { useParams, usePathname } from 'next/navigation'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useDragDrop } from '../../hooks/use-drag-drop'
import { useWorkflowImport } from '../../hooks/use-workflow-import'
import { FolderItem } from './components/folder-item/folder-item'
import { WorkflowItem } from './components/workflow-item/workflow-item'

/**
 * Constants for tree layout and styling
 */
const TREE_SPACING = {
  INDENT_PER_LEVEL: 20,
  VERTICAL_LINE_LEFT_OFFSET: 4,
  ITEM_GAP: 4,
  ITEM_HEIGHT: 25,
} as const

const TREE_STYLES = {
  LINE_COLOR: 'hsl(var(--muted-foreground) / 0.2)',
} as const

interface WorkflowListProps {
  regularWorkflows: WorkflowMetadata[]
  isLoading?: boolean
  isImporting: boolean
  setIsImporting: (value: boolean) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * WorkflowList component displays workflows organized by folders with drag-and-drop support.
 * Uses the workflow import hook for handling JSON imports.
 *
 * @param props - Component props
 * @returns Workflow list with folders and drag-drop support
 */
export function WorkflowList({
  regularWorkflows,
  isLoading = false,
  isImporting,
  setIsImporting,
  fileInputRef,
  scrollContainerRef,
}: WorkflowListProps) {
  const pathname = usePathname()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string

  const {
    getFolderTree,
    expandedFolders,
    fetchFolders,
    isLoading: foldersLoading,
    getFolderPath,
    setExpanded,
  } = useFolderStore()

  const {
    dropTargetId,
    isDragging,
    setScrollContainer,
    createFolderDragHandlers,
    createItemDragHandlers,
    createRootDragHandlers,
    createFolderHeaderHoverHandlers,
  } = useDragDrop()

  // Workflow import hook
  const { handleFileChange } = useWorkflowImport({ workspaceId })

  // Set scroll container when ref changes
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

  const workflowsByFolder = useMemo(
    () =>
      regularWorkflows.reduce(
        (acc, workflow) => {
          const folderId = workflow.folderId || 'root'
          if (!acc[folderId]) acc[folderId] = []
          acc[folderId].push(workflow)
          return acc
        },
        {} as Record<string, WorkflowMetadata[]>
      ),
    [regularWorkflows]
  )

  const isWorkflowActive = useCallback(
    (workflowId: string) => pathname === `/workspace/${workspaceId}/w/${workflowId}`,
    [pathname, workspaceId]
  )

  /**
   * Auto-expand folders to show the active workflow
   */
  useEffect(() => {
    if (!activeWorkflowFolderId) return
    const folderPath = getFolderPath(activeWorkflowFolderId)
    for (const folder of folderPath) {
      setExpanded(folder.id, true)
    }
  }, [activeWorkflowFolderId, getFolderPath, setExpanded])

  /**
   * Fetch folders when workspace changes
   */
  useEffect(() => {
    if (workspaceId) {
      fetchFolders(workspaceId)
    }
  }, [workspaceId, fetchFolders])

  const renderWorkflowItem = useCallback(
    (workflow: WorkflowMetadata, level: number, parentFolderId: string | null = null) => (
      <div key={workflow.id} className='relative' {...createItemDragHandlers(parentFolderId)}>
        <div
          style={{
            paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px`,
          }}
        >
          <WorkflowItem workflow={workflow} active={isWorkflowActive(workflow.id)} level={level} />
        </div>
      </div>
    ),
    [isWorkflowActive, createItemDragHandlers]
  )

  /**
   * Calculate the height of the vertical line for folder trees
   *
   * @param workflowCount - Number of workflows in the folder
   * @param folderCount - Number of child folders
   * @returns Height string in pixels
   */
  const calculateVerticalLineHeight = useCallback((workflowCount: number, folderCount: number) => {
    // If there are workflows, line extends only to the bottom of the last workflow
    if (workflowCount > 0) {
      // Account for: all workflows + gaps between workflows (no extra margin)
      const totalHeight =
        workflowCount * TREE_SPACING.ITEM_HEIGHT + (workflowCount - 1) * TREE_SPACING.ITEM_GAP
      return `${totalHeight}px`
    }

    // If no workflows but there are child folders, extend to folders
    if (folderCount > 0) {
      const totalHeight =
        folderCount * TREE_SPACING.ITEM_HEIGHT + (folderCount - 1) * TREE_SPACING.ITEM_GAP
      return `${totalHeight}px`
    }

    return '0px'
  }, [])

  const renderFolderSection = useCallback(
    (
      folder: FolderTreeNode,
      level: number,
      parentFolderId: string | null = null
    ): React.ReactNode => {
      const workflowsInFolder = workflowsByFolder[folder.id] || []
      const isExpanded = expandedFolders.has(folder.id)
      const hasChildren = workflowsInFolder.length > 0 || folder.children.length > 0
      const isDropTarget = dropTargetId === folder.id

      return (
        <div key={folder.id} className='relative' {...createFolderDragHandlers(folder.id)}>
          {/* Drop target highlight overlay - always rendered for stable DOM */}
          <div
            className={clsx(
              'pointer-events-none absolute inset-0 z-10 rounded-[4px] transition-opacity duration-75',
              isDropTarget && isDragging ? 'bg-gray-400/20 opacity-100' : 'opacity-0'
            )}
          />

          <div
            style={{ paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}
            {...createItemDragHandlers(folder.id)}
          >
            <FolderItem
              folder={folder}
              level={level}
              hoverHandlers={createFolderHeaderHoverHandlers(folder.id)}
            />
          </div>

          {isExpanded && hasChildren && (
            <div className='relative'>
              {/* Vertical line from folder bottom extending through all children - only shown if folder has workflows */}
              {workflowsInFolder.length > 0 && (
                <div
                  className='pointer-events-none absolute'
                  style={{
                    left: `${level * TREE_SPACING.INDENT_PER_LEVEL + TREE_SPACING.VERTICAL_LINE_LEFT_OFFSET}px`,
                    top: '0px', // Start immediately after folder item
                    width: '1px',
                    height: calculateVerticalLineHeight(
                      workflowsInFolder.length,
                      folder.children.length
                    ),
                    background: TREE_STYLES.LINE_COLOR,
                  }}
                />
              )}

              {workflowsInFolder.length > 0 && (
                <div className='mt-[2px] space-y-[4px]'>
                  {workflowsInFolder.map((workflow: WorkflowMetadata) =>
                    renderWorkflowItem(workflow, level + 1, folder.id)
                  )}
                </div>
              )}

              {folder.children.length > 0 && (
                <div
                  className={clsx('space-y-[4px]', workflowsInFolder.length > 0 ? 'mt-[2px]' : '')}
                >
                  {folder.children.map((childFolder) => (
                    <div key={childFolder.id} className='relative'>
                      {renderFolderSection(childFolder, level + 1, folder.id)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )
    },
    [
      workflowsByFolder,
      expandedFolders,
      dropTargetId,
      isDragging,
      createFolderDragHandlers,
      createItemDragHandlers,
      createFolderHeaderHoverHandlers,
      calculateVerticalLineHeight,
      renderWorkflowItem,
    ]
  )

  const handleRootDragEvents = createRootDragHandlers()
  const rootWorkflows = workflowsByFolder.root || []
  const isRootDropTarget = dropTargetId === 'root'
  const hasRootWorkflows = rootWorkflows.length > 0
  const hasFolders = folderTree.length > 0

  return (
    <div className='flex flex-col pb-[8px]'>
      {/* Folders Section */}
      {hasFolders && (
        <div className='mb-[4px] space-y-[4px]'>
          {folderTree.map((folder) => renderFolderSection(folder, 0))}
        </div>
      )}

      {/* Root Workflows Section */}
      <div
        className={clsx(
          'relative',
          !hasRootWorkflows && 'min-h-[25px]' // Only apply min-height when empty
        )}
        {...handleRootDragEvents}
      >
        {/* Root drop target highlight overlay - always rendered for stable DOM */}
        <div
          className={clsx(
            'pointer-events-none absolute inset-0 z-10 rounded-[4px] transition-opacity duration-75',
            isRootDropTarget && isDragging ? 'bg-gray-400/20 opacity-100' : 'opacity-0'
          )}
        />

        <div className='space-y-[4px]'>
          {rootWorkflows.map((workflow: WorkflowMetadata) => (
            <WorkflowItem
              key={workflow.id}
              workflow={workflow}
              active={isWorkflowActive(workflow.id)}
              level={0}
            />
          ))}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type='file'
        accept='.json'
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}
