import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { useReorderFolders } from '@/hooks/queries/folders'
import { useReorderWorkflows } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowList:DragDrop')

const SCROLL_THRESHOLD = 60
const SCROLL_SPEED = 8
const HOVER_EXPAND_DELAY = 400

export interface DropIndicator {
  targetId: string
  position: 'before' | 'after' | 'inside'
  folderId: string | null
}

export function useDragDrop() {
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollIntervalRef = useRef<number | null>(null)
  const hoverExpandTimerRef = useRef<number | null>(null)
  const lastDragYRef = useRef<number>(0)
  const draggedTypeRef = useRef<'workflow' | 'folder' | null>(null)

  const params = useParams()
  const workspaceId = params.workspaceId as string | undefined
  const reorderWorkflowsMutation = useReorderWorkflows()
  const reorderFoldersMutation = useReorderFolders()
  const { setExpanded, expandedFolders } = useFolderStore()

  const handleAutoScroll = useCallback(() => {
    if (!scrollContainerRef.current || !isDragging) return

    const container = scrollContainerRef.current
    const rect = container.getBoundingClientRect()
    const mouseY = lastDragYRef.current

    if (mouseY < rect.top || mouseY > rect.bottom) return

    const distanceFromTop = mouseY - rect.top
    const distanceFromBottom = rect.bottom - mouseY

    let scrollDelta = 0

    if (distanceFromTop < SCROLL_THRESHOLD && container.scrollTop > 0) {
      const intensity = Math.max(0, Math.min(1, 1 - distanceFromTop / SCROLL_THRESHOLD))
      scrollDelta = -SCROLL_SPEED * intensity
    } else if (distanceFromBottom < SCROLL_THRESHOLD) {
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

  useEffect(() => {
    if (isDragging) {
      scrollIntervalRef.current = window.setInterval(handleAutoScroll, 10)
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

  useEffect(() => {
    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current)
      hoverExpandTimerRef.current = null
    }

    if (!isDragging || !hoverFolderId) return
    if (expandedFolders.has(hoverFolderId)) return

    hoverExpandTimerRef.current = window.setTimeout(() => {
      setExpanded(hoverFolderId, true)
    }, HOVER_EXPAND_DELAY)

    return () => {
      if (hoverExpandTimerRef.current) {
        clearTimeout(hoverExpandTimerRef.current)
        hoverExpandTimerRef.current = null
      }
    }
  }, [hoverFolderId, isDragging, expandedFolders, setExpanded])

  useEffect(() => {
    if (!isDragging) {
      setHoverFolderId(null)
      setDropIndicator(null)
      draggedTypeRef.current = null
    }
  }, [isDragging])

  const calculateDropPosition = useCallback(
    (e: React.DragEvent, element: HTMLElement): 'before' | 'after' => {
      const rect = element.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      return e.clientY < midY ? 'before' : 'after'
    },
    []
  )

  const handleWorkflowDrop = useCallback(
    async (workflowIds: string[], indicator: DropIndicator) => {
      if (!workflowIds.length || !workspaceId) return

      try {
        const destinationFolderId =
          indicator.position === 'inside'
            ? indicator.targetId === 'root'
              ? null
              : indicator.targetId
            : indicator.folderId

        type SiblingItem = { type: 'folder' | 'workflow'; id: string; sortOrder: number }
        const currentFolders = useFolderStore.getState().folders
        const currentWorkflows = useWorkflowRegistry.getState().workflows
        const siblingFolders = Object.values(currentFolders).filter(
          (f) => f.parentId === destinationFolderId
        )
        const siblingWorkflows = Object.values(currentWorkflows).filter(
          (w) => w.folderId === destinationFolderId
        )

        const siblingItems: SiblingItem[] = [
          ...siblingFolders.map((f) => ({
            type: 'folder' as const,
            id: f.id,
            sortOrder: f.sortOrder,
          })),
          ...siblingWorkflows.map((w) => ({
            type: 'workflow' as const,
            id: w.id,
            sortOrder: w.sortOrder,
          })),
        ].sort((a, b) => a.sortOrder - b.sortOrder)

        const movingSet = new Set(workflowIds)
        const remaining = siblingItems.filter(
          (item) => !(item.type === 'workflow' && movingSet.has(item.id))
        )
        const moving = workflowIds
          .map((id) => {
            const w = currentWorkflows[id]
            return { type: 'workflow' as const, id, sortOrder: w?.sortOrder ?? 0 }
          })
          .sort((a, b) => a.sortOrder - b.sortOrder)

        let insertAt: number
        if (indicator.position === 'inside') {
          insertAt = remaining.length
        } else {
          const targetIdx = remaining.findIndex((item) => item.id === indicator.targetId)
          insertAt = indicator.position === 'before' ? targetIdx : targetIdx + 1
        }

        const newOrder: SiblingItem[] = [
          ...remaining.slice(0, insertAt),
          ...moving,
          ...remaining.slice(insertAt),
        ]

        const folderUpdates = newOrder
          .map((item, i) => ({ ...item, sortOrder: i }))
          .filter((item) => item.type === 'folder')
          .map((item) => ({
            id: item.id,
            sortOrder: item.sortOrder,
            parentId: destinationFolderId,
          }))

        const workflowUpdates = newOrder
          .map((item, i) => ({ ...item, sortOrder: i }))
          .filter((item) => item.type === 'workflow')
          .map((item) => ({
            id: item.id,
            sortOrder: item.sortOrder,
            folderId: destinationFolderId,
          }))

        await Promise.all([
          folderUpdates.length > 0 &&
            reorderFoldersMutation.mutateAsync({ workspaceId, updates: folderUpdates }),
          workflowUpdates.length > 0 &&
            reorderWorkflowsMutation.mutateAsync({ workspaceId, updates: workflowUpdates }),
        ])
      } catch (error) {
        logger.error('Failed to reorder workflows:', error)
      }
    },
    [workspaceId, reorderFoldersMutation, reorderWorkflowsMutation]
  )

  const handleFolderDrop = useCallback(
    async (draggedFolderId: string, indicator: DropIndicator) => {
      if (!draggedFolderId || !workspaceId) return

      try {
        const folderStore = useFolderStore.getState()
        const currentFolders = folderStore.folders

        const targetParentId =
          indicator.position === 'inside'
            ? indicator.targetId === 'root'
              ? null
              : indicator.targetId
            : indicator.folderId

        if (draggedFolderId === targetParentId) {
          logger.info('Cannot move folder into itself')
          return
        }

        if (targetParentId) {
          const targetPath = folderStore.getFolderPath(targetParentId)
          if (targetPath.some((f) => f.id === draggedFolderId)) {
            logger.info('Cannot move folder into its own descendant')
            return
          }
        }

        type SiblingItem = { type: 'folder' | 'workflow'; id: string; sortOrder: number }
        const currentWorkflows = useWorkflowRegistry.getState().workflows
        const siblingFolders = Object.values(currentFolders).filter(
          (f) => f.parentId === targetParentId
        )
        const siblingWorkflows = Object.values(currentWorkflows).filter(
          (w) => w.folderId === targetParentId
        )

        const siblingItems: SiblingItem[] = [
          ...siblingFolders.map((f) => ({
            type: 'folder' as const,
            id: f.id,
            sortOrder: f.sortOrder,
          })),
          ...siblingWorkflows.map((w) => ({
            type: 'workflow' as const,
            id: w.id,
            sortOrder: w.sortOrder,
          })),
        ].sort((a, b) => a.sortOrder - b.sortOrder)

        const remaining = siblingItems.filter(
          (item) => !(item.type === 'folder' && item.id === draggedFolderId)
        )

        let insertAt: number
        if (indicator.position === 'inside') {
          insertAt = remaining.length
        } else {
          const targetIdx = remaining.findIndex((item) => item.id === indicator.targetId)
          insertAt = indicator.position === 'before' ? targetIdx : targetIdx + 1
        }

        const newOrder: SiblingItem[] = [
          ...remaining.slice(0, insertAt),
          { type: 'folder', id: draggedFolderId, sortOrder: 0 },
          ...remaining.slice(insertAt),
        ]

        const folderUpdates = newOrder
          .map((item, i) => ({ ...item, sortOrder: i }))
          .filter((item) => item.type === 'folder')
          .map((item) => ({ id: item.id, sortOrder: item.sortOrder, parentId: targetParentId }))

        const workflowUpdates = newOrder
          .map((item, i) => ({ ...item, sortOrder: i }))
          .filter((item) => item.type === 'workflow')
          .map((item) => ({ id: item.id, sortOrder: item.sortOrder, folderId: targetParentId }))

        await Promise.all([
          folderUpdates.length > 0 &&
            reorderFoldersMutation.mutateAsync({ workspaceId, updates: folderUpdates }),
          workflowUpdates.length > 0 &&
            reorderWorkflowsMutation.mutateAsync({ workspaceId, updates: workflowUpdates }),
        ])
      } catch (error) {
        logger.error('Failed to reorder folder:', error)
      }
    },
    [workspaceId, reorderFoldersMutation, reorderWorkflowsMutation]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const indicator = dropIndicator
      setDropIndicator(null)
      setIsDragging(false)

      if (!indicator) return

      try {
        const workflowIdsData = e.dataTransfer.getData('workflow-ids')
        if (workflowIdsData) {
          const workflowIds = JSON.parse(workflowIdsData) as string[]
          await handleWorkflowDrop(workflowIds, indicator)
          return
        }

        const folderIdData = e.dataTransfer.getData('folder-id')
        if (folderIdData) {
          await handleFolderDrop(folderIdData, indicator)
        }
      } catch (error) {
        logger.error('Failed to handle drop:', error)
      }
    },
    [dropIndicator, handleWorkflowDrop, handleFolderDrop]
  )

  const createWorkflowDragHandlers = useCallback(
    (workflowId: string, folderId: string | null) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
        lastDragYRef.current = e.clientY
        setIsDragging(true)

        const position = calculateDropPosition(e, e.currentTarget)
        setDropIndicator({ targetId: workflowId, position, folderId })
      },
      onDrop: handleDrop,
    }),
    [calculateDropPosition, handleDrop]
  )

  const createFolderDragHandlers = useCallback(
    (folderId: string, parentFolderId: string | null) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
        lastDragYRef.current = e.clientY
        setIsDragging(true)

        if (draggedTypeRef.current === 'folder') {
          const position = calculateDropPosition(e, e.currentTarget)
          setDropIndicator({ targetId: folderId, position, folderId: parentFolderId })
        } else {
          setDropIndicator({ targetId: folderId, position: 'inside', folderId: parentFolderId })
          setHoverFolderId(folderId)
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        const relatedTarget = e.relatedTarget as HTMLElement | null
        const currentTarget = e.currentTarget as HTMLElement
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
          setHoverFolderId(null)
        }
      },
      onDrop: handleDrop,
    }),
    [calculateDropPosition, handleDrop]
  )

  const createEmptyFolderDropZone = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
        lastDragYRef.current = e.clientY
        setIsDragging(true)
        setDropIndicator({ targetId: folderId, position: 'inside', folderId })
      },
      onDrop: handleDrop,
    }),
    [handleDrop]
  )

  const createRootDropZone = useCallback(
    () => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        lastDragYRef.current = e.clientY
        setIsDragging(true)
        setDropIndicator({ targetId: 'root', position: 'inside', folderId: null })
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        const relatedTarget = e.relatedTarget as HTMLElement | null
        const currentTarget = e.currentTarget as HTMLElement
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
          setDropIndicator(null)
        }
      },
      onDrop: handleDrop,
    }),
    [handleDrop]
  )

  const handleDragStart = useCallback((type: 'workflow' | 'folder') => {
    draggedTypeRef.current = type
    setIsDragging(true)
  }, [])

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    setDropIndicator(null)
    draggedTypeRef.current = null
    setHoverFolderId(null)
  }, [])

  const setScrollContainer = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element
  }, [])

  return {
    dropIndicator,
    isDragging,
    setScrollContainer,
    createWorkflowDragHandlers,
    createFolderDragHandlers,
    createEmptyFolderDropZone,
    createRootDropZone,
    handleDragStart,
    handleDragEnd,
  }
}
