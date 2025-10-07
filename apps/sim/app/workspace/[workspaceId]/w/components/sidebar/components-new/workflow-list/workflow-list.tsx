'use client'

import { useCallback, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { useDragDrop } from '../../hooks/use-drag-drop'
import { FolderItem } from './components/folder-item/folder-item'
import { WorkflowItem } from './components/workflow-item/workflow-item'

const logger = createLogger('WorkflowList')

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
}

export function WorkflowList({
  regularWorkflows,
  isLoading = false,
  isImporting,
  setIsImporting,
  fileInputRef,
}: WorkflowListProps) {
  const pathname = usePathname()
  const params = useParams()
  const router = useRouter()
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

  const { createFolderDragHandlers, createRootDragHandlers } = useDragDrop()

  const folderTree = workspaceId ? getFolderTree(workspaceId) : []

  const activeWorkflowFolderId = useMemo(() => {
    if (!workflowId || isLoading || foldersLoading) return null
    const activeWorkflow = regularWorkflows.find((workflow) => workflow.id === workflowId)
    return activeWorkflow?.folderId || null
  }, [workflowId, regularWorkflows, isLoading, foldersLoading])

  const { createWorkflow } = useWorkflowRegistry()

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

  /**
   * Handle direct import of workflow JSON
   */
  const handleDirectImport = useCallback(
    async (content: string, filename?: string) => {
      if (!content.trim()) {
        logger.error('JSON content is required')
        return
      }

      setIsImporting(true)

      try {
        // First validate the JSON without importing
        const { data: workflowData, errors: parseErrors } = parseWorkflowJson(content)

        if (!workflowData || parseErrors.length > 0) {
          logger.error('Failed to parse JSON:', { errors: parseErrors })
          return
        }

        // Generate workflow name from filename or fallback to time-based name
        const getWorkflowName = () => {
          if (filename) {
            // Remove file extension and use the filename
            const nameWithoutExtension = filename.replace(/\.json$/i, '')
            return (
              nameWithoutExtension.trim() || `Imported Workflow - ${new Date().toLocaleString()}`
            )
          }
          return `Imported Workflow - ${new Date().toLocaleString()}`
        }

        // Clear workflow diff store when creating a new workflow from import
        const { clearDiff } = useWorkflowDiffStore.getState()
        clearDiff()

        // Create a new workflow
        const newWorkflowId = await createWorkflow({
          name: getWorkflowName(),
          description: 'Workflow imported from JSON',
          workspaceId,
        })

        // Set the workflow as active in the registry to prevent reload
        useWorkflowRegistry.setState({ activeWorkflowId: newWorkflowId })

        // Cast the workflow data to WorkflowState type
        const typedWorkflowData = workflowData as unknown as WorkflowState

        // Set the workflow state immediately (optimistic update)
        useWorkflowStore.setState({
          blocks: typedWorkflowData.blocks,
          edges: typedWorkflowData.edges,
          loops: typedWorkflowData.loops,
          parallels: typedWorkflowData.parallels,
          lastSaved: Date.now(),
        })

        // Initialize subblock store with the imported blocks
        useSubBlockStore.getState().initializeFromWorkflow(newWorkflowId, typedWorkflowData.blocks)

        // Set subblock values if they exist in the imported data
        const subBlockStore = useSubBlockStore.getState()
        for (const [blockId, block] of Object.entries(typedWorkflowData.blocks)) {
          if (block.subBlocks) {
            for (const [subBlockId, subBlock] of Object.entries(block.subBlocks)) {
              if (subBlock.value !== null && subBlock.value !== undefined) {
                subBlockStore.setValue(blockId, subBlockId, subBlock.value)
              }
            }
          }
        }

        // Navigate to the new workflow after setting state
        router.push(`/workspace/${workspaceId}/w/${newWorkflowId}`)

        logger.info('Workflow imported successfully from JSON')

        // Persist to database in the background
        fetch(`/api/workflows/${newWorkflowId}/state`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(workflowData),
        })
          .then((response) => {
            if (!response.ok) {
              logger.error('Failed to persist imported workflow to database')
            } else {
              logger.info('Imported workflow persisted to database')
            }
          })
          .catch((error) => {
            logger.error('Failed to persist imported workflow:', error)
          })
      } catch (error) {
        logger.error('Failed to import workflow:', { error })
      } finally {
        setIsImporting(false)
      }
    },
    [createWorkflow, workspaceId, router, setIsImporting]
  )

  /**
   * Handle import workflow button click
   */
  const handleImportWorkflow = useCallback(() => {
    fileInputRef.current?.click()
  }, [fileInputRef])

  /**
   * Handle file selection and read
   */
  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const content = await file.text()

        // Import directly with filename
        await handleDirectImport(content, file.name)
      } catch (error) {
        logger.error('Failed to read file:', { error })
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [handleDirectImport, fileInputRef]
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
    (folder: FolderTreeNode, level: number): React.ReactNode => {
      const workflowsInFolder = workflowsByFolder[folder.id] || []
      const isExpanded = expandedFolders.has(folder.id)
      const hasChildren = workflowsInFolder.length > 0 || folder.children.length > 0

      return (
        <div key={folder.id}>
          <div style={{ paddingLeft: `${level * TREE_SPACING.INDENT_PER_LEVEL}px` }}>
            <FolderItem folder={folder} level={level} {...createFolderDragHandlers(folder.id)} />
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
                    renderWorkflowItem(workflow, level + 1)
                  )}
                </div>
              )}

              {folder.children.length > 0 && (
                <div
                  className={clsx('space-y-[4px]', workflowsInFolder.length > 0 ? 'mt-[2px]' : '')}
                >
                  {folder.children.map((childFolder) => (
                    <div key={childFolder.id} className='relative'>
                      {renderFolderSection(childFolder, level + 1)}
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
      createFolderDragHandlers,
      calculateVerticalLineHeight,
      renderWorkflowItem,
    ]
  )

  const handleRootDragEvents = createRootDragHandlers()
  const rootWorkflows = workflowsByFolder.root || []

  return (
    <div className='flex flex-col space-y-[4px] pb-[8px]'>
      <div className='space-y-[4px]'>
        {folderTree.map((folder) => renderFolderSection(folder, 0))}
      </div>

      <div className='min-h-[25px] space-y-[4px]' {...handleRootDragEvents}>
        {rootWorkflows.map((workflow: WorkflowMetadata) => (
          <WorkflowItem
            key={workflow.id}
            workflow={workflow}
            active={isWorkflowActive(workflow.id)}
            level={0}
          />
        ))}
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
