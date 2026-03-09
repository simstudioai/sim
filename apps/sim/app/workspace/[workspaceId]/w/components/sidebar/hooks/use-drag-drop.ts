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
const DRAG_OVER_THROTTLE_MS = 16

export interface DropIndicator {
  targetId: string
  position: 'before' | 'after' | 'inside'
  folderId: string | null
}

interface UseDragDropOptions {
  disabled?: boolean
}

type SiblingItem = {
  type: 'folder' | 'workflow'
  id: string
  sortOrder: number
  createdAt: Date
}

export function useDragDrop(options: UseDragDropOptions = {}) {
  const { disabled = false } = options
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverFolderId, setHoverFolderId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollAnimationRef = useRef<number | null>(null)
  const hoverExpandTimerRef = useRef<number | null>(null)
  const lastDragYRef = useRef<number>(0)
  const lastDragOverTimeRef = useRef<number>(0)
  const draggedSourceFolderRef = useRef<string | null>(null)
  const siblingsCacheRef = useRef<Map<string, SiblingItem[]>>(new Map())

  const params = useParams()
  const workspaceId = params.workspaceId as string | undefined
  const reorderWorkflowsMutation = useReorderWorkflows()
  const reorderFoldersMutation = useReorderFolders()
  const { setExpanded, expandedFolders } = useFolderStore()

  const handleAutoScroll = useCallback(() => {
    if (!scrollContainerRef.current) {
      scrollAnimationRef.current = null
      return
    }

    const container = scrollContainerRef.current
    const rect = container.getBoundingClientRect()
    const mouseY = lastDragYRef.current

    if (mouseY < rect.top || mouseY > rect.bottom) {
      scrollAnimationRef.current = requestAnimationFrame(handleAutoScroll)
      return
    }

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

    scrollAnimationRef.current = requestAnimationFrame(handleAutoScroll)
  }, [])

  useEffect(() => {
    if (isDragging) {
      scrollAnimationRef.current = requestAnimationFrame(handleAutoScroll)
    } else if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current)
      scrollAnimationRef.current = null
    }

    return () => {
      if (scrollAnimationRef.current) {
        cancelAnimationFrame(scrollAnimationRef.current)
        scrollAnimationRef.current = null
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
      if (relativeY < height * 0.25) return 'before'
      if (relativeY > height * 0.75) return 'after'
      return 'inside'
    },
    []
  )

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

  const initDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>, stopPropagation = true): boolean => {
      e.preventDefault()
      if (stopPropagation) e.stopPropagation()
      lastDragYRef.current = e.clientY

      if (!isDragging) {
        setIsDragging(true)
      }

      const now = performance.now()
      if (now - lastDragOverTimeRef.current < DRAG_OVER_THROTTLE_MS) {
        return false
      }
      lastDragOverTimeRef.current = now
      return true
    },
    [isDragging]
  )

  const getSiblingItems = useCallback((folderId: string | null): SiblingItem[] => {
    const cacheKey = folderId ?? 'root'
    const cached = siblingsCacheRef.current.get(cacheKey)
    if (cached) return cached

    const currentFolders = useFolderStore.getState().folders
    const currentWorkflows = useWorkflowRegistry.getState().workflows
    const siblings = [
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

    siblingsCacheRef.current.set(cacheKey, siblings)
    return siblings
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

  const canMoveFolderTo = useCallback(
    (folderId: string, destinationFolderId: string | null): boolean => {
      if (folderId === destinationFolderId) return false
      if (!destinationFolderId) return true
      const targetPath = useFolderStore.getState().getFolderPath(destinationFolderId)
      return !targetPath.some((f) => f.id === folderId)
    },
    []
  )

  const collectMovingItems = useCallback(
    (
      workflowIds: string[],
      folderIds: string[],
      destinationFolderId: string | null
    ): { fromDestination: SiblingItem[]; fromOther: SiblingItem[] } => {
      const { folders } = useFolderStore.getState()
      const { workflows } = useWorkflowRegistry.getState()

      const fromDestination: SiblingItem[] = []
      const fromOther: SiblingItem[] = []

      for (const id of workflowIds) {
        const workflow = workflows[id]
        if (!workflow) continue
        const item: SiblingItem = {
          type: 'workflow',
          id,
          sortOrder: workflow.sortOrder,
          createdAt: workflow.createdAt,
        }
        if (workflow.folderId === destinationFolderId) {
          fromDestination.push(item)
        } else {
          fromOther.push(item)
        }
      }

      for (const id of folderIds) {
        const folder = folders[id]
        if (!folder) continue
        const item: SiblingItem = {
          type: 'folder',
          id,
          sortOrder: folder.sortOrder,
          createdAt: folder.createdAt,
        }
        if (folder.parentId === destinationFolderId) {
          fromDestination.push(item)
        } else {
          fromOther.push(item)
        }
      }

      fromDestination.sort(compareSiblingItems)
      fromOther.sort(compareSiblingItems)

      return { fromDestination, fromOther }
    },
    []
  )

  const handleSelectionDrop = useCallback(
    async (selection: { workflowIds: string[]; folderIds: string[] }, indicator: DropIndicator) => {
      if (!workspaceId) return

      const { workflowIds, folderIds } = selection
      if (workflowIds.length === 0 && folderIds.length === 0) return

      try {
        const destinationFolderId = getDestinationFolderId(indicator)
        const validFolderIds = folderIds.filter((id) => canMoveFolderTo(id, destinationFolderId))
        if (workflowIds.length === 0 && validFolderIds.length === 0) return

        const siblingItems = getSiblingItems(destinationFolderId)
        const movingIds = new Set([...workflowIds, ...validFolderIds])
        const remaining = siblingItems.filter((item) => !movingIds.has(item.id))

        const { fromDestination, fromOther } = collectMovingItems(
          workflowIds,
          validFolderIds,
          destinationFolderId
        )

        const insertAt = calculateInsertIndex(remaining, indicator)
        const newOrder = [
          ...remaining.slice(0, insertAt),
          ...fromDestination,
          ...fromOther,
          ...remaining.slice(insertAt),
        ]

        await buildAndSubmitUpdates(newOrder, destinationFolderId)

        const { clearSelection, clearFolderSelection } = useFolderStore.getState()
        clearSelection()
        clearFolderSelection()
      } catch (error) {
        logger.error('Failed to drop selection:', error)
      }
    },
    [
      workspaceId,
      getDestinationFolderId,
      canMoveFolderTo,
      getSiblingItems,
      collectMovingItems,
      calculateInsertIndex,
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
      siblingsCacheRef.current.clear()

      if (!indicator) return

      try {
        const selectionData = e.dataTransfer.getData('sidebar-selection')
        if (!selectionData) return

        const selection = JSON.parse(selectionData) as {
          workflowIds: string[]
          folderIds: string[]
        }
        await handleSelectionDrop(selection, indicator)
      } catch (error) {
        logger.error('Failed to handle drop:', error)
      }
    },
    [dropIndicator, handleSelectionDrop]
  )

  const createWorkflowDragHandlers = useCallback(
    (workflowId: string, folderId: string | null) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
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
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setNormalizedDropIndicator(null)
      },
      onDrop: handleDrop,
    }),
    [initDragOver, calculateDropPosition, setNormalizedDropIndicator, isLeavingElement, handleDrop]
  )

  const createFolderDragHandlers = useCallback(
    (folderId: string, parentFolderId: string | null) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        const isSameParent = draggedSourceFolderRef.current === parentFolderId
        if (isSameParent) {
          const position = calculateFolderDropPosition(e, e.currentTarget)
          setNormalizedDropIndicator({ targetId: folderId, position, folderId: parentFolderId })
          if (position === 'inside') {
            setHoverFolderId(folderId)
          } else {
            setHoverFolderId(null)
          }
        } else {
          setNormalizedDropIndicator({
            targetId: folderId,
            position: 'inside',
            folderId: parentFolderId,
          })
          setHoverFolderId(folderId)
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setHoverFolderId(null)
      },
      onDrop: handleDrop,
    }),
    [
      initDragOver,
      calculateFolderDropPosition,
      setNormalizedDropIndicator,
      isLeavingElement,
      handleDrop,
    ]
  )

  const createEmptyFolderDropZone = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        setNormalizedDropIndicator({ targetId: folderId, position: 'inside', folderId })
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setNormalizedDropIndicator(null)
      },
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, isLeavingElement, handleDrop]
  )

  const createFolderContentDropZone = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        if (e.target === e.currentTarget && draggedSourceFolderRef.current !== folderId) {
          setNormalizedDropIndicator({ targetId: folderId, position: 'inside', folderId: null })
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setNormalizedDropIndicator(null)
      },
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, isLeavingElement, handleDrop]
  )

  const createRootDropZone = useCallback(
    () => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e, false)) return
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

  const createEdgeDropZone = useCallback(
    (itemId: string | null, position: 'before' | 'after') => ({
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!initDragOver(e)) return
        if (itemId) {
          setDropIndicator({ targetId: itemId, position, folderId: null })
        } else {
          setNormalizedDropIndicator({ targetId: 'root', position: 'inside', folderId: null })
        }
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (isLeavingElement(e)) setDropIndicator(null)
      },
      onDrop: handleDrop,
    }),
    [initDragOver, setNormalizedDropIndicator, isLeavingElement, handleDrop]
  )

  const handleDragStart = useCallback((sourceFolderId: string | null) => {
    draggedSourceFolderRef.current = sourceFolderId
    setIsDragging(true)
  }, [])

  const handleDragEnd = useCallback(() => {
    setIsDragging(false)
    setDropIndicator(null)
    draggedSourceFolderRef.current = null
    setHoverFolderId(null)
    siblingsCacheRef.current.clear()
  }, [])

  const setScrollContainer = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element
  }, [])

  const noopDragHandlers = {
    onDragOver: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
    onDrop: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
    onDragLeave: () => {},
  }

  if (disabled) {
    return {
      dropIndicator: null,
      isDragging: false,
      disabled: true,
      setScrollContainer,
      createWorkflowDragHandlers: () => noopDragHandlers,
      createFolderDragHandlers: () => noopDragHandlers,
      createEmptyFolderDropZone: () => noopDragHandlers,
      createFolderContentDropZone: () => noopDragHandlers,
      createRootDropZone: () => noopDragHandlers,
      createEdgeDropZone: () => noopDragHandlers,
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
    createEdgeDropZone,
    handleDragStart,
    handleDragEnd,
  }
}
