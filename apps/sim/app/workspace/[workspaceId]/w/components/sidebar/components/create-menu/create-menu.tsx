'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Folder, Plus } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import { generateFolderName } from '@/lib/naming'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CreateMenu')

const TIMERS = {
  LONG_PRESS_DELAY: 500,
  CLOSE_DELAY: 600,
} as const

interface CreateMenuProps {
  onCreateWorkflow: (folderId?: string) => Promise<string>
  isCreatingWorkflow?: boolean
}

export function CreateMenu({ onCreateWorkflow, isCreatingWorkflow = false }: CreateMenuProps) {
  // State
  const [isCreating, setIsCreating] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [pressTimer, setPressTimer] = useState<NodeJS.Timeout | null>(null)
  const [closeTimer, setCloseTimer] = useState<NodeJS.Timeout | null>(null)

  // Hooks
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const { createFolder } = useFolderStore()
  const { createWorkflow } = useWorkflowRegistry()
  const userPermissions = useUserPermissionsContext()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Timer management utilities
  const clearAllTimers = useCallback(() => {
    if (pressTimer) {
      window.clearTimeout(pressTimer)
      setPressTimer(null)
    }
    if (closeTimer) {
      window.clearTimeout(closeTimer)
      setCloseTimer(null)
    }
  }, [pressTimer, closeTimer])

  const clearCloseTimer = useCallback(() => {
    if (closeTimer) {
      window.clearTimeout(closeTimer)
      setCloseTimer(null)
    }
  }, [closeTimer])

  const startCloseTimer = useCallback(() => {
    const timer = setTimeout(() => {
      setIsOpen(false)
      setCloseTimer(null)
    }, TIMERS.CLOSE_DELAY)
    setCloseTimer(timer)
  }, [])

  const openPopover = useCallback(() => {
    clearCloseTimer()
    setIsOpen(true)
  }, [clearCloseTimer])

  // Action handlers
  const handleCreateWorkflow = useCallback(async () => {
    if (isCreatingWorkflow) {
      logger.info('Workflow creation already in progress, ignoring request')
      return
    }

    setIsOpen(false)

    try {
      const workflowId = await onCreateWorkflow()
      if (workflowId) {
        router.push(`/workspace/${workspaceId}/w/${workflowId}`)
      }
    } catch (error) {
      logger.error('Error creating workflow:', { error })
    }
  }, [onCreateWorkflow, isCreatingWorkflow, router, workspaceId])

  const handleCreateFolder = useCallback(async () => {
    setIsOpen(false)

    if (isCreating || !workspaceId) {
      logger.info('Folder creation already in progress or no workspaceId available')
      return
    }

    try {
      setIsCreating(true)
      const folderName = await generateFolderName(workspaceId)
      await createFolder({ name: folderName, workspaceId })
      logger.info(`Created folder: ${folderName}`)
    } catch (error) {
      logger.error('Failed to create folder:', { error })
    } finally {
      setIsCreating(false)
    }
  }, [createFolder, workspaceId, isCreating])

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

        // Save workflow state to database first
        const response = await fetch(`/api/workflows/${newWorkflowId}/state`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(workflowData),
        })

        if (!response.ok) {
          logger.error('Failed to persist imported workflow to database')
          throw new Error('Failed to save workflow')
        }

        logger.info('Imported workflow persisted to database')

        // Pre-load the workflow state before navigating
        const { setActiveWorkflow } = useWorkflowRegistry.getState()
        await setActiveWorkflow(newWorkflowId)

        // Navigate to the new workflow (replace to avoid history entry)
        router.replace(`/workspace/${workspaceId}/w/${newWorkflowId}`)

        logger.info('Workflow imported successfully from JSON')
      } catch (error) {
        logger.error('Failed to import workflow:', { error })
      } finally {
        setIsImporting(false)
      }
    },
    [createWorkflow, workspaceId, router]
  )

  const handleImportWorkflow = useCallback(() => {
    setIsOpen(false)
    fileInputRef.current?.click()
  }, [])

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
    [handleDirectImport]
  )

  // Button event handlers
  const handleButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      clearAllTimers()
      setIsOpen(true)
    },
    [clearAllTimers]
  )

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsOpen(true)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      const timer = setTimeout(() => {
        setIsOpen(true)
        setPressTimer(null)
      }, TIMERS.LONG_PRESS_DELAY)
      setPressTimer(timer)
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    if (pressTimer) {
      window.clearTimeout(pressTimer)
      setPressTimer(null)
    }
  }, [pressTimer])

  // Hover event handlers for popover control
  const handleMouseEnter = useCallback(() => {
    openPopover()
  }, [openPopover])

  const handleMouseLeave = useCallback(() => {
    if (pressTimer) {
      window.clearTimeout(pressTimer)
      setPressTimer(null)
    }
    startCloseTimer()
  }, [pressTimer, startCloseTimer])

  const handlePopoverMouseEnter = useCallback(() => {
    openPopover()
  }, [openPopover])

  const handlePopoverMouseLeave = useCallback(() => {
    startCloseTimer()
  }, [startCloseTimer])

  // Cleanup effect
  useEffect(() => {
    return () => clearAllTimers()
  }, [clearAllTimers])

  // Styles
  const menuItemClassName =
    'group flex h-8 w-full cursor-pointer items-center gap-2 rounded-[8px] px-2 py-2 font-medium font-sans text-muted-foreground text-sm outline-none hover:bg-muted focus:bg-muted'
  const iconClassName = 'h-4 w-4 group-hover:text-foreground'
  const textClassName = 'group-hover:text-foreground'

  const popoverContentClassName = cn(
    'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
    'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
    'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
    'z-50 animate-in overflow-hidden rounded-[8px] border bg-popover p-1 text-popover-foreground shadow-md',
    'data-[state=closed]:animate-out',
    'w-42'
  )

  return (
    <>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8 shrink-0 rounded-[8px] border bg-background shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
            title='Create Workflow (Hover, right-click, or long press for more options)'
            disabled={isCreatingWorkflow}
            onClick={handleButtonClick}
            onContextMenu={handleContextMenu}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <Plus className='h-[18px] w-[18px] stroke-[2px]' />
            <span className='sr-only'>Create Workflow</span>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align='end'
          sideOffset={4}
          className={popoverContentClassName}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        >
          {/* New Workflow */}
          <button
            className={cn(menuItemClassName, isCreatingWorkflow && 'cursor-not-allowed opacity-50')}
            onClick={handleCreateWorkflow}
            disabled={isCreatingWorkflow}
          >
            <Plus className={iconClassName} />
            <span className={textClassName}>
              {isCreatingWorkflow ? 'Creating...' : 'New workflow'}
            </span>
          </button>

          {/* New Folder */}
          <button
            className={cn(menuItemClassName, isCreating && 'cursor-not-allowed opacity-50')}
            onClick={handleCreateFolder}
            disabled={isCreating}
          >
            <Folder className={iconClassName} />
            <span className={textClassName}>{isCreating ? 'Creating...' : 'New folder'}</span>
          </button>

          {/* Import Workflow */}
          {userPermissions.canEdit && (
            <button
              className={cn(menuItemClassName, isImporting && 'cursor-not-allowed opacity-50')}
              onClick={handleImportWorkflow}
              disabled={isImporting}
            >
              <Download className={iconClassName} />
              <span className={textClassName}>
                {isImporting ? 'Importing...' : 'Import workflow'}
              </span>
            </button>
          )}
        </PopoverContent>
      </Popover>

      <input
        ref={fileInputRef}
        type='file'
        accept='.json'
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  )
}
