import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowList:DragDrop')

/**
 * Constants for auto-scroll behavior
 */
const SCROLL_THRESHOLD = 60 // Distance from edge to trigger scroll
const SCROLL_SPEED = 8 // Pixels per frame

/**
 * Constants for folder auto-expand on hover during drag
 */
const HOVER_EXPAND_DELAY = 400 // Milliseconds to wait before expanding folder

/**
 * Custom hook for handling drag and drop operations for workflows and folders.
 * Includes auto-scrolling, drop target highlighting, and hover-to-expand.
 *
 * @returns Drag and drop state and event handlers
 */
export function useDragDrop() {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollIntervalRef = useRef<number | null>(null)
  const hoverExpandTimerRef = useRef<number | null>(null)
  const lastDragYRef = useRef<number>(0)

  const { updateFolderAPI, getFolderPath, setExpanded, expandedFolders } = useFolderStore()
  const { updateWorkflow } = useWorkflowRegistry()

  /**
   * Auto-scroll handler - scrolls container when dragging near edges
   */
  const handleAutoScroll = useCallback(() => {
    if (!scrollContainerRef.current || !isDragging) return

    const container = scrollContainerRef.current
    const rect = container.getBoundingClientRect()
    const mouseY = lastDragYRef.current

    // Only scroll if mouse is within container bounds
    if (mouseY < rect.top || mouseY > rect.bottom) return

    // Calculate distance from top and bottom edges
    const distanceFromTop = mouseY - rect.top
    const distanceFromBottom = rect.bottom - mouseY

    let scrollDelta = 0

    // Scroll up if near top and not at scroll top
    if (distanceFromTop < SCROLL_THRESHOLD && container.scrollTop > 0) {
      const intensity = Math.max(0, Math.min(1, 1 - distanceFromTop / SCROLL_THRESHOLD))
      scrollDelta = -SCROLL_SPEED * intensity
    }
    // Scroll down if near bottom and not at scroll bottom
    else if (distanceFromBottom < SCROLL_THRESHOLD) {
      const maxScroll = container.scrollHeight - container.clientHeight
      if (container.scrollTop < maxScroll) {
        const intensity = Math.max(0, Math.min(1, 1 - distanceFromBottom / SCROLL_THRESHOLD))
        scrollDelta = SCROLL_SPEED * intensity
      }
    }

    if (scrollDelta !== 0) {
      container.scrollTop += scrollDelta
    }
  }, [isDragging])

  /**
   * Start auto-scroll animation loop
   */
  useEffect(() => {
    if (isDragging) {
      scrollIntervalRef.current = window.setInterval(handleAutoScroll, 10) // ~100fps for smoother response
    } else {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current)
        scrollIntervalRef.current = null
      }
    }

    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current)
      }
    }
  }, [isDragging, handleAutoScroll])

  /**
   * Handle hover folder changes - start/clear expand timer
   */
  useEffect(() => {
    // Clear existing timer when hover folder changes
    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current)
      hoverExpandTimerRef.current = null
    }

    // Don't start timer if not dragging or no folder is hovered
    if (!isDragging || !hoverFolderId) {
      return
    }

    // Don't expand if folder is already expanded
    if (expandedFolders.has(hoverFolderId)) {
      return
    }

    // Start timer to expand folder after delay
    hoverExpandTimerRef.current = window.setTimeout(() => {
      setExpanded(hoverFolderId, true)
      logger.info(`Auto-expanded folder ${hoverFolderId} during drag`)
    }, HOVER_EXPAND_DELAY)

    return () => {
      if (hoverExpandTimerRef.current) {
        clearTimeout(hoverExpandTimerRef.current)
        hoverExpandTimerRef.current = null
      }
    }
  }, [hoverFolderId, isDragging, expandedFolders, setExpanded])

  /**
   * Cleanup hover state when dragging stops
   */
  useEffect(() => {
    if (!isDragging) {
      setHoverFolderId(null)
    }
  }, [isDragging])

  /**
   * Moves one or more workflows to a target folder
   *
   * @param workflowIds - Array of workflow IDs to move
   * @param targetFolderId - Target folder ID or null for root
   */
  const handleWorkflowDrop = useCallback(
    async (workflowIds: string[], targetFolderId: string | null) => {
      if (!workflowIds.length) {
        logger.warn('No workflows to move')
        return
      }

      try {
        await Promise.all(
          workflowIds.map((workflowId) => updateWorkflow(workflowId, { folderId: targetFolderId }))
        )
        logger.info(`Moved ${workflowIds.length} workflow(s)`)
      } catch (error) {
        logger.error('Failed to move workflows:', error)
      }
    },
    [updateWorkflow]
  )

  /**
   * Moves a folder to a new parent folder, with validation
   *
   * @param draggedFolderId - ID of the folder being moved
   * @param targetFolderId - Target folder ID or null for root
   */
  const handleFolderMove = useCallback(
    async (draggedFolderId: string, targetFolderId: string | null) => {
      if (!draggedFolderId) {
        logger.warn('No folder to move')
        return
      }

      try {
        const folderStore = useFolderStore.getState()
        const draggedFolderPath = folderStore.getFolderPath(draggedFolderId)

        // Prevent moving folder into its own descendant
        if (
          targetFolderId &&
          draggedFolderPath.some((ancestor) => ancestor.id === targetFolderId)
        ) {
          logger.info('Cannot move folder into its own descendant')
          return
        }

        // Prevent moving folder into itself
        if (draggedFolderId === targetFolderId) {
          logger.info('Cannot move folder into itself')
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

  /**
   * Handles drop events for both workflows and folders
   *
   * @param e - React drag event
   * @param targetFolderId - Target folder ID or null for root
   */
  const handleFolderDrop = useCallback(
    async (e: React.DragEvent, targetFolderId: string | null) => {
      e.preventDefault()
      e.stopPropagation()
      setDropTargetId(null)
      setIsDragging(false)

      try {
        // Check if dropping workflows
        const workflowIdsData = e.dataTransfer.getData('workflow-ids')
        if (workflowIdsData) {
          const workflowIds = JSON.parse(workflowIdsData) as string[]
          await handleWorkflowDrop(workflowIds, targetFolderId)
          return
        }

        // Check if dropping a folder
        const folderIdData = e.dataTransfer.getData('folder-id')
        if (folderIdData && targetFolderId !== folderIdData) {
          await handleFolderMove(folderIdData, targetFolderId)
        }
      } catch (error) {
        logger.error('Failed to handle drop:', error)
      }
    },
    [handleWorkflowDrop, handleFolderMove]
  )

  /**
   * Creates drag event handlers for a specific folder section
   * These handlers are attached to the entire folder section container
   *
   * @param folderId - Folder ID to create handlers for
   * @returns Object containing drag event handlers
   */
  const createFolderDragHandlers = useCallback(
    (folderId: string) => ({
      onDragEnter: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        setIsDragging(true)
      },
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        lastDragYRef.current = e.clientY
        setDropTargetId(folderId)
        setIsDragging(true)
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        const relatedTarget = e.relatedTarget as HTMLElement | null
        const currentTarget = e.currentTarget as HTMLElement
        // Only clear if we're leaving the folder section completely
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
          setDropTargetId(null)
        }
      },
      onDrop: (e: React.DragEvent<HTMLElement>) => handleFolderDrop(e, folderId),
    }),
    [handleFolderDrop]
  )

  /**
   * Creates drag event handlers for items (workflows/folders) that belong to a parent folder
   * When dragging over an item, highlights the parent folder section
   *
   * @param parentFolderId - Parent folder ID or null for root
   * @returns Object containing drag event handlers
   */
  const createItemDragHandlers = useCallback(
    (parentFolderId: string | null) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
        lastDragYRef.current = e.clientY
        setDropTargetId(parentFolderId || 'root')
        setIsDragging(true)
      },
    }),
    []
  )

  /**
   * Creates drag event handlers for the root drop zone
   *
   * @returns Object containing drag event handlers for root
   */
  const createRootDragHandlers = useCallback(
    () => ({
      onDragEnter: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        setIsDragging(true)
      },
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        lastDragYRef.current = e.clientY
        setDropTargetId('root')
        setIsDragging(true)
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        const relatedTarget = e.relatedTarget as HTMLElement | null
        const currentTarget = e.currentTarget as HTMLElement
        // Only clear if we're leaving the root completely
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
          setDropTargetId(null)
        }
      },
      onDrop: (e: React.DragEvent<HTMLElement>) => handleFolderDrop(e, null),
    }),
    [handleFolderDrop]
  )

  /**
   * Creates drag event handlers for folder header (the clickable part)
   * These handlers trigger folder expansion on hover during drag
   *
   * @param folderId - Folder ID to handle hover for
   * @returns Object containing drag event handlers for folder header
   */
  const createFolderHeaderHoverHandlers = useCallback(
    (folderId: string) => ({
      onDragEnter: (e: React.DragEvent<HTMLElement>) => {
        if (isDragging) {
          setHoverFolderId(folderId)
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        const relatedTarget = e.relatedTarget as HTMLElement | null
        const currentTarget = e.currentTarget as HTMLElement
        // Only clear if we're leaving the folder header completely
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
          setHoverFolderId(null)
        }
      },
    }),
    [isDragging]
  )

  /**
   * Set the scroll container ref for auto-scrolling
   *
   * @param element - Scrollable container element
   */
  const setScrollContainer = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element
  }, [])

  return {
    dropTargetId,
    isDragging,
    setScrollContainer,
    createFolderDragHandlers,
    createItemDragHandlers,
    createRootDragHandlers,
    createFolderHeaderHoverHandlers,
  }
}
