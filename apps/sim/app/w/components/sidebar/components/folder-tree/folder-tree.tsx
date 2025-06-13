'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { FolderContextMenu } from '../folder-context-menu/folder-context-menu'

interface FolderItemProps {
  folder: FolderTreeNode
  isCollapsed?: boolean
  onCreateWorkflow: (folderId?: string) => void
}

function FolderItem({ folder, isCollapsed, onCreateWorkflow }: FolderItemProps) {
  const [dragOver, setDragOver] = useState(false)
  const { expandedFolders, toggleExpanded, updateFolderAPI, deleteFolder } = useFolderStore()
  const { updateWorkflow } = useWorkflowRegistry()

  const isExpanded = expandedFolders.has(folder.id)

  const handleToggleExpanded = () => {
    toggleExpanded(folder.id)
    // Persist to server
    updateFolderAPI(folder.id, { isExpanded: !isExpanded }).catch(console.error)
  }

  const handleRename = async (folderId: string, newName: string) => {
    try {
      await updateFolderAPI(folderId, { name: newName })
    } catch (error) {
      console.error('Failed to rename folder:', error)
    }
  }

  const handleDelete = async (folderId: string) => {
    if (
      confirm(
        `Are you sure you want to delete "${folder.name}"? Child folders and workflows will be moved to the parent folder.`
      )
    ) {
      try {
        await deleteFolder(folderId)
      } catch (error) {
        console.error('Failed to delete folder:', error)
      }
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const workflowId = e.dataTransfer.getData('workflow-id')
    if (workflowId && workflowId !== folder.id) {
      try {
        // Update workflow to be in this folder
        await updateWorkflow(workflowId, { folderId: folder.id })
        console.log(`Moved workflow ${workflowId} to folder ${folder.id}`)
      } catch (error) {
        console.error('Failed to move workflow to folder:', error)
      }
    }
  }

  if (isCollapsed) {
    return (
      <div
        className='group mx-auto flex h-8 w-8 items-center justify-center'
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className={clsx(
            'flex h-4 w-4 items-center justify-center rounded transition-colors',
            dragOver ? 'ring-2 ring-blue-500' : ''
          )}
          style={{ backgroundColor: folder.color }}
        >
          {isExpanded ? (
            <FolderOpen className='h-3 w-3 text-white' />
          ) : (
            <Folder className='h-3 w-3 text-white' />
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx('group', dragOver ? 'rounded-md border border-blue-200 bg-blue-50' : '')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className='flex items-center rounded-md px-2 py-1.5 text-sm hover:bg-accent/50'>
        <Button
          variant='ghost'
          size='sm'
          className='mr-1 h-4 w-4 p-0'
          onClick={handleToggleExpanded}
        >
          {isExpanded ? <ChevronDown className='h-3 w-3' /> : <ChevronRight className='h-3 w-3' />}
        </Button>

        <div
          className='mr-2 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded'
          style={{ backgroundColor: folder.color }}
        >
          {isExpanded ? (
            <FolderOpen className='h-3 w-3 text-white' />
          ) : (
            <Folder className='h-3 w-3 text-white' />
          )}
        </div>

        <span className='flex-1 truncate text-muted-foreground'>{folder.name}</span>

        <FolderContextMenu
          folderId={folder.id}
          folderName={folder.name}
          onCreateWorkflow={onCreateWorkflow}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      </div>
    </div>
  )
}

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  isMarketplace?: boolean
  isCollapsed?: boolean
  level: number
}

function WorkflowItem({ workflow, active, isMarketplace, isCollapsed, level }: WorkflowItemProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = (e: React.DragEvent) => {
    if (isMarketplace) return // Don't allow dragging marketplace workflows

    e.dataTransfer.setData('workflow-id', workflow.id)
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
  }

  const handleDragEnd = () => {
    setIsDragging(false)
  }

  if (isCollapsed) {
    return (
      <Link
        href={`/w/${workflow.id}`}
        className={clsx(
          'mx-auto flex h-8 w-8 items-center justify-center rounded-md',
          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
          isDragging ? 'opacity-50' : ''
        )}
        draggable={!isMarketplace}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          className='h-[14px] w-[14px] flex-shrink-0 rounded'
          style={{ backgroundColor: workflow.color }}
        />
      </Link>
    )
  }

  return (
    <Link
      href={`/w/${workflow.id}`}
      className={clsx(
        'flex items-center rounded-md px-2 py-1.5 font-medium text-sm',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
        isDragging ? 'opacity-50' : '',
        !isMarketplace ? 'cursor-move' : ''
      )}
      style={{ paddingLeft: `${(level + 1) * 20 + 8}px` }}
      draggable={!isMarketplace}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className='mr-2 h-[14px] w-[14px] flex-shrink-0 rounded'
        style={{ backgroundColor: workflow.color }}
      />
      <span className='truncate'>
        {workflow.name}
        {isMarketplace && ' (Preview)'}
      </span>
    </Link>
  )
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
  } = useFolderStore()

  // Fetch folders when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      fetchFolders(activeWorkspaceId)
    }
  }, [activeWorkspaceId, fetchFolders])

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

  const renderFolderTree = (nodes: FolderTreeNode[], level = 0): React.ReactNode[] => {
    const result: React.ReactNode[] = []

    nodes.forEach((folder) => {
      // Render folder
      result.push(
        <div key={folder.id} style={{ paddingLeft: `${level * 20}px` }}>
          <FolderItem
            folder={folder}
            isCollapsed={isCollapsed}
            onCreateWorkflow={onCreateWorkflow}
          />
        </div>
      )

      // Render workflows in this folder
      const workflowsInFolder = workflowsByFolder[folder.id] || []
      if (expandedFolders.has(folder.id) && workflowsInFolder.length > 0) {
        workflowsInFolder.forEach((workflow) => {
          result.push(
            <WorkflowItem
              key={workflow.id}
              workflow={workflow}
              active={pathname === `/w/${workflow.id}`}
              isCollapsed={isCollapsed}
              level={level}
            />
          )
        })
      }

      // Render child folders
      if (expandedFolders.has(folder.id) && folder.children.length > 0) {
        result.push(...renderFolderTree(folder.children, level + 1))
      }
    })

    return result
  }

  const showLoading = isLoading || foldersLoading

  return (
    <div className={`space-y-1 ${showLoading ? 'opacity-60' : ''}`}>
      {/* Folder tree */}
      {renderFolderTree(folderTree)}

      {/* Root level workflows (no folder) */}
      {(workflowsByFolder.root || []).map((workflow) => (
        <WorkflowItem
          key={workflow.id}
          workflow={workflow}
          active={pathname === `/w/${workflow.id}`}
          isCollapsed={isCollapsed}
          level={-1}
        />
      ))}

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
