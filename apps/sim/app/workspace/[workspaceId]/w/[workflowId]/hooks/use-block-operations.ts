import type React from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import type { Edge, Node } from 'reactflow'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import {
  calculatePasteOffset,
  clampPositionToContainer,
  clearDragHighlights,
  estimateBlockDimensions,
  filterProtectedBlocks,
  validateTriggerPaste,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { DEFAULT_PASTE_OFFSET } from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-constants'
import { getBlock } from '@/blocks'
import { useChatStore } from '@/stores/chat/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
import type { AddNotificationParams } from '@/stores/notifications'
import { usePanelEditorStore } from '@/stores/panel'
import { useVariablesStore } from '@/stores/variables/store'
import { getUniqueBlockName, prepareBlockState } from '@/stores/workflows/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('BlockOperations')

interface UseBlockOperationsProps {
  blocksRef: React.RefObject<Record<string, BlockState>>
  edges: Edge[]
  activeWorkflowId: string | null
  workflowIdParam: string
  workspaceId: string
  isExecuting: boolean
  effectivePermissions: { canEdit: boolean; canAdmin: boolean; canRead: boolean }
  clipboard: {
    blocks: Record<
      string,
      {
        id: string
        position: { x: number; y: number }
        type: string
        height?: number
        data?: Record<string, unknown>
      }
    >
  } | null
  contextMenuPosition: { x: number; y: number }
  setPendingSelection: (ids: string[]) => void
  setSelectedEdges: React.Dispatch<React.SetStateAction<Map<string, string>>>
  addNotification: (params: AddNotificationParams) => string
  collaborativeBatchAddBlocks: (...args: unknown[]) => void
  collaborativeBatchRemoveBlocks: (ids: string[]) => void
  collaborativeBatchRemoveEdges: (ids: string[], options?: Record<string, unknown>) => void
  collaborativeBatchToggleBlockEnabled: (ids: string[]) => void
  collaborativeBatchToggleBlockHandles: (ids: string[]) => void
  collaborativeBatchToggleLocked: (ids: string[]) => void
  preparePasteData: (offset: { x: number; y: number }) => {
    blocks: Record<string, BlockState>
    edges: Edge[]
    loops: Record<string, unknown>
    parallels: Record<string, unknown>
    subBlockValues: Record<string, Record<string, unknown>>
  } | null
  hasClipboard: () => boolean
  copyBlocks: (ids: string[]) => void
  resizeLoopNodesWrapper: () => void
  isPointInLoopNode: (position: { x: number; y: number }) => {
    loopId: string
    loopPosition: { x: number; y: number }
    dimensions: { width: number; height: number }
  } | null
  tryCreateAutoConnectEdge: (
    position: { x: number; y: number },
    targetBlockId: string,
    options: {
      targetParentId?: string | null
      existingChildBlocks?: { id: string; type: string; position: { x: number; y: number } }[]
      containerId?: string
    }
  ) => Edge | undefined
  contextMenuBlocks: Array<{
    id: string
    type: string
    parentId?: string
    parentType?: string
    locked?: boolean
    isParentLocked?: boolean
  }>
  handleRunFromBlock: (blockId: string, workflowId: string) => void
  handleRunUntilBlock: (blockId: string, workflowId: string) => void
  getLastExecutionSnapshot: (workflowId: string) => { executedBlocks: string[] } | undefined
  router: { push: (url: string) => void }
  getViewportCenter: () => { x: number; y: number }
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number }
  getNodes: () => Node[]
}

export function useBlockOperations({
  blocksRef,
  edges,
  activeWorkflowId,
  workflowIdParam,
  workspaceId,
  isExecuting,
  effectivePermissions,
  clipboard,
  contextMenuPosition,
  setPendingSelection,
  setSelectedEdges,
  addNotification,
  collaborativeBatchAddBlocks,
  collaborativeBatchRemoveBlocks,
  collaborativeBatchRemoveEdges,
  collaborativeBatchToggleBlockEnabled,
  collaborativeBatchToggleBlockHandles,
  collaborativeBatchToggleLocked,
  preparePasteData,
  hasClipboard,
  copyBlocks,
  resizeLoopNodesWrapper,
  isPointInLoopNode,
  tryCreateAutoConnectEdge,
  contextMenuBlocks,
  handleRunFromBlock,
  handleRunUntilBlock,
  getLastExecutionSnapshot,
  router,
  getViewportCenter,
  screenToFlowPosition,
  getNodes,
}: UseBlockOperationsProps) {
  const addBlock = useCallback(
    (
      id: string,
      type: string,
      name: string,
      position: { x: number; y: number },
      data?: Record<string, unknown>,
      parentId?: string,
      extent?: 'parent',
      autoConnectEdge?: Edge,
      triggerMode?: boolean,
      presetSubBlockValues?: Record<string, unknown>
    ) => {
      setPendingSelection([id])
      setSelectedEdges(new Map())

      const blockData: Record<string, unknown> = { ...(data || {}) }
      if (parentId) blockData.parentId = parentId
      if (extent) blockData.extent = extent

      const block = prepareBlockState({
        id,
        type,
        name,
        position,
        data: blockData,
        parentId,
        extent,
        triggerMode,
      })

      const subBlockValues: Record<string, Record<string, unknown>> = {}
      if (block.subBlocks && Object.keys(block.subBlocks).length > 0) {
        subBlockValues[id] = {}
        for (const [subBlockId, subBlock] of Object.entries(block.subBlocks)) {
          if (subBlock.value !== null && subBlock.value !== undefined) {
            subBlockValues[id][subBlockId] = subBlock.value
          }
        }
      }

      if (presetSubBlockValues) {
        if (!subBlockValues[id]) {
          subBlockValues[id] = {}
        }
        Object.assign(subBlockValues[id], presetSubBlockValues)
      }

      collaborativeBatchAddBlocks(
        [block],
        autoConnectEdge ? [autoConnectEdge] : [],
        {},
        {},
        subBlockValues
      )
      usePanelEditorStore.getState().setCurrentBlockId(id)
    },
    [collaborativeBatchAddBlocks, setSelectedEdges, setPendingSelection]
  )

  const removeEdgesForNode = useCallback(
    (blockId: string, edgesToRemove: Edge[]): void => {
      if (edgesToRemove.length === 0) return
      const edgeIds = edgesToRemove.map((edge) => edge.id)
      collaborativeBatchRemoveEdges(edgeIds, { skipUndoRedo: true })
      logger.debug('Removed edges for node', { blockId, edgeCount: edgesToRemove.length })
    },
    [collaborativeBatchRemoveEdges]
  )

  const checkTriggerConstraints = useCallback(
    (blockType: string): boolean => {
      const currentBlocks = blocksRef.current
      const triggerIssue = TriggerUtils.getTriggerAdditionIssue(currentBlocks, blockType)
      if (triggerIssue) {
        const message =
          triggerIssue.issue === 'legacy'
            ? 'Cannot add new trigger blocks when a legacy Start block exists. Available in newer workflows.'
            : `A workflow can only have one ${triggerIssue.triggerName} trigger block. Please remove the existing one before adding a new one.`
        addNotification({ level: 'error', message, workflowId: activeWorkflowId || undefined })
        return true
      }

      const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(currentBlocks, blockType)
      if (singleInstanceIssue) {
        addNotification({
          level: 'error',
          message: `A workflow can only have one ${singleInstanceIssue.blockName} block. Please remove the existing one before adding a new one.`,
          workflowId: activeWorkflowId || undefined,
        })
        return true
      }

      return false
    },
    [addNotification, activeWorkflowId]
  )

  const executePasteOperation = useCallback(
    (
      operation: 'paste' | 'duplicate',
      pasteOffset: { x: number; y: number },
      targetContainer?: {
        loopId: string
        loopPosition: { x: number; y: number }
        dimensions: { width: number; height: number }
      } | null,
      pasteTargetPosition?: { x: number; y: number }
    ) => {
      const currentBlocks = blocksRef.current

      let effectiveOffset = pasteOffset
      if (targetContainer && pasteTargetPosition && clipboard) {
        const clipboardBlocks = Object.values(clipboard.blocks)
        const hasNestedBlocks = clipboardBlocks.some((b) => b.data?.parentId)
        if (clipboardBlocks.length > 0 && !hasNestedBlocks) {
          const minX = Math.min(...clipboardBlocks.map((b) => b.position.x))
          const maxX = Math.max(
            ...clipboardBlocks.map((b) => b.position.x + BLOCK_DIMENSIONS.FIXED_WIDTH)
          )
          const minY = Math.min(...clipboardBlocks.map((b) => b.position.y))
          const maxY = Math.max(
            ...clipboardBlocks.map((b) => b.position.y + BLOCK_DIMENSIONS.MIN_HEIGHT)
          )
          const clipboardCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
          effectiveOffset = {
            x: pasteTargetPosition.x - clipboardCenter.x,
            y: pasteTargetPosition.y - clipboardCenter.y,
          }
        }
      }

      const pasteData = preparePasteData(effectiveOffset)
      if (!pasteData) return

      let pastedBlocksArray = Object.values(pasteData.blocks)

      if (targetContainer) {
        const hasTrigger = pastedBlocksArray.some((b) => TriggerUtils.isTriggerBlock(b))
        if (hasTrigger) {
          addNotification({
            level: 'error',
            message: 'Triggers cannot be placed inside loop or parallel subflows.',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }

        const ancestorIds = new Set<string>()
        let walkId: string | undefined = targetContainer.loopId
        while (walkId && !ancestorIds.has(walkId)) {
          ancestorIds.add(walkId)
          walkId = currentBlocks[walkId]?.data?.parentId as string | undefined
        }
        const originalClipboardBlocks = clipboard ? Object.values(clipboard.blocks) : []
        const wouldCreateCycle = originalClipboardBlocks.some(
          (b) => (b.type === 'loop' || b.type === 'parallel') && ancestorIds.has(b.id)
        )
        if (wouldCreateCycle) {
          addNotification({
            level: 'error',
            message: 'Cannot paste a subflow inside itself or its own descendant.',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }

        pastedBlocksArray = pastedBlocksArray.map((block) => {
          const wasNested = Boolean(block.data?.parentId)
          const relativePosition = wasNested
            ? { x: block.position.x, y: block.position.y }
            : {
                x: block.position.x - targetContainer.loopPosition.x,
                y: block.position.y - targetContainer.loopPosition.y,
              }

          const clampedPosition = {
            x: Math.max(
              CONTAINER_DIMENSIONS.LEFT_PADDING,
              Math.min(
                relativePosition.x,
                targetContainer.dimensions.width -
                  BLOCK_DIMENSIONS.FIXED_WIDTH -
                  CONTAINER_DIMENSIONS.RIGHT_PADDING
              )
            ),
            y: Math.max(
              CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING,
              Math.min(
                relativePosition.y,
                targetContainer.dimensions.height -
                  BLOCK_DIMENSIONS.MIN_HEIGHT -
                  CONTAINER_DIMENSIONS.BOTTOM_PADDING
              )
            ),
          }

          return {
            ...block,
            position: clampedPosition,
            data: {
              ...block.data,
              parentId: targetContainer.loopId,
              extent: 'parent',
            },
          }
        })

        pasteData.blocks = pastedBlocksArray.reduce(
          (acc, block) => {
            acc[block.id] = block
            return acc
          },
          {} as Record<string, (typeof pastedBlocksArray)[0]>
        )
      }

      const validation = validateTriggerPaste(pastedBlocksArray, currentBlocks, operation)
      if (!validation.isValid) {
        addNotification({
          level: 'error',
          message: validation.message!,
          workflowId: activeWorkflowId || undefined,
        })
        return
      }

      setPendingSelection(pastedBlocksArray.map((b) => b.id))

      collaborativeBatchAddBlocks(
        pastedBlocksArray,
        pasteData.edges,
        pasteData.loops,
        pasteData.parallels,
        pasteData.subBlockValues
      )

      if (targetContainer) {
        resizeLoopNodesWrapper()
      }
    },
    [
      preparePasteData,
      clipboard,
      addNotification,
      activeWorkflowId,
      collaborativeBatchAddBlocks,
      setPendingSelection,
      resizeLoopNodesWrapper,
    ]
  )

  const handleToolbarDrop = useCallback(
    (data: { type: string; enableTriggerMode?: boolean }, position: { x: number; y: number }) => {
      if (!data.type || data.type === 'connectionBlock') return

      try {
        const currentBlocks = blocksRef.current
        const containerInfo = isPointInLoopNode(position)
        clearDragHighlights()

        if (data.type === 'loop' || data.type === 'parallel') {
          const id = crypto.randomUUID()
          const baseName = data.type === 'loop' ? 'Loop' : 'Parallel'
          const name = getUniqueBlockName(baseName, currentBlocks)

          if (containerInfo) {
            const rawPosition = {
              x: position.x - containerInfo.loopPosition.x,
              y: position.y - containerInfo.loopPosition.y,
            }
            const relativePosition = clampPositionToContainer(
              rawPosition,
              containerInfo.dimensions,
              {
                width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
                height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
              }
            )
            const existingChildBlocks = Object.values(currentBlocks)
              .filter((b) => b.data?.parentId === containerInfo.loopId)
              .map((b) => ({ id: b.id, type: b.type, position: b.position }))
            const autoConnectEdge = tryCreateAutoConnectEdge(relativePosition, id, {
              targetParentId: containerInfo.loopId,
              existingChildBlocks,
              containerId: containerInfo.loopId,
            })
            addBlock(
              id,
              data.type,
              name,
              relativePosition,
              {
                width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
                height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
                type: 'subflowNode',
                parentId: containerInfo.loopId,
                extent: 'parent',
              },
              containerInfo.loopId,
              'parent',
              autoConnectEdge
            )
            resizeLoopNodesWrapper()
          } else {
            const autoConnectEdge = tryCreateAutoConnectEdge(position, id, { targetParentId: null })
            addBlock(
              id,
              data.type,
              name,
              position,
              {
                width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
                height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
                type: 'subflowNode',
              },
              undefined,
              undefined,
              autoConnectEdge
            )
          }
          return
        }

        const blockConfig = getBlock(data.type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { data })
          return
        }

        const id = crypto.randomUUID()
        const defaultTriggerNameDrop = TriggerUtils.getDefaultTriggerName(data.type)
        const baseName = defaultTriggerNameDrop || blockConfig.name
        const name = getUniqueBlockName(baseName, currentBlocks)

        if (containerInfo) {
          const isTriggerBlock =
            blockConfig.category === 'triggers' ||
            blockConfig.triggers?.enabled ||
            data.enableTriggerMode === true
          if (isTriggerBlock) {
            addNotification({
              level: 'error',
              message: 'Triggers cannot be placed inside loop or parallel subflows.',
              workflowId: activeWorkflowId || undefined,
            })
            return
          }

          const rawPosition = {
            x: position.x - containerInfo.loopPosition.x,
            y: position.y - containerInfo.loopPosition.y,
          }
          const relativePosition = clampPositionToContainer(
            rawPosition,
            containerInfo.dimensions,
            estimateBlockDimensions(data.type)
          )
          const existingChildBlocks = Object.values(currentBlocks)
            .filter((b) => b.data?.parentId === containerInfo.loopId)
            .map((b) => ({ id: b.id, type: b.type, position: b.position }))
          const autoConnectEdge = tryCreateAutoConnectEdge(relativePosition, id, {
            targetParentId: containerInfo.loopId,
            existingChildBlocks,
            containerId: containerInfo.loopId,
          })
          addBlock(
            id,
            data.type,
            name,
            relativePosition,
            {
              parentId: containerInfo.loopId,
              extent: 'parent',
            },
            containerInfo.loopId,
            'parent',
            autoConnectEdge
          )
          resizeLoopNodesWrapper()
        } else {
          if (checkTriggerConstraints(data.type)) return
          const autoConnectEdge = tryCreateAutoConnectEdge(position, id, { targetParentId: null })
          const enableTriggerMode = data.enableTriggerMode || false
          addBlock(
            id,
            data.type,
            name,
            position,
            undefined,
            undefined,
            undefined,
            autoConnectEdge,
            enableTriggerMode
          )
        }
      } catch (err) {
        logger.error('Error handling toolbar drop on workflow canvas', { err })
      }
    },
    [
      isPointInLoopNode,
      resizeLoopNodesWrapper,
      addBlock,
      addNotification,
      activeWorkflowId,
      tryCreateAutoConnectEdge,
      checkTriggerConstraints,
    ]
  )

  const handleContextCopy = useCallback(() => {
    copyBlocks(contextMenuBlocks.map((b) => b.id))
  }, [contextMenuBlocks, copyBlocks])

  const handleContextPaste = useCallback(() => {
    if (!hasClipboard()) return
    const flowPosition = screenToFlowPosition(contextMenuPosition)
    const targetContainer = isPointInLoopNode(flowPosition)
    executePasteOperation(
      'paste',
      calculatePasteOffset(clipboard, getViewportCenter()),
      targetContainer,
      flowPosition
    )
  }, [
    hasClipboard,
    executePasteOperation,
    clipboard,
    getViewportCenter,
    screenToFlowPosition,
    contextMenuPosition,
    isPointInLoopNode,
  ])

  const handleContextDuplicate = useCallback(() => {
    copyBlocks(contextMenuBlocks.map((b) => b.id))
    executePasteOperation('duplicate', DEFAULT_PASTE_OFFSET)
  }, [contextMenuBlocks, copyBlocks, executePasteOperation])

  const handleContextDelete = useCallback(() => {
    const blockIds = contextMenuBlocks.map((b) => b.id)
    const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(
      blockIds,
      blocksRef.current
    )
    if (protectedIds.length > 0) {
      if (allProtected) {
        addNotification({
          level: 'info',
          message: 'Cannot delete locked blocks or blocks inside locked containers',
          workflowId: activeWorkflowId || undefined,
        })
        return
      }
      addNotification({
        level: 'info',
        message: `Skipped ${protectedIds.length} protected block(s)`,
        workflowId: activeWorkflowId || undefined,
      })
    }
    if (deletableIds.length > 0) collaborativeBatchRemoveBlocks(deletableIds)
  }, [contextMenuBlocks, collaborativeBatchRemoveBlocks, addNotification, activeWorkflowId])

  const handleContextToggleEnabled = useCallback(() => {
    collaborativeBatchToggleBlockEnabled(contextMenuBlocks.map((b) => b.id))
  }, [contextMenuBlocks, collaborativeBatchToggleBlockEnabled])

  const handleContextToggleHandles = useCallback(() => {
    collaborativeBatchToggleBlockHandles(contextMenuBlocks.map((b) => b.id))
  }, [contextMenuBlocks, collaborativeBatchToggleBlockHandles])

  const handleContextToggleLocked = useCallback(() => {
    collaborativeBatchToggleLocked(contextMenuBlocks.map((b) => b.id))
  }, [contextMenuBlocks, collaborativeBatchToggleLocked])

  const handleContextRemoveFromSubflow = useCallback(() => {
    const blocksToRemove = contextMenuBlocks.filter(
      (block) => block.parentId && (block.parentType === 'loop' || block.parentType === 'parallel')
    )
    if (blocksToRemove.length > 0) {
      window.dispatchEvent(
        new CustomEvent('remove-from-subflow', {
          detail: { blockIds: blocksToRemove.map((b) => b.id) },
        })
      )
    }
  }, [contextMenuBlocks])

  const handleContextOpenEditor = useCallback(() => {
    if (contextMenuBlocks.length === 1)
      usePanelEditorStore.getState().setCurrentBlockId(contextMenuBlocks[0].id)
  }, [contextMenuBlocks])

  const handleContextRename = useCallback(() => {
    if (contextMenuBlocks.length === 1) {
      usePanelEditorStore.getState().setCurrentBlockId(contextMenuBlocks[0].id)
      usePanelEditorStore.getState().triggerRename()
    }
  }, [contextMenuBlocks])

  const handleContextRunFromBlock = useCallback(() => {
    if (contextMenuBlocks.length !== 1) return
    handleRunFromBlock(contextMenuBlocks[0].id, workflowIdParam)
  }, [contextMenuBlocks, workflowIdParam, handleRunFromBlock])

  const handleContextRunUntilBlock = useCallback(() => {
    if (contextMenuBlocks.length !== 1) return
    handleRunUntilBlock(contextMenuBlocks[0].id, workflowIdParam)
  }, [contextMenuBlocks, workflowIdParam, handleRunUntilBlock])

  const runFromBlockState = useMemo(() => {
    if (contextMenuBlocks.length !== 1) return { canRun: false, reason: undefined }
    const block = contextMenuBlocks[0]
    const snapshot = getLastExecutionSnapshot(workflowIdParam)
    const incomingEdges = edges.filter((edge) => edge.target === block.id)
    const isTriggerBlock = incomingEdges.length === 0

    const isSourceSatisfied = (sourceId: string) => {
      if (snapshot?.executedBlocks.includes(sourceId)) return true
      return edges.filter((edge) => edge.target === sourceId).length === 0
    }

    const dependenciesSatisfied =
      isTriggerBlock || (snapshot && incomingEdges.every((edge) => isSourceSatisfied(edge.source)))
    const isNoteBlock = block.type === 'note'
    const isInsideSubflow =
      block.parentId && (block.parentType === 'loop' || block.parentType === 'parallel')

    if (isInsideSubflow) return { canRun: false, reason: 'Cannot run from inside subflow' }
    if (!dependenciesSatisfied) return { canRun: false, reason: 'Run previous blocks first' }
    if (isNoteBlock) return { canRun: false, reason: undefined }
    if (isExecuting) return { canRun: false, reason: undefined }

    return { canRun: true, reason: undefined }
  }, [contextMenuBlocks, edges, workflowIdParam, getLastExecutionSnapshot, isExecuting])

  const handleContextAddBlock = useCallback(() => {
    useSearchModalStore.getState().open()
  }, [])
  const handleContextOpenLogs = useCallback(() => {
    router.push(`/workspace/${workspaceId}/logs?workflowIds=${workflowIdParam}`)
  }, [router, workspaceId, workflowIdParam])
  const handleContextToggleVariables = useCallback(() => {
    const { isOpen, setIsOpen } = useVariablesStore.getState()
    setIsOpen(!isOpen)
  }, [])
  const handleContextToggleChat = useCallback(() => {
    const { isChatOpen, setIsChatOpen } = useChatStore.getState()
    setIsChatOpen(!isChatOpen)
  }, [])

  useEffect(() => {
    const handleAddBlockFromToolbar = (event: Event) => {
      if (!effectivePermissions.canEdit) return
      const { type, enableTriggerMode, presetOperation } = (event as CustomEvent).detail
      if (!type || type === 'connectionBlock') return

      const currentBlocks = blocksRef.current
      const basePosition = getViewportCenter()

      if (type === 'loop' || type === 'parallel') {
        const id = crypto.randomUUID()
        const baseName = type === 'loop' ? 'Loop' : 'Parallel'
        const name = getUniqueBlockName(baseName, currentBlocks)
        const autoConnectEdge = tryCreateAutoConnectEdge(basePosition, id, { targetParentId: null })
        addBlock(
          id,
          type,
          name,
          basePosition,
          {
            width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
            height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
            type: 'subflowNode',
          },
          undefined,
          undefined,
          autoConnectEdge
        )
        return
      }

      const blockConfig = getBlock(type)
      if (!blockConfig) {
        logger.error('Invalid block type:', { type })
        return
      }
      if (checkTriggerConstraints(type)) return

      const id = crypto.randomUUID()
      const defaultTriggerName = TriggerUtils.getDefaultTriggerName(type)
      const baseName = defaultTriggerName || blockConfig.name
      const name = getUniqueBlockName(baseName, currentBlocks)
      const autoConnectEdge = tryCreateAutoConnectEdge(basePosition, id, { targetParentId: null })
      addBlock(
        id,
        type,
        name,
        basePosition,
        undefined,
        undefined,
        undefined,
        autoConnectEdge,
        enableTriggerMode,
        presetOperation ? { operation: presetOperation } : undefined
      )
    }

    const handleOverlayToolbarDrop = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          type: string
          enableTriggerMode?: boolean
          clientX: number
          clientY: number
        }>
      ).detail
      if (!detail?.type) return
      try {
        const canvasElement = document.querySelector('.workflow-container') as HTMLElement | null
        if (!canvasElement) {
          logger.warn('Workflow canvas element not found')
          return
        }
        const bounds = canvasElement.getBoundingClientRect()
        const position = screenToFlowPosition({
          x: detail.clientX - bounds.left,
          y: detail.clientY - bounds.top,
        })
        handleToolbarDrop(
          { type: detail.type, enableTriggerMode: detail.enableTriggerMode ?? false },
          position
        )
      } catch (err) {
        logger.error('Error handling toolbar drop from overlay', { err })
      }
    }

    window.addEventListener('add-block-from-toolbar', handleAddBlockFromToolbar as EventListener)
    window.addEventListener(
      'toolbar-drop-on-empty-workflow-overlay',
      handleOverlayToolbarDrop as EventListener
    )
    return () => {
      window.removeEventListener(
        'add-block-from-toolbar',
        handleAddBlockFromToolbar as EventListener
      )
      window.removeEventListener(
        'toolbar-drop-on-empty-workflow-overlay',
        handleOverlayToolbarDrop as EventListener
      )
    }
  }, [
    getViewportCenter,
    addBlock,
    effectivePermissions.canEdit,
    checkTriggerConstraints,
    tryCreateAutoConnectEdge,
    screenToFlowPosition,
    handleToolbarDrop,
  ])

  return {
    addBlock,
    removeEdgesForNode,
    checkTriggerConstraints,
    executePasteOperation,
    handleToolbarDrop,
    handleContextCopy,
    handleContextPaste,
    handleContextDuplicate,
    handleContextDelete,
    handleContextToggleEnabled,
    handleContextToggleHandles,
    handleContextToggleLocked,
    handleContextRemoveFromSubflow,
    handleContextOpenEditor,
    handleContextRename,
    handleContextRunFromBlock,
    handleContextRunUntilBlock,
    runFromBlockState,
    handleContextAddBlock,
    handleContextOpenLogs,
    handleContextToggleVariables,
    handleContextToggleChat,
  }
}
