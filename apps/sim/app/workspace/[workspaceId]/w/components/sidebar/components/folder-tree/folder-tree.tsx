'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useParams, usePathname } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { createLogger } from '@/lib/logs/console/logger'
import { FolderItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/folder-tree/components/folder-item'
import { WorkflowItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/folder-tree/components/workflow-item'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const logger = createLogger('FolderTree')

interface FolderSectionProps {
  folder: FolderTreeNode
  level: number
  onCreateWorkflow: (folderId?: string) => void
  workflowsByFolder: Record<string, WorkflowMetadata[]>
  expandedFolders: Set<string>
  pathname: string
  updateWorkflow: (id: string, updates: Partial<WorkflowMetadata>) => Promise<void>
  updateFolder: (id: string, updates: any) => Promise<any>
  renderFolderTree: (
    nodes: FolderTreeNode[],
    level: number,
    parentDragOver?: boolean
  ) => React.ReactNode[]
  parentDragOver?: boolean
  isFirstItem?: boolean
}

// Helper function to count visible items, excluding content of the last expanded folder
const countVisibleItemsForLine = (
  folder: FolderTreeNode,
  workflowsByFolder: Record<string, WorkflowMetadata[]>,
  expandedFolders: Set<string>
): number => {
  if (!expandedFolders.has(folder.id)) {
    return 0 // Folder is collapsed, no visible children
  }

  let count = 0
  const workflowsInFolder = workflowsByFolder[folder.id] || []

  // Count workflows in this folder
  count += workflowsInFolder.length

  // Count child folders
  folder.children.forEach((childFolder, index) => {
    const isLastChildFolder = index === folder.children.length - 1
    // In the rendering order: workflows come first, then folders
    // So if this is the last child folder, it's the absolute last item
    const isAbsoluteLastItem = isLastChildFolder

    count += 1 // The folder itself

    // Only include expanded content if this is NOT the absolute last item
    if (!isAbsoluteLastItem) {
      count += countVisibleItemsForLine(childFolder, workflowsByFolder, expandedFolders)
    }
    // If this IS the last folder and it's expanded, we don't count its content
    // because the line should stop at this folder's connection point
  })

  return count
}

function FolderSection({
  folder,
  level,
  onCreateWorkflow,
  workflowsByFolder,
  expandedFolders,
  pathname,
  updateWorkflow,
  updateFolder,
  renderFolderTree,
  parentDragOver = false,
  isFirstItem = false,
}: FolderSectionProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { isDragOver, isInvalidDrop, handleDragOver, handleDragLeave, handleDrop } =
    useDragHandlers(
      updateWorkflow,
      updateFolder,
      folder.id,
      `Moved workflow(s) to folder ${folder.id}`
    )

  const workflowsInFolder = workflowsByFolder[folder.id] || []
  const isAnyDragOver = isDragOver || parentDragOver
  const hasChildren = workflowsInFolder.length > 0 || folder.children.length > 0
  const isExpanded = expandedFolders.has(folder.id)

  // Calculate the height for the vertical connecting line
  const visibleItemsCount = countVisibleItemsForLine(folder, workflowsByFolder, expandedFolders)
  const lineHeight = visibleItemsCount > 0 ? (visibleItemsCount - 1) * 36 + 24 : 0

  return (
    <div
      className={clsx(
        'relative',
        isDragOver &&
          (isInvalidDrop
            ? 'before:pointer-events-none before:absolute before:inset-0 before:rounded-[8px] before:border before:border-destructive/50 before:bg-destructive/15'
            : 'before:pointer-events-none before:absolute before:inset-0 before:rounded-[8px] before:border before:border-muted-foreground/50 before:bg-muted/20')
      )}
    >
      {/* Render folder */}
      <div style={{ paddingLeft: `${level * 20}px` }}>
        <FolderItem
          folder={folder}
          onCreateWorkflow={onCreateWorkflow}
          dragOver={isDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          isFirstItem={isFirstItem}
          level={level}
        />
      </div>

      {/* Render children with connecting lines */}
      {isExpanded && hasChildren && (
        <div className='relative'>
          {/* Vertical line from folder icon to children */}
          {(workflowsInFolder.length > 0 || folder.children.length > 0) && (
            <div
              className='pointer-events-none absolute'
              style={{
                left: `${level * 20 + 16}px`,
                top: '-9px',
                width: '1px',
                height: `${lineHeight}px`,
                background: 'hsl(var(--muted-foreground) / 0.3)',
                zIndex: 1,
              }}
            />
          )}

          {/* Render workflows in this folder */}
          {workflowsInFolder.length > 0 && (
            <div>
              {workflowsInFolder.map((workflow, index) => (
                <div key={workflow.id} className='relative'>
                  {/* Curved corner */}
                  <div
                    className='pointer-events-none absolute'
                    style={{
                      left: `${level * 20 + 16}px`,
                      top: '15px',
                      width: '4px',
                      height: '4px',
                      borderLeft: '1px solid hsl(var(--muted-foreground) / 0.3)',
                      borderBottom: '1px solid hsl(var(--muted-foreground) / 0.3)',
                      borderBottomLeftRadius: '4px',
                      zIndex: 1,
                    }}
                  />
                  {/* Horizontal line to workflow */}
                  <div
                    className='pointer-events-none absolute'
                    style={{
                      left: `${level * 20 + 20}px`,
                      top: '18px',
                      width: '7px',
                      height: '1px',
                      background: 'hsl(var(--muted-foreground) / 0.3)',
                      zIndex: 1,
                    }}
                  />
                  {/* Workflow container with proper indentation */}
                  <div style={{ paddingLeft: `${(level + 1) * 20 + 8}px` }}>
                    <WorkflowItem
                      workflow={workflow}
                      active={pathname === `/workspace/${workspaceId}/w/${workflow.id}`}
                      level={level}
                      isDragOver={isAnyDragOver}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Render child folders */}
          {folder.children.length > 0 && (
            <div>
              {folder.children.map((childFolder, index) => (
                <div key={childFolder.id} className='relative'>
                  {/* Curved corner */}
                  <div
                    className='pointer-events-none absolute'
                    style={{
                      left: `${level * 20 + 16}px`,
                      top: '15px',
                      width: '4px',
                      height: '4px',
                      borderLeft: '1px solid hsl(var(--muted-foreground) / 0.3)',
                      borderBottom: '1px solid hsl(var(--muted-foreground) / 0.3)',
                      borderBottomLeftRadius: '4px',
                      zIndex: 1,
                    }}
                  />
                  {/* Horizontal line to child folder */}
                  <div
                    className='pointer-events-none absolute'
                    style={{
                      left: `${level * 20 + 20}px`,
                      top: '18px',
                      width: '5px',
                      height: '1px',
                      background: 'hsl(var(--muted-foreground) / 0.3)',
                      zIndex: 1,
                    }}
                  />
                  <div style={{ paddingLeft: '8px' }}>
                    <FolderSection
                      key={childFolder.id}
                      folder={childFolder}
                      level={level + 1}
                      onCreateWorkflow={onCreateWorkflow}
                      workflowsByFolder={workflowsByFolder}
                      expandedFolders={expandedFolders}
                      pathname={pathname}
                      updateWorkflow={updateWorkflow}
                      updateFolder={updateFolder}
                      renderFolderTree={renderFolderTree}
                      parentDragOver={isAnyDragOver}
                      isFirstItem={false}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Custom hook for drag and drop handling
function useDragHandlers(
  updateWorkflow: (id: string, updates: Partial<WorkflowMetadata>) => Promise<void>,
  updateFolder: (id: string, updates: any) => Promise<any>,
  targetFolderId: string | null, // null for root
  logMessage?: string
) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isInvalidDrop, setIsInvalidDrop] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)

    // Check if this would be an invalid folder drop
    const draggedFolderId =
      (typeof window !== 'undefined' && (window as any).currentDragFolderId) || null

    if (draggedFolderId && targetFolderId) {
      const folderStore = useFolderStore.getState()
      const targetFolderPath = folderStore.getFolderPath(targetFolderId)

      // Check for circular reference
      const draggedFolderPath = folderStore.getFolderPath(draggedFolderId)
      const isCircular =
        targetFolderId === draggedFolderId ||
        draggedFolderPath.some((ancestor) => ancestor.id === targetFolderId)

      // Check for deep nesting - prevent triple nesting (folder -> folder -> folder)
      // targetFolderPath includes the target folder itself, so:
      // - length 1: root folder (allow drop - creates 2 levels: target -> dropped)
      // - length 2: nested folder (prevent drop - would create 3 levels: grandparent -> target -> dropped)
      const wouldBeTripleNested = targetFolderPath.length >= 2

      setIsInvalidDrop(isCircular || wouldBeTripleNested)
    } else {
      setIsInvalidDrop(false)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    setIsInvalidDrop(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    // Handle workflow drops
    const workflowIdsData = e.dataTransfer.getData('workflow-ids')
    if (workflowIdsData) {
      const workflowIds = JSON.parse(workflowIdsData) as string[]

      Promise.allSettled(
        workflowIds.map((workflowId) => updateWorkflow(workflowId, { folderId: targetFolderId }))
      )
        .then((results) => {
          const failures = results.filter((r) => r.status === 'rejected')

          if (failures.length === 0) {
            logger.info(logMessage || `Moved ${workflowIds.length} workflow(s)`)
          } else if (failures.length === workflowIds.length) {
            logger.error('Failed to move all workflows')
          } else {
            const successCount = results.length - failures.length
            logger.warn(`Partially moved workflows: ${successCount}/${workflowIds.length}`)
          }
        })
        .catch((error) => {
          logger.error('Unexpected error moving workflows:', error)
        })
    }

    // Handle folder drops
    const folderIdData = e.dataTransfer.getData('folder-id')
    if (folderIdData) {
      try {
        // Check if the target folder would create triple nesting
        const folderStore = useFolderStore.getState()
        const targetFolderPath = targetFolderId ? folderStore.getFolderPath(targetFolderId) : []

        // Prevent circular references - don't allow dropping a folder into itself or its descendants
        if (targetFolderId === folderIdData) {
          logger.info('Cannot move folder into itself')
          return
        }

        // Check if target folder is a descendant of the dragged folder
        const draggedFolderPath = folderStore.getFolderPath(folderIdData)
        if (
          targetFolderId &&
          draggedFolderPath.some((ancestor) => ancestor.id === targetFolderId)
        ) {
          logger.info('Cannot move folder into its own descendant')
          return
        }

        // Prevent triple nesting: folder -> folder -> folder
        // targetFolderPath includes the target folder itself, so:
        // - length 0: dropping into root (creates 1 level)
        // - length 1: dropping into root folder (creates 2 levels: target -> dropped) - allowed
        // - length 2+: dropping into nested folder (creates 3+ levels) - prevent
        if (targetFolderPath.length >= 2) {
          logger.info(
            'Cannot nest folder: Maximum 2 levels of nesting allowed (folder -> folder). Triple nesting prevented.'
          )
          return // Prevent the drop entirely
        }

        // Safe to nest - either dropping into root or into a root-level folder
        await updateFolder(folderIdData, { parentId: targetFolderId })
        logger.info(`Moved folder to ${targetFolderId ? `folder ${targetFolderId}` : 'root'}`)
      } catch (error) {
        logger.error('Failed to move folder:', error)
      }
    }
  }

  return {
    isDragOver,
    isInvalidDrop,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}

interface FolderTreeProps {
  regularWorkflows: WorkflowMetadata[]
  isLoading?: boolean
  onCreateWorkflow: (folderId?: string) => void
}

export function FolderTree({
  regularWorkflows,
  isLoading = false,
  onCreateWorkflow,
}: FolderTreeProps) {
  const pathname = usePathname()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string
  const {
    getFolderTree,
    expandedFolders,
    fetchFolders,
    isLoading: foldersLoading,
    clearSelection,
    updateFolderAPI,
    getFolderPath,
    setExpanded,
  } = useFolderStore()
  const { updateWorkflow } = useWorkflowRegistry()

  // Memoize the active workflow's folder ID to avoid unnecessary re-runs
  const activeWorkflowFolderId = useMemo(() => {
    if (!workflowId || isLoading || foldersLoading) return null
    const activeWorkflow = regularWorkflows.find((workflow) => workflow.id === workflowId)
    return activeWorkflow?.folderId || null
  }, [workflowId, regularWorkflows, isLoading, foldersLoading])

  // Auto-expand folders when a workflow is active
  useEffect(() => {
    if (!activeWorkflowFolderId) return

    // Get the folder path from root to the workflow's folder
    const folderPath = getFolderPath(activeWorkflowFolderId)

    // Expand all folders in the path (only if not already expanded)
    folderPath.forEach((folder) => {
      if (!expandedFolders.has(folder.id)) {
        setExpanded(folder.id, true)
      }
    })
  }, [activeWorkflowFolderId, getFolderPath, setExpanded])

  // Clean up any existing folders with 3+ levels of nesting
  const cleanupDeepNesting = useCallback(async () => {
    const { getFolderTree, updateFolderAPI } = useFolderStore.getState()
    const folderTree = getFolderTree(workspaceId)

    const findDeepFolders = (nodes: FolderTreeNode[], currentLevel = 0): FolderTreeNode[] => {
      let deepFolders: FolderTreeNode[] = []

      for (const node of nodes) {
        if (currentLevel >= 2) {
          // This folder is at level 2+ (triple nested), add it to cleanup list
          // Level 0: root folders, Level 1: nested in root folders (allowed)
          // Level 2+: triple nested (not allowed)
          deepFolders.push(node)
        } else {
          // Recursively check children
          deepFolders = deepFolders.concat(findDeepFolders(node.children, currentLevel + 1))
        }
      }

      return deepFolders
    }

    const deepFolders = findDeepFolders(folderTree)

    // Move deeply nested folders to root level
    for (const folder of deepFolders) {
      try {
        await updateFolderAPI(folder.id, { parentId: null })
        logger.info(`Moved deeply nested folder "${folder.name}" to root level`)
      } catch (error) {
        logger.error(`Failed to move folder "${folder.name}":`, error)
      }
    }
  }, [workspaceId])

  // Fetch folders when workspace changes
  useEffect(() => {
    if (workspaceId) {
      fetchFolders(workspaceId).then(() => {
        // Clean up any existing deep nesting after folders are loaded
        cleanupDeepNesting()
      })
    }
  }, [workspaceId, fetchFolders, cleanupDeepNesting])

  useEffect(() => {
    clearSelection()
  }, [workspaceId, clearSelection])

  const folderTree = workspaceId ? getFolderTree(workspaceId) : []

  // Group workflows by folder
  const workflowsByFolder = regularWorkflows.reduce(
    (acc, workflow) => {
      const folderId = workflow.folderId || 'root'
      if (!acc[folderId]) acc[folderId] = []
      acc[folderId].push(workflow)
      return acc
    },
    {} as Record<string, WorkflowMetadata[]>
  )

  const {
    isDragOver: rootDragOver,
    isInvalidDrop: rootInvalidDrop,
    handleDragOver: handleRootDragOver,
    handleDragLeave: handleRootDragLeave,
    handleDrop: handleRootDrop,
  } = useDragHandlers(updateWorkflow, updateFolderAPI, null, 'Moved workflow(s) to root')

  const renderFolderTree = (
    nodes: FolderTreeNode[],
    level = 0,
    parentDragOver = false
  ): React.ReactNode[] => {
    return nodes.map((folder, index) => (
      <FolderSection
        key={folder.id}
        folder={folder}
        level={level}
        onCreateWorkflow={onCreateWorkflow}
        workflowsByFolder={workflowsByFolder}
        expandedFolders={expandedFolders}
        pathname={pathname}
        updateWorkflow={updateWorkflow}
        updateFolder={updateFolderAPI}
        renderFolderTree={renderFolderTree}
        parentDragOver={parentDragOver}
        isFirstItem={level === 0 && index === 0}
      />
    ))
  }

  const showLoading = isLoading || foldersLoading
  const rootWorkflows = workflowsByFolder.root || []

  // Render skeleton loading state
  const renderSkeletonLoading = () => {
    return (
      <div className='space-y-1 py-2'>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className='flex h-8 items-center rounded-lg px-2 py-2'>
            <Skeleton className='mr-2 h-4 w-4 rounded' />
            <Skeleton className='h-4 max-w-32 flex-1' />
          </div>
        ))}
      </div>
    )
  }

  if (showLoading) {
    return renderSkeletonLoading()
  }

  return (
    <div className='flex h-full flex-col pt-2 pb-[6px]'>
      {/* Folder tree */}
      <div className='space-y-1'>{renderFolderTree(folderTree, 0, false)}</div>

      {/* Root level workflows and drop zone - fills remaining space */}
      <div
        className={clsx(
          'relative flex-1',
          rootDragOver &&
            (rootInvalidDrop
              ? 'before:pointer-events-none before:absolute before:inset-0 before:rounded-[8px] before:border before:border-destructive/50 before:bg-destructive/15'
              : 'before:pointer-events-none before:absolute before:inset-0 before:rounded-[8px] before:border before:border-muted-foreground/50 before:bg-muted/20'),
          // Ensure minimum height for drag target when empty
          rootWorkflows.length === 0 ? 'min-h-8' : ''
        )}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        <div className='space-y-1'>
          {rootWorkflows.map((workflow, index) => (
            <WorkflowItem
              key={workflow.id}
              workflow={workflow}
              active={pathname === `/workspace/${workspaceId}/w/${workflow.id}`}
              level={-1}
              isDragOver={rootDragOver}
              isFirstItem={folderTree.length === 0 && index === 0}
            />
          ))}

          {/* Empty state */}
          {!showLoading && regularWorkflows.length === 0 && folderTree.length === 0 && (
            <div className='break-words px-2 py-1.5 pr-12 text-muted-foreground text-xs'>
              No workflows or folders in {workspaceId ? 'this workspace' : 'your account'}. Create
              one to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
