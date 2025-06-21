'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
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
  renderFolderTree: (
    nodes: FolderTreeNode[],
    level: number,
    parentDragOver?: boolean
  ) => React.ReactNode[]
  parentDragOver?: boolean
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
  renderFolderTree,
  parentDragOver = false,
}: FolderSectionProps) {
  const { isDragOver, handleDragOver, handleDragLeave, handleDrop } = useDragHandlers(
    updateWorkflow,
    folder.id,
    `Moved workflow(s) to folder ${folder.id}`
  )

  const workflowsInFolder = workflowsByFolder[folder.id] || []
  const isAnyDragOver = isDragOver || parentDragOver

  return (
    <div
      className={clsx(isDragOver ? 'rounded-md bg-blue-500/10 dark:bg-blue-400/10' : '')}
      style={
        isDragOver
          ? {
              boxShadow: 'inset 0 0 0 1px rgb(59 130 246 / 0.5)',
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
        />
      </div>

      {/* Render workflows in this folder */}
      {expandedFolders.has(folder.id) && workflowsInFolder.length > 0 && (
        <div className='space-y-0.5'>
          {workflowsInFolder.map((workflow) => (
            <WorkflowItem
              key={workflow.id}
              workflow={workflow}
              active={pathname === `/w/${workflow.id}`}
              isCollapsed={isCollapsed}
              level={level}
              isDragOver={isAnyDragOver}
            />
          ))}
        </div>
      )}

      {/* Render child folders */}
      {expandedFolders.has(folder.id) && folder.children.length > 0 && (
        <div>{renderFolderTree(folder.children, level + 1, isAnyDragOver)}</div>
      )}
    </div>
  )
}

// Custom hook for drag and drop handling
function useDragHandlers(
  updateWorkflow: (id: string, updates: Partial<WorkflowMetadata>) => Promise<void>,
  targetFolderId: string | null, // null for root
  logMessage?: string
) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

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
  }

  return {
    isDragOver,
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
  const { activeWorkspaceId } = useWorkflowRegistry()
  const {
    getFolderTree,
    expandedFolders,
    fetchFolders,
    isLoading: foldersLoading,
    clearSelection,
  } = useFolderStore()
  const { updateWorkflow } = useWorkflowRegistry()

  // Fetch folders when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      fetchFolders(activeWorkspaceId)
    }
  }, [activeWorkspaceId, fetchFolders])

  useEffect(() => {
    clearSelection()
  }, [activeWorkspaceId, clearSelection])

  const folderTree = activeWorkspaceId ? getFolderTree(activeWorkspaceId) : []

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
    handleDragOver: handleRootDragOver,
    handleDragLeave: handleRootDragLeave,
    handleDrop: handleRootDrop,
  } = useDragHandlers(updateWorkflow, null, 'Moved workflow(s) to root')

  const renderFolderTree = (
    nodes: FolderTreeNode[],
    level = 0,
    parentDragOver = false
  ): React.ReactNode[] => {
    return nodes.map((folder) => (
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
        renderFolderTree={renderFolderTree}
        parentDragOver={parentDragOver}
      />
    ))
  }

  const showLoading = isLoading || foldersLoading

  return (
    <div
      className={`space-y-0.5 transition-opacity duration-200 ${showLoading ? 'opacity-60' : ''}`}
    >
      {/* Folder tree */}
      {renderFolderTree(folderTree)}

      {/* Root level workflows (no folder) */}
      <div
        className={clsx(
          'space-y-0.5',
          rootDragOver ? 'rounded-md bg-blue-500/10 dark:bg-blue-400/10' : '',
          // Always provide minimal drop zone when root is empty, but keep it subtle
          (workflowsByFolder.root || []).length === 0 ? 'min-h-2 py-1' : ''
        )}
        style={
          rootDragOver
            ? {
                boxShadow: 'inset 0 0 0 1px rgb(59 130 246 / 0.5)',
              }
            : {}
        }
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {(workflowsByFolder.root || []).map((workflow) => (
          <WorkflowItem
            key={workflow.id}
            workflow={workflow}
            active={pathname === `/w/${workflow.id}`}
            isCollapsed={isCollapsed}
            level={-1}
            isDragOver={rootDragOver}
          />
        ))}
      </div>

      {/* Marketplace workflows */}
      {marketplaceWorkflows.length > 0 && (
        <div className='mt-2 border-border/30 border-t pt-2'>
          <h3
            className={`mb-1 px-2 font-medium text-muted-foreground text-xs ${
              isCollapsed ? 'text-center' : ''
            }`}
          >
            {isCollapsed ? '' : 'Marketplace'}
          </h3>
          {marketplaceWorkflows.map((workflow) => (
            <WorkflowItem
              key={workflow.id}
              workflow={workflow}
              active={pathname === `/w/${workflow.id}`}
              isMarketplace
              isCollapsed={isCollapsed}
              level={-1}
              isDragOver={false}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!showLoading &&
        regularWorkflows.length === 0 &&
        marketplaceWorkflows.length === 0 &&
        folderTree.length === 0 &&
        !isCollapsed && (
          <div className='px-2 py-1.5 text-muted-foreground text-xs'>
            No workflows or folders in {activeWorkspaceId ? 'this workspace' : 'your account'}.
            Create one to get started.
          </div>
        )}
    </div>
  )
}
