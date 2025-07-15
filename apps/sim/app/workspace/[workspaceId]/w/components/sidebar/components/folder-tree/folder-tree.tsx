'use client'

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { useParams, usePathname } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { FolderItem } from './components/folder-item'
import { WorkflowItem } from './components/workflow-item'

interface FolderSectionProps {
  folder: FolderTreeNode
  level: number
  isCollapsed: boolean
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

function FolderSection({
  folder,
  level,
  isCollapsed,
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

  return (
    <div
      className={clsx(
        isDragOver
          ? isInvalidDrop
            ? 'rounded-md bg-red-500/10 dark:bg-red-400/10'
            : 'rounded-md bg-blue-500/10 dark:bg-blue-400/10'
          : ''
      )}
      style={
        isDragOver
          ? {
              boxShadow: isInvalidDrop
                ? 'inset 0 0 0 1px rgb(239 68 68 / 0.5)'
                : 'inset 0 0 0 1px rgb(59 130 246 / 0.5)',
            }
          : {}
      }
    >
      {/* Render folder */}
      <div style={{ paddingLeft: isCollapsed ? '0px' : `${level * 20}px` }}>
        <FolderItem
          folder={folder}
          isCollapsed={isCollapsed}
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
          {!isCollapsed && (workflowsInFolder.length > 0 || folder.children.length > 0) && (
            <div
              className='pointer-events-none absolute'
              style={{
                left: `${level * 20 + 16}px`,
                top: '-9px',
                width: '1px',
                height: `${(workflowsInFolder.length + folder.children.length - 1) * 40 + 24}px`,
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
                  {!isCollapsed && (
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
                  )}
                  {/* Horizontal line to workflow */}
                  {!isCollapsed && (
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
                  )}
                  {/* Workflow container with proper indentation */}
                  <div style={{ paddingLeft: isCollapsed ? '0px' : `${(level + 1) * 20 + 8}px` }}>
                    <WorkflowItem
                      workflow={workflow}
                      active={pathname === `/workspace/${workspaceId}/w/${workflow.id}`}
                      isCollapsed={isCollapsed}
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
                  {!isCollapsed && (
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
                  )}
                  {/* Horizontal line to child folder */}
                  {!isCollapsed && (
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
                  )}
                  <div style={{ paddingLeft: isCollapsed ? '0px' : '8px' }}>
                    <FolderSection
                      key={childFolder.id}
                      folder={childFolder}
                      level={level + 1}
                      isCollapsed={isCollapsed}
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

      // Check for deep nesting (target folder already has a parent)
      const wouldBeDeepNesting = targetFolderPath.length >= 1

      setIsInvalidDrop(isCircular || wouldBeDeepNesting)
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

      try {
        // Update workflows sequentially to avoid race conditions
        for (const workflowId of workflowIds) {
          await updateWorkflow(workflowId, { folderId: targetFolderId })
        }
        console.log(logMessage || `Moved ${workflowIds.length} workflow(s)`)
      } catch (error) {
        console.error('Failed to move workflows:', error)
      }
    }

    // Handle folder drops
    const folderIdData = e.dataTransfer.getData('folder-id')
    if (folderIdData) {
      try {
        // Check if the target folder would create more than 2 levels of nesting
        const folderStore = useFolderStore.getState()
        const targetFolderPath = targetFolderId ? folderStore.getFolderPath(targetFolderId) : []

        // Prevent circular references - don't allow dropping a folder into itself or its descendants
        if (targetFolderId === folderIdData) {
          console.log('Cannot move folder into itself')
          return
        }

        // Check if target folder is a descendant of the dragged folder
        const draggedFolderPath = folderStore.getFolderPath(folderIdData)
        if (
          targetFolderId &&
          draggedFolderPath.some((ancestor) => ancestor.id === targetFolderId)
        ) {
          console.log('Cannot move folder into its own descendant')
          return
        }

        // If target folder is already at level 1 (has 1 parent), we can't nest another folder
        if (targetFolderPath.length >= 1) {
          console.log('Cannot nest folder: Maximum 2 levels of nesting allowed. Drop prevented.')
          return // Prevent the drop entirely
        }

        // Target folder is at root level, safe to nest
        await updateFolder(folderIdData, { parentId: targetFolderId })
        console.log(`Moved folder to ${targetFolderId ? `folder ${targetFolderId}` : 'root'}`)
      } catch (error) {
        console.error('Failed to move folder:', error)
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
  marketplaceWorkflows: WorkflowMetadata[]
  isCollapsed?: boolean
  isLoading?: boolean
  onCreateWorkflow: (folderId?: string) => void
}

export function FolderTree({
  regularWorkflows,
  marketplaceWorkflows,
  isCollapsed = false,
  isLoading = false,
  onCreateWorkflow,
}: FolderTreeProps) {
  const pathname = usePathname()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const {
    getFolderTree,
    expandedFolders,
    fetchFolders,
    isLoading: foldersLoading,
    clearSelection,
    updateFolderAPI,
  } = useFolderStore()
  const { updateWorkflow } = useWorkflowRegistry()

  // Clean up any existing folders with 3+ levels of nesting
  const cleanupDeepNesting = useCallback(async () => {
    const { getFolderTree, updateFolderAPI } = useFolderStore.getState()
    const folderTree = getFolderTree(workspaceId)

    const findDeepFolders = (nodes: FolderTreeNode[], currentLevel = 0): FolderTreeNode[] => {
      let deepFolders: FolderTreeNode[] = []

      for (const node of nodes) {
        if (currentLevel >= 2) {
          // This folder is at level 2+ (too deep), add it to cleanup list
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
        console.log(`Moved deeply nested folder "${folder.name}" to root level`)
      } catch (error) {
        console.error(`Failed to move folder "${folder.name}":`, error)
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
        isCollapsed={isCollapsed}
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
    if (isCollapsed) {
      return (
        <div className='space-y-1 py-2'>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className='mx-auto mb-1 flex h-9 w-9 items-center justify-center'>
              <Skeleton className='h-4 w-4 rounded' />
            </div>
          ))}
        </div>
      )
    }

    return (
      <div className='space-y-1 py-2'>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className='flex h-9 items-center rounded-lg px-2 py-2'>
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
    <div className='space-y-1 py-2'>
      {/* Folder tree */}
      {renderFolderTree(folderTree, 0, false)}

      {/* Root level workflows (no folder) */}
      <div
        className={clsx(
          'space-y-1',
          rootDragOver
            ? rootInvalidDrop
              ? 'rounded-md bg-red-500/10 dark:bg-red-400/10'
              : 'rounded-md bg-blue-500/10 dark:bg-blue-400/10'
            : '',
          // Always provide minimal drop zone when root is empty, but keep it subtle
          rootWorkflows.length === 0 ? 'min-h-2 py-1' : ''
        )}
        style={
          rootDragOver
            ? {
                boxShadow: rootInvalidDrop
                  ? 'inset 0 0 0 1px rgb(239 68 68 / 0.5)'
                  : 'inset 0 0 0 1px rgb(59 130 246 / 0.5)',
              }
            : {}
        }
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {rootWorkflows.map((workflow, index) => (
          <WorkflowItem
            key={workflow.id}
            workflow={workflow}
            active={pathname === `/workspace/${workspaceId}/w/${workflow.id}`}
            isCollapsed={isCollapsed}
            level={-1}
            isDragOver={rootDragOver}
            isFirstItem={folderTree.length === 0 && index === 0}
          />
        ))}
      </div>

      {/* Empty state */}
      {!showLoading &&
        regularWorkflows.length === 0 &&
        marketplaceWorkflows.length === 0 &&
        folderTree.length === 0 &&
        !isCollapsed && (
          <div className='break-words px-2 py-1.5 text-muted-foreground text-xs'>
            No workflows or folders in {workspaceId ? 'this workspace' : 'your account'}. Create one
            to get started.
          </div>
        )}
    </div>
  )
}
