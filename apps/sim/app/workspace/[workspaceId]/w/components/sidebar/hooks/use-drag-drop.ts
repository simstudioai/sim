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

interface UseDragDropOptions {
  disabled?: boolean
}

export function useDragDrop(options: UseDragDropOptions = {}) {
  const { disabled = false } = options
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollIntervalRef = useRef<number | null>(null)
  const hoverExpandTimerRef = useRef<number | null>(null)
  const lastDragYRef = useRef<number>(0)
  const draggedTypeRef = useRef<'workflow' | 'folder' | null>(null)
  const draggedSourceFolderRef = useRef<string | null>(null)

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

  const calculateFolderDropPosition = useCallback(
    (e: React.DragEvent, element: HTMLElement): 'before' | 'inside' | 'after' => {
      const rect = element.getBoundingClientRect()
      const relativeY = e.clientY - rect.top
      const height = rect.height
      // Top 25% = before, middle 50% = inside, bottom 25% = after
      if (relativeY < height * 0.25) return 'before'
      if (relativeY > height * 0.75) return 'after'
      return 'inside'
    },
    []
  )

  type SiblingItem = {
    type: 'folder' | 'workflow'
    id: string
    sortOrder: number
    createdAt: Date
  }

  const compareSiblingItems = (a: SiblingItem, b: SiblingItem): number => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    const timeA = a.createdAt.getTime()
    const timeB = b.createdAt.getTime()
    if (timeA !== timeB) return timeA - timeB
    return a.id.localeCompare(b.id)
  }

  const getDestinationFolderId = useCallback((indicator: DropIndicator): string | null => {
    return indicator.position === 'inside'
      ? indicator.targetId === 'root'
        ? null
        : indicator.targetId
      : indicator.folderId
  }, [])

  const calculateInsertIndex = useCallback(
    (remaining: SiblingItem[], indicator: DropIndicator): number => {
      return indicator.position === 'inside'
        ? remaining.length
        : remaining.findIndex((item) => item.id === indicator.targetId) +
            (indicator.position === 'after' ? 1 : 0)
    },
    []
  )

  const buildAndSubmitUpdates = useCallback(
    async (newOrder: SiblingItem[], destinationFolderId: string | null) => {
      const indexed = newOrder.map((item, i) => ({ ...item, sortOrder: i }))

      const folderUpdates = indexed
        .filter((item) => item.type === 'folder')
        .map((item) => ({ id: item.id, sortOrder: item.sortOrder, parentId: destinationFolderId }))

      const workflowUpdates = indexed
        .filter((item) => item.type === 'workflow')
        .map((item) => ({ id: item.id, sortOrder: item.sortOrder, folderId: destinationFolderId }))

      await Promise.all(
        [
          folderUpdates.length > 0 &&
            reorderFoldersMutation.mutateAsync({
              workspaceId: workspaceId!,
              updates: folderUpdates,
            }),
          workflowUpdates.length > 0 &&
            reorderWorkflowsMutation.mutateAsync({
              workspaceId: workspaceId!,
              updates: workflowUpdates,
            }),
        ].filter(Boolean)
      )
    },
    [workspaceId, reorderFoldersMutation, reorderWorkflowsMutation]
  )

  const isLeavingElement = useCallback((e: React.DragEvent<HTMLElement>): boolean => {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    const currentTarget = e.currentTarget as HTMLElement
    return !relatedTarget || !currentTarget.contains(relatedTarget)
  }, [])

  const initDragOver = useCallback((e: React.DragEvent<HTMLElement>, stopPropagation = true) => {
    e.preventDefault()
    if (stopPropagation) e.stopPropagation()
    lastDragYRef.current = e.clientY
    setIsDragging(true)
  }, [])

  const getSiblingItems = useCallback((folderId: string | null): SiblingItem[] => {
    const currentFolders = useFolderStore.getState().folders
    const currentWorkflows = useWorkflowRegistry.getState().workflows
    return [
      ...Object.values(currentFolders)
        .filter((f) => f.parentId === folderId)
        .map((f) => ({
          type: 'folder' as const,
          id: f.id,
          sortOrder: f.sortOrder,
          createdAt: f.createdAt,
        })),
      ...Object.values(currentWorkflows)
        .filter((w) => w.folderId === folderId)
        .map((w) => ({
          type: 'workflow' as const,
          id: w.id,
          sortOrder: w.sortOrder,
          createdAt: w.createdAt,
        })),
    ].sort(compareSiblingItems)
  }, [])

  const setNormalizedDropIndicator = useCallback(
    (indicator: DropIndicator | null) => {
      setDropIndicator((prev) => {
        let next: DropIndicator | null = indicator

        if (indicator && indicator.position === 'after' && indicator.targetId !== 'root') {
          const siblings = getSiblingItems(indicator.folderId)
          const currentIdx = siblings.findIndex((s) => s.id === indicator.targetId)
          const nextSibling = siblings[currentIdx + 1]
          if (nextSibling) {
            next = {
              targetId: nextSibling.id,
              position: 'before',
              folderId: indicator.folderId,
            }
          }
        }

        if (
          prev?.targetId === next?.targetId &&
          prev?.position === next?.position &&
          prev?.folderId === next?.folderId
        ) {
          return prev
        }

        return next
      })
    },
    [getSiblingItems]
  )

  const isNoOpMove = useCallback(
    (
      indicator: DropIndicator,
      draggedIds: string[],
      draggedType: 'folder' | 'workflow',
      destinationFolderId: string | null,
      currentFolderId: string | null | undefined
    ): boolean => {
      if (indicator.position !== 'inside' && draggedIds.includes(indicator.targetId)) {
        return true
      }
      if (currentFolderId !== destinationFolderId) {
        return false
      }
      const siblingItems = getSiblingItems(destinationFolderId)
      const remaining = siblingItems.filter(
        (item) => !(item.type === draggedType && draggedIds.includes(item.id))
      )
      const insertAt = calculateInsertIndex(remaining, indicator)
      const originalIdx = siblingItems.findIndex(
        (item) => item.type === draggedType && item.id === draggedIds[0]
      )
      return insertAt === originalIdx
    },
    [getSiblingItems, calculateInsertIndex]
  )

  const handleWorkflowDrop = useCallback(
    async (workflowIds: string[], indicator: DropIndicator) => {
      if (!workflowIds.length || !workspaceId) return

      try {
        const destinationFolderId = getDestinationFolderId(indicator)
        const currentWorkflows = useWorkflowRegistry.getState().workflows
        const firstWorkflow = currentWorkflows[workflowIds[0]]

        if (
          isNoOpMove(
            indicator,
            workflowIds,
            'workflow',
            destinationFolderId,
            firstWorkflow?.folderId
          )
        ) {
          return
        }

        const siblingItems = getSiblingItems(destinationFolderId)
        const movingSet = new Set(workflowIds)
        const remaining = siblingItems.filter(
          (item) => !(item.type === 'workflow' && movingSet.has(item.id))
        )
        const moving = workflowIds
          .map((id) => ({
            type: 'workflow' as const,
            id,
            sortOrder: currentWorkflows[id]?.sortOrder ?? 0,
            createdAt: currentWorkflows[id]?.createdAt ?? new Date(),
          }))
          .sort(compareSiblingItems)

        const insertAt = calculateInsertIndex(remaining, indicator)

        const newOrder: SiblingItem[] = [
          ...remaining.slice(0, insertAt),
          ...moving,
          ...remaining.slice(insertAt),
        ]

        await buildAndSubmitUpdates(newOrder, destinationFolderId)
      } catch (error) {
        logger.error('Failed to reorder workflows:', error)
      }
    },
    [
      getDestinationFolderId,
      getSiblingItems,
      calculateInsertIndex,
      isNoOpMove,
      buildAndSubmitUpdates,
    ]
  )

  const handleFolderDrop = useCallback(
    async (draggedFolderId: string, indicator: DropIndicator) => {
      if (!draggedFolderId || !workspaceId) return

      try {
        const folderStore = useFolderStore.getState()
        const currentFolders = folderStore.folders

        const targetParentId = getDestinationFolderId(indicator)

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

        const draggedFolder = currentFolders[draggedFolderId]
        if (
          isNoOpMove(
            indicator,
            [draggedFolderId],
            'folder',
            targetParentId,
            draggedFolder?.parentId
          )
        ) {
          return
        }

        const siblingItems = getSiblingItems(targetParentId)
        const remaining = siblingItems.filter(
          (item) => !(item.type === 'folder' && item.id === draggedFolderId)
        )

        const insertAt = calculateInsertIndex(remaining, indicator)

        const newOrder: SiblingItem[] = [
          ...remaining.slice(0, insertAt),
          {
            type: 'folder',
            id: draggedFolderId,
            sortOrder: 0,
            createdAt: draggedFolder?.createdAt ?? new Date(),
          },
          ...remaining.slice(insertAt),
        ]

        await buildAndSubmitUpdates(newOrder, targetParentId)
      } catch (error) {
        logger.error('Failed to reorder folder:', error)
      }
    },
    [
      workspaceId,
      getDestinationFolderId,
      getSiblingItems,
      calculateInsertIndex,
      isNoOpMove,
      buildAndSubmitUpdates,
    ]
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
        initDragOver(e)
        const isSameFolder = draggedSourceFolderRef.current === folderId
        if (isSameFolder) {
          const position = calculateDropPosition(e, e.currentTarget)
          setNormalizedDropIndicator({ targetId: workflowId, position, folderId })
        } else {
          setNormalizedDropIndicator({
            targetId: folderId || 'root',
            position: 'inside',
            folderId: null,
          })
        }
      },
      onDrop: handleDrop,
    }),
    [initDragOver, calculateDropPosition, setNormalizedDropIndicator, handleDrop]
  )

  const createFolderDragHandlers = useCallback(
    (folderId: string, parentFolderId: string | null) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        initDragOver(e)
        if (draggedTypeRef.current === 'folder') {
          const isSameParent = draggedSourceFolderRef.current === parentFolderId
          if (isSameParent) {
            const position = calculateDropPosition(e, e.currentTarget)
            setNormalizedDropIndicator({ targetId: folderId, position, folderId: parentFolderId })
          } else {
            setNormalizedDropIndicator({
              targetId: folderId,
              position: 'inside',
              folderId: parentFolderId,
            })
            setHoverFolderId(folderId)
          }
        } else {
          // Workflow being dragged over a folder
          const isSameParent = draggedSourceFolderRef.current === parentFolderId
          if (isSameParent) {
            // Same level - use three zones: top=before, middle=inside, bottom=after
            const position = calculateFolderDropPosition(e, e.currentTarget)
            setNormalizedDropIndicator({ targetId: folderId, position, folderId: parentFolderId })
            if (position === 'inside') {
              setHoverFolderId(folderId)
            } else {
              setHoverFolderId(null)
            }
          } else {
            // Different container - drop into folder
            setNormalizedDropIndicator({
              targetId: folderId,
              position: 'inside',
              folderId: parentFolderId,
            })
            setHoverFolderId(folderId)
          }
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setHoverFolderId(null)
      },
      onDrop: handleDrop,
    }),
    [
      initDragOver,
      calculateDropPosition,
      calculateFolderDropPosition,
      setNormalizedDropIndicator,
      isLeavingElement,
      handleDrop,
    ]
  )

  const createEmptyFolderDropZone = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        initDragOver(e)
        setNormalizedDropIndicator({ targetId: folderId, position: 'inside', folderId })
      },
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, handleDrop]
  )

  const createFolderContentDropZone = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
        lastDragYRef.current = e.clientY
        setIsDragging(true)
        if (e.target === e.currentTarget && draggedSourceFolderRef.current !== folderId) {
          setNormalizedDropIndicator({ targetId: folderId, position: 'inside', folderId: null })
        }
      },
      onDrop: handleDrop,
    }),
    [setNormalizedDropIndicator, handleDrop]
  )

  const createRootDropZone = useCallback(
    () => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        initDragOver(e, false)
        if (e.target === e.currentTarget) {
          setNormalizedDropIndicator({ targetId: 'root', position: 'inside', folderId: null })
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setNormalizedDropIndicator(null)
      },
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, isLeavingElement, handleDrop]
  )

  const handleDragStart = useCallback(
    (type: 'workflow' | 'folder', sourceFolderId: string | null) => {
      draggedTypeRef.current = type
      draggedSourceFolderRef.current = sourceFolderId
      setIsDragging(true)
    },
    []
  )

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    setDropIndicator(null)
    draggedTypeRef.current = null
    draggedSourceFolderRef.current = null
    setHoverFolderId(null)
  }, [])

  const setScrollContainer = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element
  }, [])

  const noopDragHandlers = {
    onDragOver: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
    onDrop: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
  }

  if (disabled) {
    return {
      dropIndicator: null,
      isDragging: false,
      disabled: true,
      setScrollContainer,
      createWorkflowDragHandlers: () => noopDragHandlers,
      createFolderDragHandlers: () => ({ ...noopDragHandlers, onDragLeave: () => {} }),
      createEmptyFolderDropZone: () => noopDragHandlers,
      createFolderContentDropZone: () => noopDragHandlers,
      createRootDropZone: () => ({ ...noopDragHandlers, onDragLeave: () => {} }),
      handleDragStart: () => {},
      handleDragEnd: () => {},
    }
  }

  return {
    dropIndicator,
    isDragging,
    disabled: false,
    setScrollContainer,
    createWorkflowDragHandlers,
    createFolderDragHandlers,
    createEmptyFolderDropZone,
    createFolderContentDropZone,
    createRootDropZone,
    handleDragStart,
    handleDragEnd,
  }
}
