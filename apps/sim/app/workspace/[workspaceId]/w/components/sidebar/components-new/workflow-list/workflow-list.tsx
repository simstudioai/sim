'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { FolderItem } from './folder-item'
import { WorkflowItem } from './workflow-item'

const logger = createLogger('WorkflowList')

const TREE_SPACING = {
  INDENT_PER_LEVEL: 20,
  VERTICAL_LINE_LEFT_OFFSET: 4, // Position line at the folder's chevron
  ITEM_GAP: 4,
  MAX_NESTING_LEVELS: 2,
} as const

const TREE_STYLES = {
  LINE_COLOR: 'hsl(var(--muted-foreground) / 0.2)',
} as const

interface WorkflowListProps {
  regularWorkflows: WorkflowMetadata[]
  isLoading?: boolean
}

export function WorkflowList({ regularWorkflows, isLoading = false }: WorkflowListProps) {
  const pathname = usePathname()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const workflowId = params.workflowId as string

  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [rootDragOver, setRootDragOver] = useState(false)

  const {
    getFolderTree,
    expandedFolders,
    fetchFolders,
    isLoading: foldersLoading,
    updateFolderAPI,
    getFolderPath,
    setExpanded,
  } = useFolderStore()

  const { updateWorkflow } = useWorkflowRegistry()

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

  useEffect(() => {
    if (!activeWorkflowFolderId) return
    const folderPath = getFolderPath(activeWorkflowFolderId)
    folderPath.forEach((folder) => {
      if (!expandedFolders.has(folder.id)) {
        setExpanded(folder.id, true)
      }
    })
  }, [activeWorkflowFolderId, getFolderPath, setExpanded]) // Remove expandedFolders from dependencies

  useEffect(() => {
    if (workspaceId) {
      fetchFolders(workspaceId)
    }
  }, [workspaceId, fetchFolders])

  const handleWorkflowDrop = useCallback(
    async (workflowIds: string[], targetFolderId: string | null) => {
      try {
        for (const workflowId of workflowIds) {
          await updateWorkflow(workflowId, { folderId: targetFolderId })
        }
        logger.info(`Moved ${workflowIds.length} workflow(s)`)
      } catch (error) {
        logger.error('Failed to move workflows:', error)
      }
    },
    [updateWorkflow]
  )

  const handleFolderMove = useCallback(
    async (draggedFolderId: string, targetFolderId: string | null) => {
      try {
        const folderStore = useFolderStore.getState()
        const draggedFolderPath = folderStore.getFolderPath(draggedFolderId)

        if (
          targetFolderId &&
          draggedFolderPath.some((ancestor) => ancestor.id === targetFolderId)
        ) {
          logger.info('Cannot move folder into its own descendant')
          return
        }

        const targetFolderPath = targetFolderId ? folderStore.getFolderPath(targetFolderId) : []
        if (targetFolderPath.length >= TREE_SPACING.MAX_NESTING_LEVELS) {
          logger.info(`Maximum ${TREE_SPACING.MAX_NESTING_LEVELS} levels of nesting allowed`)
          return
        }

        await updateFolderAPI(draggedFolderId, { parentId: targetFolderId })
        logger.info(`Moved folder to ${targetFolderId ? `folder ${targetFolderId}` : 'root'}`)
      } catch (error) {
        logger.error('Failed to move folder:', error)
      }
    },
    [updateFolderAPI]
  )

  const handleFolderDrop = useCallback(
    async (e: React.DragEvent, targetFolderId: string | null) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOverFolderId(null)
      setRootDragOver(false)

      const workflowIdsData = e.dataTransfer.getData('workflow-ids')
      if (workflowIdsData) {
        const workflowIds = JSON.parse(workflowIdsData) as string[]
        await handleWorkflowDrop(workflowIds, targetFolderId)
        return
      }

      const folderIdData = e.dataTransfer.getData('folder-id')
      if (folderIdData && targetFolderId !== folderIdData) {
        await handleFolderMove(folderIdData, targetFolderId)
      }
    },
    [handleWorkflowDrop, handleFolderMove]
  )

  const handleFolderDragEvents = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOverFolderId(folderId)
      },
      onDragLeave: (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOverFolderId(null)
      },
      onDrop: (e: React.DragEvent) => handleFolderDrop(e, folderId),
    }),
    [handleFolderDrop]
  )

  const renderWorkflowItem = useCallback(
    (workflow: WorkflowMetadata, level: number) => (
      <div key={workflow.id} className='relative'>
        <div
          style={{
            paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px`,
          }}
        >
          <WorkflowItem workflow={workflow} active={isWorkflowActive(workflow.id)} level={level} />
        </div>
      </div>
    ),
    [isWorkflowActive]
  )

  const renderChildFolder = useCallback(
    (
      childFolder: FolderTreeNode,
      level: number,
      renderFolderSectionFn: (folder: FolderTreeNode, level: number) => React.ReactNode
    ) => (
      <div key={childFolder.id} className='relative'>
        {renderFolderSectionFn(childFolder, level)}
      </div>
    ),
    []
  )

  const calculateVerticalLineHeight = useCallback((workflowCount: number, folderCount: number) => {
    // Calculate total height based on number of items
    // Each item is 25px tall with 4px gap
    const itemHeight = 25
    const gap = TREE_SPACING.ITEM_GAP
    const totalItems = workflowCount + folderCount

    if (totalItems === 0) return '0px'

    // Height = (items * height) + ((items - 1) * gap)
    // This gives us the exact height to the bottom of the last item
    const totalHeight = totalItems * itemHeight + (totalItems - 1) * gap

    return `${totalHeight}px`
  }, [])

  const renderFolderSection = useCallback(
    (folder: FolderTreeNode, level: number): React.ReactNode => {
      const workflowsInFolder = workflowsByFolder[folder.id] || []
      const isExpanded = expandedFolders.has(folder.id)
      const hasChildren = workflowsInFolder.length > 0 || folder.children.length > 0

      return (
        <div key={folder.id}>
          <div style={{ paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}>
            <FolderItem folder={folder} level={level} {...handleFolderDragEvents(folder.id)} />
          </div>

          {isExpanded && hasChildren && (
            <div className='relative'>
              {/* Vertical line from folder bottom extending through all children */}
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

              <div className='space-y-[4px]'>
                {workflowsInFolder.map((workflow) => renderWorkflowItem(workflow, level + 1))}
              </div>

              {folder.children.length > 0 && (
                <div className='space-y-[4px]'>
                  {folder.children.map((childFolder) =>
                    renderChildFolder(childFolder, level + 1, renderFolderSection)
                  )}
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
      handleFolderDragEvents,
      calculateVerticalLineHeight,
      renderWorkflowItem,
      renderChildFolder,
    ]
  )

  const handleRootDragEvents = useMemo(
    () => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        setRootDragOver(true)
      },
      onDragLeave: (e: React.DragEvent) => {
        e.preventDefault()
        setRootDragOver(false)
      },
      onDrop: (e: React.DragEvent) => handleFolderDrop(e, null),
    }),
    [handleFolderDrop]
  )

  const rootWorkflows = workflowsByFolder.root || []

  return (
    <div className='flex flex-col space-y-[4px]'>
      <div className='space-y-[4px]'>
        {folderTree.map((folder) => renderFolderSection(folder, 0))}
      </div>

      <div className='min-h-[25px] space-y-[4px]' {...handleRootDragEvents}>
        {rootWorkflows.map((workflow) => (
          <WorkflowItem
            key={workflow.id}
            workflow={workflow}
            active={isWorkflowActive(workflow.id)}
            level={0}
          />
        ))}
      </div>
    </div>
  )
}
