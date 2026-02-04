'use client'

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  applyNodeChanges,
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { createLogger } from '@sim/logger'
import { useShallow } from 'zustand/react/shallow'
import { useSession } from '@/lib/auth/auth-client'
import type { OAuthConnectEventDetail } from '@/lib/copilot/tools/client/other/oauth-request-access'
import type { OAuthProvider } from '@/lib/oauth'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  CommandList,
  DiffControls,
  Notifications,
  Panel,
  SubflowNodeComponent,
  Terminal,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { BlockMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/block-menu'
import { CanvasMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/canvas-menu'
import { Cursors } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/cursors/cursors'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error/index'
import { NoteBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block'
import type { SubflowNodeData } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { TrainingModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/training-modal/training-modal'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowControls } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-controls/workflow-controls'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'
import {
  useAutoLayout,
  useCanvasContextMenu,
  useCurrentWorkflow,
  useNodeUtilities,
  useShiftSelectionLock,
  useWorkflowExecution,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  calculateContainerDimensions,
  clampPositionToContainer,
  clearDragHighlights,
  computeClampedPositionUpdates,
  estimateBlockDimensions,
  filterProtectedBlocks,
  getClampedPositionForNode,
  isBlockProtected,
  isEdgeProtected,
  isInEditableElement,
  resolveParentChildSelectionConflicts,
  validateTriggerPaste,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { getBlock } from '@/blocks'
import { isAnnotationOnlyBlock } from '@/executor/constants'
import { useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { useAutoConnect, useSnapToGridSize } from '@/hooks/queries/general-settings'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useStreamCleanup } from '@/hooks/use-stream-cleanup'
import { useCanvasModeStore } from '@/stores/canvas-mode'
import { useChatStore } from '@/stores/chat/store'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'
import { useExecutionStore } from '@/stores/execution'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useNotificationStore } from '@/stores/notifications'
import { useCopilotStore, usePanelEditorStore } from '@/stores/panel'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useVariablesStore } from '@/stores/variables/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getUniqueBlockName, prepareBlockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** Lazy-loaded components for non-critical UI that can load after initial render */
const LazyChat = lazy(() =>
  import('@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/chat').then((mod) => ({
    default: mod.Chat,
  }))
)
const LazyOAuthRequiredModal = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
  ).then((mod) => ({ default: mod.OAuthRequiredModal }))
)

const logger = createLogger('Workflow')

const DEFAULT_PASTE_OFFSET = { x: 50, y: 50 }

/**
 * Calculates the offset to paste blocks at viewport center
 */
function calculatePasteOffset(
  clipboard: {
    blocks: Record<string, { position: { x: number; y: number }; type: string; height?: number }>
  } | null,
  viewportCenter: { x: number; y: number }
): { x: number; y: number } {
  if (!clipboard) return DEFAULT_PASTE_OFFSET

  const clipboardBlocks = Object.values(clipboard.blocks)
  if (clipboardBlocks.length === 0) return DEFAULT_PASTE_OFFSET

  const minX = Math.min(...clipboardBlocks.map((b) => b.position.x))
  const maxX = Math.max(
    ...clipboardBlocks.map((b) => {
      const width =
        b.type === 'loop' || b.type === 'parallel'
          ? CONTAINER_DIMENSIONS.DEFAULT_WIDTH
          : BLOCK_DIMENSIONS.FIXED_WIDTH
      return b.position.x + width
    })
  )
  const minY = Math.min(...clipboardBlocks.map((b) => b.position.y))
  const maxY = Math.max(
    ...clipboardBlocks.map((b) => {
      const height =
        b.type === 'loop' || b.type === 'parallel'
          ? CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
          : Math.max(b.height || BLOCK_DIMENSIONS.MIN_HEIGHT, BLOCK_DIMENSIONS.MIN_HEIGHT)
      return b.position.y + height
    })
  )
  const clipboardCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }

  return {
    x: viewportCenter.x - clipboardCenter.x,
    y: viewportCenter.y - clipboardCenter.y,
  }
}

function mapEdgesByNode(edges: Edge[], nodeIds: Set<string>): Map<string, Edge[]> {
  const result = new Map<string, Edge[]>()
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source)) {
      const list = result.get(edge.source) ?? []
      list.push(edge)
      result.set(edge.source, list)
      return
    }
    if (nodeIds.has(edge.target)) {
      const list = result.get(edge.target) ?? []
      list.push(edge)
      result.set(edge.target, list)
    }
  })
  return result
}

/**
 * Syncs the panel editor with the current selection state.
 * Shows block details when exactly one block is selected, clears otherwise.
 */
function syncPanelWithSelection(selectedIds: string[]) {
  const { currentBlockId, clearCurrentBlock, setCurrentBlockId } = usePanelEditorStore.getState()
  if (selectedIds.length === 1 && selectedIds[0] !== currentBlockId) {
    setCurrentBlockId(selectedIds[0])
  } else if (selectedIds.length === 0 && currentBlockId) {
    clearCurrentBlock()
  } else if (selectedIds.length > 1 && currentBlockId) {
    clearCurrentBlock()
  }
}

/** Custom node types for ReactFlow. */
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  noteBlock: NoteBlock,
  subflowNode: SubflowNodeComponent,
}

/** Custom edge types for ReactFlow. */
const edgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge,
}

/** ReactFlow configuration constants. */
const defaultEdgeOptions = { type: 'custom' }

const reactFlowStyles = [
  'bg-[var(--bg)]',
  '[&_.react-flow__edges]:!z-0',
  '[&_.react-flow__node]:!z-[21]',
  '[&_.react-flow__handle]:!z-[30]',
  '[&_.react-flow__edge-labels]:!z-[60]',
  '[&_.react-flow__pane]:!bg-[var(--bg)]',
  '[&_.react-flow__pane]:select-none',
  '[&_.react-flow__selectionpane]:select-none',
  '[&_.react-flow__renderer]:!bg-[var(--bg)]',
  '[&_.react-flow__viewport]:!bg-[var(--bg)]',
  '[&_.react-flow__background]:hidden',
].join(' ')
const reactFlowFitViewOptions = { padding: 0.6, maxZoom: 1.0 } as const
const reactFlowProOptions = { hideAttribution: true } as const

/**
 * Map from edge contextId to edge id.
 * Context IDs include parent loop info for edges inside loops.
 * The actual edge ID is stored as the value for deletion operations.
 */
type SelectedEdgesMap = Map<string, string>

interface BlockData {
  id: string
  type: string
  position: { x: number; y: number }
}

/**
 * Main workflow canvas content component.
 * Renders the ReactFlow canvas with blocks, edges, and all interactive features.
 */
const WorkflowContent = React.memo(() => {
  const [isCanvasReady, setIsCanvasReady] = useState(false)
  const [potentialParentId, setPotentialParentId] = useState<string | null>(null)
  const [selectedEdges, setSelectedEdges] = useState<SelectedEdgesMap>(new Map())
  const [isErrorConnectionDrag, setIsErrorConnectionDrag] = useState(false)
  const selectedIdsRef = useRef<string[] | null>(null)
  const canvasMode = useCanvasModeStore((state) => state.mode)
  const isHandMode = canvasMode === 'hand'
  const { handleCanvasMouseDown, selectionProps } = useShiftSelectionLock({ isHandMode })
  const [oauthModal, setOauthModal] = useState<{
    provider: OAuthProvider
    serviceId: string
    providerName: string
    requiredScopes: string[]
    newScopes?: string[]
  } | null>(null)

  const params = useParams()
  const router = useRouter()
  const reactFlowInstance = useReactFlow()
  const { screenToFlowPosition, getNodes, setNodes, getIntersectingNodes } = reactFlowInstance
  const { fitViewToBounds, getViewportCenter } = useCanvasViewport(reactFlowInstance)
  const { emitCursorUpdate } = useSocket()

  const workspaceId = params.workspaceId as string
  const workflowIdParam = params.workflowId as string

  const addNotification = useNotificationStore((state) => state.addNotification)

  const {
    workflows,
    activeWorkflowId,
    hydration,
    setActiveWorkflow,
    copyBlocks,
    preparePasteData,
    hasClipboard,
    clipboard,
    pendingSelection,
    setPendingSelection,
    clearPendingSelection,
  } = useWorkflowRegistry(
    useShallow((state) => ({
      workflows: state.workflows,
      activeWorkflowId: state.activeWorkflowId,
      hydration: state.hydration,
      setActiveWorkflow: state.setActiveWorkflow,
      copyBlocks: state.copyBlocks,
      preparePasteData: state.preparePasteData,
      hasClipboard: state.hasClipboard,
      clipboard: state.clipboard,
      pendingSelection: state.pendingSelection,
      setPendingSelection: state.setPendingSelection,
      clearPendingSelection: state.clearPendingSelection,
    }))
  )

  const currentWorkflow = useCurrentWorkflow()

  // Undo/redo availability for context menu
  const { data: session } = useSession()
  const userId = session?.user?.id || 'unknown'
  const undoRedoStacks = useUndoRedoStore((s) => s.stacks)
  const undoRedoKey = activeWorkflowId && userId ? `${activeWorkflowId}:${userId}` : ''
  const undoRedoStack = (undoRedoKey && undoRedoStacks[undoRedoKey]) || { undo: [], redo: [] }
  const canUndo = undoRedoStack.undo.length > 0
  const canRedo = undoRedoStack.redo.length > 0

  const { updateNodeDimensions, setDragStartPosition, getDragStartPosition } = useWorkflowStore(
    useShallow((state) => ({
      updateNodeDimensions: state.updateNodeDimensions,
      setDragStartPosition: state.setDragStartPosition,
      getDragStartPosition: state.getDragStartPosition,
    }))
  )

  const copilotCleanup = useCopilotStore((state) => state.cleanup)

  const showTrainingModal = useCopilotTrainingStore((state) => state.showModal)

  const { handleRunFromBlock, handleRunUntilBlock } = useWorkflowExecution()

  const snapToGridSize = useSnapToGridSize()
  const snapToGrid = snapToGridSize > 0

  const isAutoConnectEnabled = useAutoConnect()
  const autoConnectRef = useRef(isAutoConnectEnabled)
  useEffect(() => {
    autoConnectRef.current = isAutoConnectEnabled
  }, [isAutoConnectEnabled])

  // Panel open states for context menu
  const isVariablesOpen = useVariablesStore((state) => state.isOpen)
  const isChatOpen = useChatStore((state) => state.isChatOpen)

  const snapGrid: [number, number] = useMemo(
    () => [snapToGridSize, snapToGridSize],
    [snapToGridSize]
  )

  useStreamCleanup(copilotCleanup)

  const { blocks, edges, lastSaved } = currentWorkflow

  const isWorkflowReady = useMemo(
    () =>
      hydration.phase === 'ready' &&
      hydration.workflowId === workflowIdParam &&
      activeWorkflowId === workflowIdParam &&
      Boolean(workflows[workflowIdParam]) &&
      lastSaved !== undefined,
    [hydration.phase, hydration.workflowId, workflowIdParam, activeWorkflowId, workflows, lastSaved]
  )

  const {
    getNodeDepth,
    getNodeAbsolutePosition,
    calculateRelativePosition,
    isPointInLoopNode,
    resizeLoopNodes,
    updateNodeParent: updateNodeParentUtil,
    getNodeAnchorPosition,
    getBlockDimensions,
  } = useNodeUtilities(blocks)

  const resizeLoopNodesWrapper = useCallback(() => {
    return resizeLoopNodes(updateNodeDimensions)
  }, [resizeLoopNodes, updateNodeDimensions])

  /** Checks if a node can be placed inside a container (loop/parallel). */
  const canNodeEnterContainer = useCallback(
    (node: Node): boolean => {
      if (node.data?.type === 'starter') return false
      if (node.type === 'subflowNode') return false
      const block = blocks[node.id]
      return !(block && TriggerUtils.isTriggerBlock(block))
    },
    [blocks]
  )

  /** Shifts position updates to ensure nodes stay within container bounds. */
  const shiftUpdatesToContainerBounds = useCallback(
    <T extends { newPosition: { x: number; y: number } }>(rawUpdates: T[]): T[] => {
      if (rawUpdates.length === 0) return rawUpdates

      const minX = Math.min(...rawUpdates.map((u) => u.newPosition.x))
      const minY = Math.min(...rawUpdates.map((u) => u.newPosition.y))

      const targetMinX = CONTAINER_DIMENSIONS.LEFT_PADDING
      const targetMinY = CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING

      const shiftX = minX < targetMinX ? targetMinX - minX : 0
      const shiftY = minY < targetMinY ? targetMinY - minY : 0

      if (shiftX === 0 && shiftY === 0) return rawUpdates

      return rawUpdates.map((u) => ({
        ...u,
        newPosition: {
          x: u.newPosition.x + shiftX,
          y: u.newPosition.y + shiftY,
        },
      }))
    },
    []
  )

  /** Applies highlight styling to a container node during drag operations. */
  const highlightContainerNode = useCallback(
    (containerId: string, containerKind: 'loop' | 'parallel') => {
      clearDragHighlights()
      const containerElement = document.querySelector(`[data-id="${containerId}"]`)
      if (containerElement) {
        containerElement.classList.add(
          containerKind === 'loop' ? 'loop-node-drag-over' : 'parallel-node-drag-over'
        )
        document.body.style.cursor = 'copy'
      }
    },
    []
  )

  const { handleAutoLayout: autoLayoutWithFitView } = useAutoLayout(activeWorkflowId || null)

  const isWorkflowEmpty = useMemo(() => Object.keys(blocks).length === 0, [blocks])

  /** Handles OAuth connect events dispatched by Copilot tools. */
  useEffect(() => {
    const handleOpenOAuthConnect = (event: Event) => {
      const detail = (event as CustomEvent<OAuthConnectEventDetail>).detail
      if (!detail) return
      setOauthModal({
        provider: detail.providerId as OAuthProvider,
        serviceId: detail.serviceId,
        providerName: detail.providerName,
        requiredScopes: detail.requiredScopes || [],
        newScopes: detail.newScopes || [],
      })
    }

    window.addEventListener('open-oauth-connect', handleOpenOAuthConnect as EventListener)
    return () =>
      window.removeEventListener('open-oauth-connect', handleOpenOAuthConnect as EventListener)
  }, [])

  const { diffAnalysis, isShowingDiff, isDiffReady, reapplyDiffMarkers, hasActiveDiff } =
    useWorkflowDiffStore(
      useShallow((state) => ({
        diffAnalysis: state.diffAnalysis,
        isShowingDiff: state.isShowingDiff,
        isDiffReady: state.isDiffReady,
        reapplyDiffMarkers: state.reapplyDiffMarkers,
        hasActiveDiff: state.hasActiveDiff,
      }))
    )

  /** Stores source node/handle info when a connection drag starts for drop-on-block detection. */
  const connectionSourceRef = useRef<{ nodeId: string; handleId: string } | null>(null)

  /** Tracks whether onConnect successfully handled the connection (ReactFlow pattern). */
  const connectionCompletedRef = useRef(false)

  /** Stores start positions for multi-node drag undo/redo recording. */
  const multiNodeDragStartRef = useRef<Map<string, { x: number; y: number; parentId?: string }>>(
    new Map()
  )

  /** Re-applies diff markers when blocks change after socket rehydration. */
  const blocksRef = useRef(blocks)
  useEffect(() => {
    if (!isWorkflowReady) return
    if (hasActiveDiff && isDiffReady && blocks !== blocksRef.current) {
      blocksRef.current = blocks
      setTimeout(() => reapplyDiffMarkers(), 0)
    }
  }, [blocks, hasActiveDiff, isDiffReady, reapplyDiffMarkers, isWorkflowReady])

  /** Reconstructs deleted edges for diff view and filters invalid edges. */
  const edgesForDisplay = useMemo(() => {
    let edgesToFilter = edges

    if (!isShowingDiff && isDiffReady && diffAnalysis?.edge_diff?.deleted_edges) {
      const reconstructedEdges: Edge[] = []
      const validHandles = ['source', 'target', 'success', 'error', 'default', 'condition']

      diffAnalysis.edge_diff.deleted_edges.forEach((edgeIdentifier) => {
        const parts = edgeIdentifier.split('-')
        if (parts.length >= 4) {
          let sourceEndIndex = -1
          let targetStartIndex = -1

          for (let i = 1; i < parts.length - 1; i++) {
            if (validHandles.includes(parts[i])) {
              sourceEndIndex = i
              for (let j = i + 1; j < parts.length - 1; j++) {
                if (parts[j].length > 0) {
                  targetStartIndex = j
                  break
                }
              }
              break
            }
          }

          if (sourceEndIndex > 0 && targetStartIndex > 0) {
            const sourceId = parts.slice(0, sourceEndIndex).join('-')
            const sourceHandle = parts[sourceEndIndex]
            const targetHandle = parts[parts.length - 1]
            const targetId = parts.slice(targetStartIndex, parts.length - 1).join('-')

            if (blocks[sourceId] && blocks[targetId]) {
              reconstructedEdges.push({
                id: `deleted-${sourceId}-${sourceHandle}-${targetId}-${targetHandle}`,
                source: sourceId,
                target: targetId,
                sourceHandle,
                targetHandle,
                type: 'workflowEdge',
                data: { isDeleted: true },
              })
            }
          }
        }
      })

      edgesToFilter = [...edges, ...reconstructedEdges]
    }

    return edgesToFilter.filter((edge) => {
      const sourceBlock = blocks[edge.source]
      const targetBlock = blocks[edge.target]
      return Boolean(sourceBlock && targetBlock)
    })
  }, [edges, isShowingDiff, isDiffReady, diffAnalysis, blocks])

  const { userPermissions, workspacePermissions, permissionsError } =
    useWorkspacePermissionsContext()

  /** Returns read-only permissions when viewing snapshot, otherwise user permissions. */
  const effectivePermissions = useMemo(() => {
    if (currentWorkflow.isSnapshotView) {
      return {
        ...userPermissions,
        canEdit: false,
        canAdmin: false,
        canRead: userPermissions.canRead,
      }
    }
    return userPermissions
  }, [userPermissions, currentWorkflow.isSnapshotView])

  const {
    collaborativeBatchAddEdges,
    collaborativeBatchRemoveEdges,
    collaborativeBatchUpdatePositions,
    collaborativeBatchUpdateParent,
    collaborativeBatchAddBlocks,
    collaborativeBatchRemoveBlocks,
    collaborativeBatchToggleBlockEnabled,
    collaborativeBatchToggleBlockHandles,
    collaborativeBatchToggleLocked,
    undo,
    redo,
  } = useCollaborativeWorkflow()

  const updateBlockPosition = useCallback(
    (id: string, position: { x: number; y: number }) => {
      collaborativeBatchUpdatePositions([{ id, position }])
    },
    [collaborativeBatchUpdatePositions]
  )

  const addEdge = useCallback(
    (edge: Edge) => {
      collaborativeBatchAddEdges([edge])
    },
    [collaborativeBatchAddEdges]
  )

  const removeEdge = useCallback(
    (edgeId: string) => {
      collaborativeBatchRemoveEdges([edgeId])
    },
    [collaborativeBatchRemoveEdges]
  )

  const batchUpdateBlocksWithParent = useCallback(
    (updates: Array<{ id: string; position: { x: number; y: number }; parentId?: string }>) => {
      collaborativeBatchUpdateParent(
        updates.map((u) => ({
          blockId: u.id,
          newParentId: u.parentId || null,
          newPosition: u.position,
          affectedEdges: [],
        }))
      )
    },
    [collaborativeBatchUpdateParent]
  )

  /**
   * Executes a batch parent update for nodes being moved into or out of containers.
   * Consolidates the common logic used by onNodeDragStop and onSelectionDragStop.
   */
  const executeBatchParentUpdate = useCallback(
    (nodesToProcess: Node[], targetParentId: string | null, logMessage: string) => {
      // Build set of node IDs for efficient lookup
      const nodeIds = new Set(nodesToProcess.map((n) => n.id))

      // Filter to nodes whose parent is actually changing
      const nodesNeedingUpdate = nodesToProcess.filter((n) => {
        const block = blocks[n.id]
        if (!block) return false
        const currentParent = block.data?.parentId || null
        // Skip if the node's parent is also being moved (keep children with their parent)
        if (currentParent && nodeIds.has(currentParent)) return false
        return currentParent !== targetParentId
      })

      if (nodesNeedingUpdate.length === 0) return

      // Filter out nodes that cannot enter containers (when target is a container)
      const validNodes = targetParentId
        ? nodesNeedingUpdate.filter(canNodeEnterContainer)
        : nodesNeedingUpdate

      if (validNodes.length === 0) return

      // Find boundary edges (edges that cross the container boundary)
      const movingNodeIds = new Set(validNodes.map((n) => n.id))
      const boundaryEdges = edgesForDisplay.filter((e) => {
        const sourceInSelection = movingNodeIds.has(e.source)
        const targetInSelection = movingNodeIds.has(e.target)
        return sourceInSelection !== targetInSelection
      })
      const boundaryEdgesByNode = mapEdgesByNode(boundaryEdges, movingNodeIds)

      // Build position updates
      const rawUpdates = validNodes.map((n) => {
        const edgesForThisNode = boundaryEdgesByNode.get(n.id) ?? []
        const newPosition = targetParentId
          ? calculateRelativePosition(n.id, targetParentId, true)
          : getNodeAbsolutePosition(n.id)
        return {
          blockId: n.id,
          newParentId: targetParentId,
          newPosition,
          affectedEdges: edgesForThisNode,
        }
      })

      // Shift to container bounds if moving into a container
      const updates = targetParentId ? shiftUpdatesToContainerBounds(rawUpdates) : rawUpdates

      collaborativeBatchUpdateParent(updates)

      // Update display nodes
      setDisplayNodes((nodes) =>
        nodes.map((node) => {
          const update = updates.find((u) => u.blockId === node.id)
          if (update) {
            return {
              ...node,
              position: update.newPosition,
              parentId: update.newParentId ?? undefined,
            }
          }
          return node
        })
      )

      // Resize container if moving into one
      if (targetParentId) {
        resizeLoopNodesWrapper()
      }

      logger.info(logMessage, {
        targetParentId,
        nodeCount: validNodes.length,
      })
    },
    [
      blocks,
      edgesForDisplay,
      canNodeEnterContainer,
      calculateRelativePosition,
      getNodeAbsolutePosition,
      shiftUpdatesToContainerBounds,
      collaborativeBatchUpdateParent,
      resizeLoopNodesWrapper,
    ]
  )

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

      // Apply preset subblock values (e.g., from tool-operation search)
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

  const { activeBlockIds, pendingBlocks, isDebugging, isExecuting, getLastExecutionSnapshot } =
    useExecutionStore(
      useShallow((state) => ({
        activeBlockIds: state.activeBlockIds,
        pendingBlocks: state.pendingBlocks,
        isDebugging: state.isDebugging,
        isExecuting: state.isExecuting,
        getLastExecutionSnapshot: state.getLastExecutionSnapshot,
      }))
    )

  const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

  /** Connection line style - red for error handles, default otherwise. */
  const connectionLineStyle = useMemo(
    () => ({
      stroke: isErrorConnectionDrag ? 'var(--text-error)' : 'var(--workflow-edge)',
      strokeWidth: 2,
    }),
    [isErrorConnectionDrag]
  )

  /** Logs permission loading results for debugging. */
  useEffect(() => {
    if (permissionsError) {
      logger.error('Failed to load workspace permissions', {
        workspaceId,
        error: permissionsError,
      })
    } else if (workspacePermissions) {
      logger.info('Workspace permissions loaded in workflow', {
        workspaceId,
        userCount: workspacePermissions.total,
        permissions: workspacePermissions.users.map((u) => ({
          email: u.email,
          permissions: u.permissionType,
        })),
      })
    }
  }, [workspacePermissions, permissionsError, workspaceId])

  const updateNodeParent = useCallback(
    (nodeId: string, newParentId: string | null, affectedEdges: any[] = []) => {
      const node = getNodes().find((n: any) => n.id === nodeId)
      if (!node) return

      const currentBlock = blocks[nodeId]
      if (!currentBlock) return

      const oldParentId = node.parentId || currentBlock.data?.parentId
      const oldPosition = { ...node.position }

      // affectedEdges are edges that are either being removed (when leaving a subflow)
      // or being added (when entering a subflow)
      if (!affectedEdges.length && !newParentId && oldParentId) {
        affectedEdges = edgesForDisplay.filter((e) => e.source === nodeId || e.target === nodeId)
      }

      let newPosition = oldPosition
      if (newParentId) {
        const nodeAbsPos = getNodeAbsolutePosition(nodeId)
        const parentAbsPos = getNodeAbsolutePosition(newParentId)
        const headerHeight = 50
        const leftPadding = 16
        const topPadding = 16
        newPosition = {
          x: nodeAbsPos.x - parentAbsPos.x - leftPadding,
          y: nodeAbsPos.y - parentAbsPos.y - headerHeight - topPadding,
        }
      } else if (oldParentId) {
        newPosition = getNodeAbsolutePosition(nodeId)
      }

      const result = updateNodeParentUtil(
        nodeId,
        newParentId,
        collaborativeBatchUpdatePositions,
        batchUpdateBlocksWithParent,
        () => resizeLoopNodesWrapper()
      )

      if (oldParentId !== newParentId) {
        window.dispatchEvent(
          new CustomEvent('workflow-record-parent-update', {
            detail: {
              blockId: nodeId,
              oldParentId: oldParentId || undefined,
              newParentId: newParentId || undefined,
              oldPosition,
              newPosition,
              affectedEdges: affectedEdges.map((e) => ({ ...e })),
            },
          })
        )
      }

      return result
    },
    [
      getNodes,
      collaborativeBatchUpdatePositions,
      batchUpdateBlocksWithParent,
      blocks,
      edgesForDisplay,
      getNodeAbsolutePosition,
      updateNodeParentUtil,
      resizeLoopNodesWrapper,
    ]
  )

  /** Applies auto-layout to the workflow canvas. */
  const handleAutoLayout = useCallback(async () => {
    if (Object.keys(blocks).length === 0) return
    await autoLayoutWithFitView()
  }, [blocks, autoLayoutWithFitView])

  const debouncedAutoLayout = useCallback(() => {
    const debounceTimer = setTimeout(() => {
      handleAutoLayout()
    }, 250)

    return () => clearTimeout(debounceTimer)
  }, [handleAutoLayout])

  const {
    isBlockMenuOpen,
    isPaneMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    selectedBlocks: contextMenuBlocks,
    handleNodeContextMenu,
    handlePaneContextMenu,
    handleSelectionContextMenu,
    closeMenu: closeContextMenu,
  } = useCanvasContextMenu({ blocks, getNodes, setNodes })

  const handleContextCopy = useCallback(() => {
    const blockIds = contextMenuBlocks.map((b) => b.id)
    copyBlocks(blockIds)
  }, [contextMenuBlocks, copyBlocks])

  /**
   * Executes a paste operation with validation and selection handling.
   * Consolidates shared logic for context paste, duplicate, and keyboard paste.
   */
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
      // For context menu paste into a subflow, calculate offset to center blocks at click position
      // Skip click-position centering if blocks came from inside a subflow (relative coordinates)
      let effectiveOffset = pasteOffset
      if (targetContainer && pasteTargetPosition && clipboard) {
        const clipboardBlocks = Object.values(clipboard.blocks)
        // Only use click-position centering for top-level blocks (absolute coordinates)
        // Blocks with parentId have relative positions that can't be mixed with absolute click position
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

      // If pasting into a subflow, adjust blocks to be children of that subflow
      if (targetContainer) {
        // Check if any pasted block is a trigger - triggers cannot be in subflows
        const hasTrigger = pastedBlocksArray.some((b) => TriggerUtils.isTriggerBlock(b))
        if (hasTrigger) {
          addNotification({
            level: 'error',
            message: 'Triggers cannot be placed inside loop or parallel subflows.',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }

        // Check if any pasted block is a subflow - subflows cannot be nested
        const hasSubflow = pastedBlocksArray.some((b) => b.type === 'loop' || b.type === 'parallel')
        if (hasSubflow) {
          addNotification({
            level: 'error',
            message: 'Subflows cannot be nested inside other subflows.',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }

        // Adjust each block's position to be relative to the container and set parentId
        pastedBlocksArray = pastedBlocksArray.map((block) => {
          // For blocks already nested (have parentId), positions are already relative - use as-is
          // For top-level blocks, convert absolute position to relative by subtracting container position
          const wasNested = Boolean(block.data?.parentId)
          const relativePosition = wasNested
            ? { x: block.position.x, y: block.position.y }
            : {
                x: block.position.x - targetContainer.loopPosition.x,
                y: block.position.y - targetContainer.loopPosition.y,
              }

          // Clamp position to keep block inside container (below header)
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

        // Update pasteData.blocks with the modified blocks
        pasteData.blocks = pastedBlocksArray.reduce(
          (acc, block) => {
            acc[block.id] = block
            return acc
          },
          {} as Record<string, (typeof pastedBlocksArray)[0]>
        )
      }

      const validation = validateTriggerPaste(pastedBlocksArray, blocks, operation)
      if (!validation.isValid) {
        addNotification({
          level: 'error',
          message: validation.message!,
          workflowId: activeWorkflowId || undefined,
        })
        return
      }

      // Set pending selection before adding blocks - sync effect will apply it (accumulates for rapid pastes)
      setPendingSelection(pastedBlocksArray.map((b) => b.id))

      collaborativeBatchAddBlocks(
        pastedBlocksArray,
        pasteData.edges,
        pasteData.loops,
        pasteData.parallels,
        pasteData.subBlockValues
      )

      // Resize container if we pasted into a subflow
      if (targetContainer) {
        resizeLoopNodesWrapper()
      }
    },
    [
      preparePasteData,
      blocks,
      clipboard,
      addNotification,
      activeWorkflowId,
      collaborativeBatchAddBlocks,
      setPendingSelection,
      resizeLoopNodesWrapper,
    ]
  )

  const handleContextPaste = useCallback(() => {
    if (!hasClipboard()) return

    // Convert context menu position to flow coordinates and check if inside a subflow
    const flowPosition = screenToFlowPosition(contextMenuPosition)
    const targetContainer = isPointInLoopNode(flowPosition)

    executePasteOperation(
      'paste',
      calculatePasteOffset(clipboard, getViewportCenter()),
      targetContainer,
      flowPosition // Pass the click position so blocks are centered at where user right-clicked
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
    const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(blockIds, blocks)

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
    if (deletableIds.length > 0) {
      collaborativeBatchRemoveBlocks(deletableIds)
    }
  }, [contextMenuBlocks, collaborativeBatchRemoveBlocks, addNotification, activeWorkflowId, blocks])

  const handleContextToggleEnabled = useCallback(() => {
    const blockIds = contextMenuBlocks.map((block) => block.id)
    collaborativeBatchToggleBlockEnabled(blockIds)
  }, [contextMenuBlocks, collaborativeBatchToggleBlockEnabled])

  const handleContextToggleHandles = useCallback(() => {
    const blockIds = contextMenuBlocks.map((block) => block.id)
    collaborativeBatchToggleBlockHandles(blockIds)
  }, [contextMenuBlocks, collaborativeBatchToggleBlockHandles])

  const handleContextToggleLocked = useCallback(() => {
    const blockIds = contextMenuBlocks.map((block) => block.id)
    collaborativeBatchToggleLocked(blockIds)
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
    if (contextMenuBlocks.length === 1) {
      usePanelEditorStore.getState().setCurrentBlockId(contextMenuBlocks[0].id)
    }
  }, [contextMenuBlocks])

  const handleContextRename = useCallback(() => {
    if (contextMenuBlocks.length === 1) {
      usePanelEditorStore.getState().setCurrentBlockId(contextMenuBlocks[0].id)
      usePanelEditorStore.getState().triggerRename()
    }
  }, [contextMenuBlocks])

  const handleContextRunFromBlock = useCallback(() => {
    if (contextMenuBlocks.length !== 1) return
    const blockId = contextMenuBlocks[0].id
    handleRunFromBlock(blockId, workflowIdParam)
  }, [contextMenuBlocks, workflowIdParam, handleRunFromBlock])

  const handleContextRunUntilBlock = useCallback(() => {
    if (contextMenuBlocks.length !== 1) return
    const blockId = contextMenuBlocks[0].id
    handleRunUntilBlock(blockId, workflowIdParam)
  }, [contextMenuBlocks, workflowIdParam, handleRunUntilBlock])

  const runFromBlockState = useMemo(() => {
    if (contextMenuBlocks.length !== 1) {
      return { canRun: false, reason: undefined }
    }
    const block = contextMenuBlocks[0]
    const snapshot = getLastExecutionSnapshot(workflowIdParam)
    const incomingEdges = edges.filter((edge) => edge.target === block.id)
    const isTriggerBlock = incomingEdges.length === 0

    // Check if each source block is either executed OR is a trigger block (triggers don't need prior execution)
    const isSourceSatisfied = (sourceId: string) => {
      if (snapshot?.executedBlocks.includes(sourceId)) return true
      // Check if source is a trigger (has no incoming edges itself)
      const sourceIncomingEdges = edges.filter((edge) => edge.target === sourceId)
      return sourceIncomingEdges.length === 0
    }

    // Non-trigger blocks need a snapshot to exist (so upstream outputs are available)
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
    let cleanup: (() => void) | null = null

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInEditableElement()) {
        event.stopPropagation()
        return
      }

      if (event.shiftKey && event.key === 'L' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        if (cleanup) cleanup()
        cleanup = debouncedAutoLayout()
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === 'Z' || (event.key === 'z' && event.shiftKey))
      ) {
        event.preventDefault()
        redo()
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        const selection = window.getSelection()
        const hasTextSelection = selection && selection.toString().length > 0

        if (hasTextSelection) {
          return
        }

        const selectedNodes = getNodes().filter((node) => node.selected)
        if (selectedNodes.length > 0) {
          event.preventDefault()
          copyBlocks(selectedNodes.map((node) => node.id))
        } else {
          const currentBlockId = usePanelEditorStore.getState().currentBlockId
          if (currentBlockId && blocks[currentBlockId]) {
            event.preventDefault()
            copyBlocks([currentBlockId])
          }
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        if (effectivePermissions.canEdit && hasClipboard()) {
          event.preventDefault()
          executePasteOperation('paste', calculatePasteOffset(clipboard, getViewportCenter()))
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (cleanup) cleanup()
    }
  }, [
    debouncedAutoLayout,
    undo,
    redo,
    getNodes,
    copyBlocks,
    hasClipboard,
    effectivePermissions.canEdit,
    clipboard,
    getViewportCenter,
    executePasteOperation,
  ])

  /**
   * Removes all edges connected to a block, skipping individual edge recording for undo/redo.
   * Used when moving nodes between containers where edges would violate boundary constraints.
   */
  const removeEdgesForNode = useCallback(
    (blockId: string, edgesToRemove: Edge[]): void => {
      if (edgesToRemove.length === 0) return

      const edgeIds = edgesToRemove.map((edge) => edge.id)
      collaborativeBatchRemoveEdges(edgeIds, { skipUndoRedo: true })

      logger.debug('Removed edges for node', {
        blockId,
        edgeCount: edgesToRemove.length,
      })
    },
    [collaborativeBatchRemoveEdges]
  )

  const isAutoConnectSourceCandidate = useCallback((block: BlockState): boolean => {
    if (!block.enabled) return false
    if (block.type === 'response') return false
    if (isAnnotationOnlyBlock(block.type)) return false
    return true
  }, [])

  /** Finds the closest block to a position for auto-connect. */
  const findClosestOutput = useCallback(
    (newNodePosition: { x: number; y: number }): BlockData | null => {
      const containerAtPoint = isPointInLoopNode(newNodePosition)
      const nodeIndex = new Map(getNodes().map((n) => [n.id, n]))

      const closest = Object.entries(blocks).reduce<{
        id: string
        type: string
        position: { x: number; y: number }
        distanceSquared: number
      } | null>((acc, [id, block]) => {
        if (!isAutoConnectSourceCandidate(block)) return acc
        const node = nodeIndex.get(id)
        if (!node) return acc

        const blockParentId = blocks[id]?.data?.parentId
        const dropParentId = containerAtPoint?.loopId
        if (dropParentId !== blockParentId) return acc

        const anchor = getNodeAnchorPosition(id)
        const distanceSquared =
          (anchor.x - newNodePosition.x) ** 2 + (anchor.y - newNodePosition.y) ** 2
        if (!acc || distanceSquared < acc.distanceSquared) {
          return {
            id,
            type: block.type,
            position: anchor,
            distanceSquared,
          }
        }
        return acc
      }, null)

      if (!closest) return null

      return {
        id: closest.id,
        type: closest.type,
        position: closest.position,
      }
    },
    [blocks, getNodes, getNodeAnchorPosition, isPointInLoopNode, isAutoConnectSourceCandidate]
  )

  /** Determines the appropriate source handle based on block type. */
  const determineSourceHandle = useCallback((block: { id: string; type: string }) => {
    if (block.type === 'condition') {
      const conditionHandles = document.querySelectorAll(
        `[data-nodeid^="${block.id}"][data-handleid^="condition-"]`
      )
      if (conditionHandles.length > 0) {
        const handleId = conditionHandles[0].getAttribute('data-handleid')
        if (handleId) return handleId
      }
    } else if (block.type === 'router_v2') {
      const routerHandles = document.querySelectorAll(
        `[data-nodeid^="${block.id}"][data-handleid^="router-"]`
      )
      if (routerHandles.length > 0) {
        const handleId = routerHandles[0].getAttribute('data-handleid')
        if (handleId) return handleId
      }
    } else if (block.type === 'loop') {
      return 'loop-end-source'
    } else if (block.type === 'parallel') {
      return 'parallel-end-source'
    }
    return 'source'
  }, [])

  /** Creates a standardized edge object for workflow connections. */
  const createEdgeObject = useCallback(
    (sourceId: string, targetId: string, sourceHandle: string): Edge => {
      const edge = {
        id: crypto.randomUUID(),
        source: sourceId,
        target: targetId,
        sourceHandle,
        targetHandle: 'target',
        type: 'workflowEdge',
      }
      return edge
    },
    []
  )

  /** Gets the appropriate start handle for a container node (loop or parallel). */
  const getContainerStartHandle = useCallback(
    (containerId: string): string => {
      const containerNode = getNodes().find((n) => n.id === containerId)
      return (containerNode?.data as SubflowNodeData)?.kind === 'loop'
        ? 'loop-start-source'
        : 'parallel-start-source'
    },
    [getNodes]
  )

  /** Finds the closest non-response block to a position within a set of blocks. */
  const findClosestBlockInSet = useCallback(
    (
      candidateBlocks: { id: string; type: string; position: { x: number; y: number } }[],
      targetPosition: { x: number; y: number }
    ): { id: string; type: string; position: { x: number; y: number } } | undefined => {
      const closest = candidateBlocks.reduce<{
        id: string
        type: string
        position: { x: number; y: number }
        distanceSquared: number
      } | null>((acc, block) => {
        const blockState = blocks[block.id]
        if (!blockState || !isAutoConnectSourceCandidate(blockState)) return acc
        const distanceSquared =
          (block.position.x - targetPosition.x) ** 2 + (block.position.y - targetPosition.y) ** 2
        if (!acc || distanceSquared < acc.distanceSquared) {
          return { ...block, distanceSquared }
        }
        return acc
      }, null)

      return closest
        ? {
            id: closest.id,
            type: closest.type,
            position: closest.position,
          }
        : undefined
    },
    [blocks, isAutoConnectSourceCandidate]
  )

  /**
   * Attempts to create an auto-connect edge for a new block being added.
   * Returns the edge object if auto-connect should occur, or undefined otherwise.
   *
   * @param position - The position where the new block will be placed
   * @param targetBlockId - The ID of the new block being added
   * @param options - Configuration for auto-connect behavior
   */
  const tryCreateAutoConnectEdge = useCallback(
    (
      position: { x: number; y: number },
      targetBlockId: string,
      options: {
        targetParentId?: string | null
        existingChildBlocks?: { id: string; type: string; position: { x: number; y: number } }[]
        containerId?: string
      }
    ): Edge | undefined => {
      if (!autoConnectRef.current) return undefined

      // Case 1: Adding block inside a container with existing children
      if (options.existingChildBlocks && options.existingChildBlocks.length > 0) {
        const closestBlock = findClosestBlockInSet(options.existingChildBlocks, position)
        if (closestBlock) {
          const sourceHandle = determineSourceHandle({
            id: closestBlock.id,
            type: closestBlock.type,
          })
          return createEdgeObject(closestBlock.id, targetBlockId, sourceHandle)
        }
        return undefined
      }

      // Case 2: Adding block inside an empty container - connect from container start
      if (
        options.containerId &&
        (!options.existingChildBlocks || options.existingChildBlocks.length === 0)
      ) {
        const startHandle = getContainerStartHandle(options.containerId)
        return createEdgeObject(options.containerId, targetBlockId, startHandle)
      }

      // Case 3: Adding block at root level - use findClosestOutput
      const closestBlock = findClosestOutput(position)
      if (!closestBlock) return undefined

      // Don't create cross-container edges
      const closestBlockParentId = blocks[closestBlock.id]?.data?.parentId
      if (closestBlockParentId && !options.targetParentId) {
        return undefined
      }

      const sourceHandle = determineSourceHandle(closestBlock)
      return createEdgeObject(closestBlock.id, targetBlockId, sourceHandle)
    },
    [
      blocks,
      findClosestOutput,
      determineSourceHandle,
      createEdgeObject,
      getContainerStartHandle,
      findClosestBlockInSet,
    ]
  )

  /**
   * Checks if adding a block would violate constraints (triggers or single-instance blocks)
   * and shows notification if so.
   * @returns true if validation failed (caller should return early), false if ok to proceed
   */
  const checkTriggerConstraints = useCallback(
    (blockType: string): boolean => {
      const triggerIssue = TriggerUtils.getTriggerAdditionIssue(blocks, blockType)
      if (triggerIssue) {
        const message =
          triggerIssue.issue === 'legacy'
            ? 'Cannot add new trigger blocks when a legacy Start block exists. Available in newer workflows.'
            : `A workflow can only have one ${triggerIssue.triggerName} trigger block. Please remove the existing one before adding a new one.`
        addNotification({
          level: 'error',
          message,
          workflowId: activeWorkflowId || undefined,
        })
        return true
      }

      const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(blocks, blockType)
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
    [blocks, addNotification, activeWorkflowId]
  )

  /**
   * Shared handler for drops of toolbar items onto the workflow canvas.
   *
   * This encapsulates the full drop behavior (container handling, auto-connect,
   * trigger constraints, etc.) so it can be reused both for direct ReactFlow
   * drops and for drops forwarded from the empty-workflow command list overlay.
   *
   * @param data - Drag data from the toolbar (type + optional trigger mode).
   * @param position - Drop position in ReactFlow coordinates.
   */
  const handleToolbarDrop = useCallback(
    (data: { type: string; enableTriggerMode?: boolean }, position: { x: number; y: number }) => {
      if (!data.type || data.type === 'connectionBlock') return

      try {
        const containerInfo = isPointInLoopNode(position)

        clearDragHighlights()
        document.body.classList.remove('sim-drag-subflow')

        if (data.type === 'loop' || data.type === 'parallel') {
          const id = crypto.randomUUID()
          const baseName = data.type === 'loop' ? 'Loop' : 'Parallel'
          const name = getUniqueBlockName(baseName, blocks)

          const autoConnectEdge = tryCreateAutoConnectEdge(position, id, {
            targetParentId: null,
          })

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

          return
        }

        // Validate block config for regular blocks
        const blockConfig = getBlock(data.type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { data })
          return
        }

        // Generate id and name here so they're available in all code paths
        const id = crypto.randomUUID()
        // Prefer semantic default names for triggers; then ensure unique numbering centrally
        const defaultTriggerNameDrop = TriggerUtils.getDefaultTriggerName(data.type)
        const baseName = defaultTriggerNameDrop || blockConfig.name
        const name = getUniqueBlockName(baseName, blocks)

        if (containerInfo) {
          // Check if this is a trigger block or has trigger mode enabled
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

          // Calculate raw position relative to container origin
          const rawPosition = {
            x: position.x - containerInfo.loopPosition.x,
            y: position.y - containerInfo.loopPosition.y,
          }

          // Clamp position to keep block inside container's content area
          const relativePosition = clampPositionToContainer(
            rawPosition,
            containerInfo.dimensions,
            estimateBlockDimensions(data.type)
          )

          // Capture existing child blocks for auto-connect
          const existingChildBlocks = Object.values(blocks)
            .filter((b) => b.data?.parentId === containerInfo.loopId)
            .map((b) => ({ id: b.id, type: b.type, position: b.position }))

          const autoConnectEdge = tryCreateAutoConnectEdge(relativePosition, id, {
            targetParentId: containerInfo.loopId,
            existingChildBlocks,
            containerId: containerInfo.loopId,
          })

          // Add block with parent info AND autoConnectEdge (atomic operation)
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

          // Resize the container node to fit the new block
          // Immediate resize without delay
          resizeLoopNodesWrapper()
        } else {
          // Centralized trigger constraints
          if (checkTriggerConstraints(data.type)) return

          const autoConnectEdge = tryCreateAutoConnectEdge(position, id, {
            targetParentId: null,
          })

          // Regular canvas drop with auto-connect edge
          // Use enableTriggerMode from drag data if present (when dragging from Triggers tab)
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
      blocks,
      isPointInLoopNode,
      resizeLoopNodesWrapper,
      addBlock,
      addNotification,
      activeWorkflowId,
      tryCreateAutoConnectEdge,
      checkTriggerConstraints,
    ]
  )

  /** Handles toolbar block click events to add blocks to the canvas. */
  useEffect(() => {
    const handleAddBlockFromToolbar = (event: CustomEvent) => {
      // Check if user has permission to interact with blocks
      if (!effectivePermissions.canEdit) {
        return
      }

      const { type, enableTriggerMode, presetOperation } = event.detail

      if (!type) return
      if (type === 'connectionBlock') return

      const basePosition = getViewportCenter()

      if (type === 'loop' || type === 'parallel') {
        const id = crypto.randomUUID()
        const baseName = type === 'loop' ? 'Loop' : 'Parallel'
        const name = getUniqueBlockName(baseName, blocks)

        const autoConnectEdge = tryCreateAutoConnectEdge(basePosition, id, {
          targetParentId: null,
        })

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
      const name = getUniqueBlockName(baseName, blocks)

      const autoConnectEdge = tryCreateAutoConnectEdge(basePosition, id, {
        targetParentId: null,
      })

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

    window.addEventListener('add-block-from-toolbar', handleAddBlockFromToolbar as EventListener)

    return () => {
      window.removeEventListener(
        'add-block-from-toolbar',
        handleAddBlockFromToolbar as EventListener
      )
    }
  }, [
    getViewportCenter,
    blocks,
    addBlock,
    effectivePermissions.canEdit,
    checkTriggerConstraints,
    tryCreateAutoConnectEdge,
  ])

  /**
   * Listen for toolbar drops that occur on the empty-workflow overlay (command list).
   *
   * The overlay forwards drop events with the cursor position; this handler
   * computes the corresponding ReactFlow coordinates and delegates to
   * `handleToolbarDrop` so the behavior matches native canvas drops.
   */
  useEffect(() => {
    const handleOverlayToolbarDrop = (event: Event) => {
      const customEvent = event as CustomEvent<{
        type: string
        enableTriggerMode?: boolean
        clientX: number
        clientY: number
      }>

      const detail = customEvent.detail
      if (!detail?.type) return

      try {
        const canvasElement = document.querySelector('.workflow-container') as HTMLElement | null
        if (!canvasElement) {
          logger.warn('Workflow canvas element not found for overlay toolbar drop')
          return
        }

        const bounds = canvasElement.getBoundingClientRect()
        const position = screenToFlowPosition({
          x: detail.clientX - bounds.left,
          y: detail.clientY - bounds.top,
        })

        handleToolbarDrop(
          {
            type: detail.type,
            enableTriggerMode: detail.enableTriggerMode ?? false,
          },
          position
        )
      } catch (err) {
        logger.error('Error handling toolbar drop from empty-workflow overlay', { err })
      }
    }

    window.addEventListener(
      'toolbar-drop-on-empty-workflow-overlay',
      handleOverlayToolbarDrop as EventListener
    )

    return () =>
      window.removeEventListener(
        'toolbar-drop-on-empty-workflow-overlay',
        handleOverlayToolbarDrop as EventListener
      )
  }, [screenToFlowPosition, handleToolbarDrop])

  /** Tracks blocks to pan to after diff updates. */
  const pendingZoomBlockIdsRef = useRef<Set<string> | null>(null)
  const seenDiffBlocksRef = useRef<Set<string>>(new Set())

  /** Queues newly changed blocks for viewport panning. */
  useEffect(() => {
    if (!isDiffReady || !diffAnalysis) {
      pendingZoomBlockIdsRef.current = null
      seenDiffBlocksRef.current.clear()
      return
    }

    const newBlocks = new Set<string>()
    const allBlocks = [...(diffAnalysis.new_blocks || []), ...(diffAnalysis.edited_blocks || [])]

    for (const id of allBlocks) {
      if (!seenDiffBlocksRef.current.has(id)) {
        newBlocks.add(id)
      }
      seenDiffBlocksRef.current.add(id)
    }

    if (newBlocks.size > 0) {
      pendingZoomBlockIdsRef.current = newBlocks
    }
  }, [isDiffReady, diffAnalysis])

  /** Displays trigger warning notifications. */
  useEffect(() => {
    const handleShowTriggerWarning = (event: CustomEvent) => {
      const { type, triggerName } = event.detail
      const message =
        type === 'trigger_in_subflow'
          ? 'Triggers cannot be placed inside loop or parallel subflows.'
          : type === 'legacy_incompatibility'
            ? 'Cannot add new trigger blocks when a legacy Start block exists. Available in newer workflows.'
            : `A workflow can only have one ${triggerName || 'trigger'} trigger block. Please remove the existing one before adding a new one.`
      addNotification({
        level: 'error',
        message,
        workflowId: activeWorkflowId || undefined,
      })
    }

    window.addEventListener('show-trigger-warning', handleShowTriggerWarning as EventListener)

    return () => {
      window.removeEventListener('show-trigger-warning', handleShowTriggerWarning as EventListener)
    }
  }, [addNotification, activeWorkflowId])

  /** Handles drop events on the ReactFlow canvas. */
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      try {
        const raw = event.dataTransfer.getData('application/json')
        if (!raw) return
        const data = JSON.parse(raw)
        if (!data?.type) return

        const reactFlowBounds = event.currentTarget.getBoundingClientRect()
        const position = screenToFlowPosition({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })

        handleToolbarDrop(
          {
            type: data.type,
            enableTriggerMode: data.enableTriggerMode ?? false,
          },
          position
        )
      } catch (err) {
        logger.error('Error dropping block on ReactFlow canvas:', { err })
      }
    },
    [screenToFlowPosition, handleToolbarDrop]
  )

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<Element>) => {
      const target = event.currentTarget as HTMLElement
      const bounds = target.getBoundingClientRect()

      const position = screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })

      emitCursorUpdate(position)
    },
    [screenToFlowPosition, emitCursorUpdate]
  )

  const handleCanvasPointerLeave = useCallback(() => {
    emitCursorUpdate(null)
  }, [emitCursorUpdate])

  useEffect(() => {
    return () => {
      emitCursorUpdate(null)
    }
  }, [emitCursorUpdate])

  /** Handles drag over events for container node highlighting. */
  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      // Only handle toolbar items
      if (!event.dataTransfer?.types.includes('application/json')) return

      try {
        const reactFlowBounds = event.currentTarget.getBoundingClientRect()
        const position = screenToFlowPosition({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })

        // Check if hovering over a container node
        const containerInfo = isPointInLoopNode(position)

        // Highlight container if hovering over it and not dragging a subflow
        // Subflow drag is marked by body class flag set by toolbar
        const isSubflowDrag = document.body.classList.contains('sim-drag-subflow')

        if (containerInfo && !isSubflowDrag) {
          const containerNode = getNodes().find((n) => n.id === containerInfo.loopId)
          if (containerNode?.type === 'subflowNode') {
            const kind = (containerNode.data as SubflowNodeData)?.kind
            if (kind === 'loop' || kind === 'parallel') {
              highlightContainerNode(containerInfo.loopId, kind)
            }
          }
        } else {
          clearDragHighlights()
          document.body.style.cursor = ''
        }
      } catch (err) {
        logger.error('Error in onDragOver', { err })
      }
    },
    [screenToFlowPosition, isPointInLoopNode, getNodes, highlightContainerNode]
  )

  const loadingWorkflowRef = useRef<string | null>(null)
  const currentWorkflowExists = Boolean(workflows[workflowIdParam])

  useEffect(() => {
    const currentId = workflowIdParam
    const currentWorkspaceHydration = hydration.workspaceId

    const isRegistryReady = hydration.phase !== 'metadata-loading' && hydration.phase !== 'idle'

    // Wait for registry to be ready to prevent race conditions
    if (
      !currentId ||
      !currentWorkflowExists ||
      !isRegistryReady ||
      (currentWorkspaceHydration && currentWorkspaceHydration !== workspaceId)
    ) {
      return
    }

    // Prevent duplicate loads - if we're already loading this workflow, skip
    if (loadingWorkflowRef.current === currentId) {
      return
    }

    // If already loading (state-loading phase), skip
    if (hydration.phase === 'state-loading' && hydration.workflowId === currentId) {
      return
    }

    // Check if we encountered an error loading this specific workflow to prevent infinite retries
    const hasLoadError = hydration.phase === 'error' && hydration.workflowId === currentId

    // Check if we need to load the workflow state:
    // 1. Different workflow than currently active
    // 2. Same workflow but hydration phase is not 'ready' (e.g., after a quick refresh)
    const needsWorkflowLoad =
      !hasLoadError &&
      (activeWorkflowId !== currentId ||
        (activeWorkflowId === currentId && hydration.phase !== 'ready'))

    if (needsWorkflowLoad) {
      // Mark this workflow as being loaded to prevent duplicate calls
      loadingWorkflowRef.current = currentId

      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()

      // Reset canvas ready state when loading a new workflow
      setIsCanvasReady(false)

      setActiveWorkflow(currentId)
        .catch((error) => {
          logger.error(`Failed to set active workflow ${currentId}:`, error)
        })
        .finally(() => {
          // Clear the loading ref when done (success or error)
          if (loadingWorkflowRef.current === currentId) {
            loadingWorkflowRef.current = null
          }
        })
    }
  }, [
    workflowIdParam,
    currentWorkflowExists,
    activeWorkflowId,
    setActiveWorkflow,
    hydration.phase,
    hydration.workflowId,
    hydration.workspaceId,
    workspaceId,
  ])

  useWorkspaceEnvironment(workspaceId)

  const workflowCount = useMemo(() => Object.keys(workflows).length, [workflows])

  /** Handles navigation validation and redirects for invalid workflow IDs. */
  useEffect(() => {
    // Wait for metadata to finish loading before making navigation decisions
    if (hydration.phase === 'metadata-loading' || hydration.phase === 'idle') {
      return
    }

    // If no workflows exist after loading, redirect to workspace root
    if (workflowCount === 0) {
      logger.info('No workflows found, redirecting to workspace root')
      router.replace(`/workspace/${workspaceId}/w`)
      return
    }

    // Navigate to existing workflow or first available
    if (!currentWorkflowExists) {
      logger.info(`Workflow ${workflowIdParam} not found, redirecting to first available workflow`)

      // Validate that workflows belong to the current workspace before redirecting
      const workspaceWorkflows = Object.entries(workflows)
        .filter(([, workflow]) => workflow.workspaceId === workspaceId)
        .map(([id]) => id)

      if (workspaceWorkflows.length > 0) {
        router.replace(`/workspace/${workspaceId}/w/${workspaceWorkflows[0]}`)
      } else {
        // No valid workflows for this workspace, redirect to workspace root
        router.replace(`/workspace/${workspaceId}/w`)
      }
      return
    }

    // Validate that the current workflow belongs to the current workspace
    const workflowData = workflows[workflowIdParam]
    if (workflowData && workflowData.workspaceId !== workspaceId) {
      logger.warn(
        `Workflow ${workflowIdParam} belongs to workspace ${workflowData.workspaceId}, not ${workspaceId}`
      )
      // Redirect to the correct workspace for this workflow
      router.replace(`/workspace/${workflowData.workspaceId}/w/${workflowIdParam}`)
    }
  }, [
    workflowIdParam,
    currentWorkflowExists,
    workflowCount,
    hydration.phase,
    workspaceId,
    router,
    workflows,
  ])

  const blockConfigCache = useRef<Map<string, any>>(new Map())
  const getBlockConfig = useCallback((type: string) => {
    if (!blockConfigCache.current.has(type)) {
      blockConfigCache.current.set(type, getBlock(type))
    }
    return blockConfigCache.current.get(type)
  }, [])

  const prevBlocksHashRef = useRef<string>('')
  const prevBlocksRef = useRef(blocks)

  /** Stable hash of block STRUCTURAL properties - excludes position to prevent node recreation during drag. */
  const blocksStructureHash = useMemo(() => {
    // Only recalculate hash if blocks reference actually changed
    if (prevBlocksRef.current === blocks) {
      return prevBlocksHashRef.current
    }

    prevBlocksRef.current = blocks
    // Hash only structural properties - NOT position (position changes shouldn't recreate nodes)
    const hash = Object.values(blocks)
      .map((b) => {
        const width = typeof b.data?.width === 'number' ? b.data.width : ''
        const height = typeof b.data?.height === 'number' ? b.data.height : ''
        // Exclude position from hash - drag should not recreate nodes
        return `${b.id}:${b.type}:${b.name}:${b.height}:${b.data?.parentId || ''}:${width}:${height}`
      })
      .join('|')

    prevBlocksHashRef.current = hash
    return hash
  }, [blocks])

  /** Transforms blocks into ReactFlow nodes - only recreates on structural changes. */
  const derivedNodes = useMemo(() => {
    const nodeArray: Node[] = []

    // Add block nodes
    Object.entries(blocks).forEach(([, block]) => {
      if (!block || !block.type || !block.name) {
        return
      }

      // Handle container nodes differently
      if (block.type === 'loop' || block.type === 'parallel') {
        nodeArray.push({
          id: block.id,
          type: 'subflowNode',
          position: block.position,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          dragHandle: '.workflow-drag-handle',
          draggable: !isBlockProtected(block.id, blocks),
          data: {
            ...block.data,
            name: block.name,
            width: block.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
            height: block.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
            kind: block.type === 'loop' ? 'loop' : 'parallel',
          },
        })
        return
      }

      const blockConfig = getBlockConfig(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, {
          block,
        })
        return
      }

      const position = block.position

      const isActive = activeBlockIds.has(block.id)
      const isPending = isDebugging && pendingBlocks.includes(block.id)

      // Both note blocks and workflow blocks use deterministic dimensions
      const nodeType = block.type === 'note' ? 'noteBlock' : 'workflowBlock'
      const dragHandle = block.type === 'note' ? '.note-drag-handle' : '.workflow-drag-handle'

      // Create stable node object - React Flow will handle shallow comparison
      nodeArray.push({
        id: block.id,
        type: nodeType,
        position,
        parentId: block.data?.parentId,
        dragHandle,
        draggable: !isBlockProtected(block.id, blocks),
        extent: (() => {
          // Clamp children to subflow body (exclude header)
          const parentId = block.data?.parentId as string | undefined
          if (!parentId) return block.data?.extent || undefined

          // Constrain ONLY the top by header height (42px) and keep a small left padding.
          // Do not clamp right/bottom so blocks can move freely within the body.
          const headerHeight = 42
          const leftPadding = 16
          const minX = leftPadding
          const minY = headerHeight
          const maxX = Number.POSITIVE_INFINITY
          const maxY = Number.POSITIVE_INFINITY

          return [
            [minX, minY],
            [maxX, maxY],
          ] as [[number, number], [number, number]]
        })(),
        data: {
          type: block.type,
          config: blockConfig, // Cached config reference
          name: block.name,
          isActive,
          isPending,
        },
        // Include dynamic dimensions for container resizing calculations (must match rendered size)
        // Both note and workflow blocks calculate dimensions deterministically via useBlockDimensions
        // Use estimated dimensions for blocks without measured height to ensure selection bounds are correct
        width: BLOCK_DIMENSIONS.FIXED_WIDTH,
        height: block.height
          ? Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT)
          : estimateBlockDimensions(block.type).height,
      })
    })

    return nodeArray
  }, [blocksStructureHash, blocks, activeBlockIds, pendingBlocks, isDebugging, getBlockConfig])

  // Local state for nodes - allows smooth drag without store updates on every frame
  const [displayNodes, setDisplayNodes] = useState<Node[]>([])

  useEffect(() => {
    // Check for pending selection (from paste/duplicate), otherwise preserve existing selection
    if (pendingSelection && pendingSelection.length > 0) {
      const pendingSet = new Set(pendingSelection)
      clearPendingSelection()

      // Apply pending selection and resolve parent-child conflicts
      const withSelection = derivedNodes.map((node) => ({
        ...node,
        selected: pendingSet.has(node.id),
      }))
      const resolved = resolveParentChildSelectionConflicts(withSelection, blocks)
      setDisplayNodes(resolved)
      const selectedIds = resolved.filter((node) => node.selected).map((node) => node.id)
      syncPanelWithSelection(selectedIds)
      return
    }

    // Preserve existing selection state
    setDisplayNodes((currentNodes) => {
      const selectedIds = new Set(currentNodes.filter((n) => n.selected).map((n) => n.id))
      return derivedNodes.map((node) => ({
        ...node,
        selected: selectedIds.has(node.id),
      }))
    })
  }, [derivedNodes, blocks, pendingSelection, clearPendingSelection])

  /** Pans viewport to pending blocks once they have valid dimensions. */
  useEffect(() => {
    const pendingBlockIds = pendingZoomBlockIdsRef.current
    if (!pendingBlockIds || pendingBlockIds.size === 0) return

    const pendingNodes = displayNodes.filter((node) => pendingBlockIds.has(node.id))
    const allNodesReady =
      pendingNodes.length === pendingBlockIds.size &&
      pendingNodes.every(
        (node) =>
          typeof node.width === 'number' &&
          typeof node.height === 'number' &&
          node.width > 0 &&
          node.height > 0
      )

    if (allNodesReady) {
      logger.info('Focusing on changed blocks', {
        changedBlockIds: Array.from(pendingBlockIds),
        foundNodes: pendingNodes.length,
      })
      pendingZoomBlockIdsRef.current = null

      const nodesWithAbsolutePositions = pendingNodes.map((node) => ({
        ...node,
        position: getNodeAbsolutePosition(node.id),
      }))

      requestAnimationFrame(() => {
        fitViewToBounds({
          nodes: nodesWithAbsolutePositions,
          duration: 600,
          padding: 0.1,
          minZoom: 0.5,
          maxZoom: 1.0,
        })
      })
    }
  }, [displayNodes, fitViewToBounds, getNodeAbsolutePosition])

  /** Handles ActionBar remove-from-subflow events. */
  useEffect(() => {
    const handleRemoveFromSubflow = (event: Event) => {
      const customEvent = event as CustomEvent<{ blockIds: string[] }>
      const blockIds = customEvent.detail?.blockIds
      if (!blockIds || blockIds.length === 0) return

      try {
        const validBlockIds = blockIds.filter((id) => {
          const block = blocks[id]
          return block?.data?.parentId
        })
        if (validBlockIds.length === 0) return

        const movingNodeIds = new Set(validBlockIds)

        // Find boundary edges (edges that cross the subflow boundary)
        const boundaryEdges = edgesForDisplay.filter((e) => {
          const sourceInSelection = movingNodeIds.has(e.source)
          const targetInSelection = movingNodeIds.has(e.target)
          return sourceInSelection !== targetInSelection
        })
        const boundaryEdgesByNode = mapEdgesByNode(boundaryEdges, movingNodeIds)

        // Collect absolute positions BEFORE any mutations
        const absolutePositions = new Map<string, { x: number; y: number }>()
        for (const blockId of validBlockIds) {
          absolutePositions.set(blockId, getNodeAbsolutePosition(blockId))
        }

        // Build batch update with all blocks and their affected edges
        const updates = validBlockIds.map((blockId) => {
          const absolutePosition = absolutePositions.get(blockId)!
          const edgesForThisNode = boundaryEdgesByNode.get(blockId) ?? []
          return {
            blockId,
            newParentId: null,
            newPosition: absolutePosition,
            affectedEdges: edgesForThisNode,
          }
        })

        // Single atomic batch update (handles edge removal + parent update + undo/redo)
        collaborativeBatchUpdateParent(updates)

        // Update displayNodes once to prevent React Flow from using stale parent data
        setDisplayNodes((nodes) =>
          nodes.map((n) => {
            const absPos = absolutePositions.get(n.id)
            if (absPos) {
              return {
                ...n,
                position: absPos,
                parentId: undefined,
                extent: undefined,
              }
            }
            return n
          })
        )

        // Note: Container resize happens automatically via the derivedNodes effect
      } catch (err) {
        logger.error('Failed to remove from subflow', { err })
      }
    }

    window.addEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
    return () =>
      window.removeEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
  }, [blocks, edgesForDisplay, getNodeAbsolutePosition, collaborativeBatchUpdateParent])

  /**
   * Updates container dimensions in displayNodes during drag or keyboard movement.
   */
  const updateContainerDimensionsDuringMove = useCallback(
    (movedNodeId: string, movedNodePosition: { x: number; y: number }) => {
      const parentId = blocks[movedNodeId]?.data?.parentId
      if (!parentId) return

      setDisplayNodes((currentNodes) => {
        const childNodes = currentNodes.filter((n) => n.parentId === parentId)
        if (childNodes.length === 0) return currentNodes

        const childPositions = childNodes.map((node) => {
          const nodePosition = node.id === movedNodeId ? movedNodePosition : node.position
          const { width, height } = getBlockDimensions(node.id)
          return { x: nodePosition.x, y: nodePosition.y, width, height }
        })

        const { width: newWidth, height: newHeight } = calculateContainerDimensions(childPositions)

        return currentNodes.map((node) => {
          if (node.id === parentId) {
            const currentWidth = node.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH
            const currentHeight = node.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT

            // Only update if dimensions changed
            if (newWidth !== currentWidth || newHeight !== currentHeight) {
              return {
                ...node,
                data: {
                  ...node.data,
                  width: newWidth,
                  height: newHeight,
                },
              }
            }
          }
          return node
        })
      })
    },
    [blocks, getBlockDimensions]
  )

  /** Handles node changes - applies changes and resolves parent-child selection conflicts. */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      selectedIdsRef.current = null
      setDisplayNodes((nds) => {
        const updated = applyNodeChanges(changes, nds)
        const hasSelectionChange = changes.some((c) => c.type === 'select')
        if (!hasSelectionChange) return updated
        const resolved = resolveParentChildSelectionConflicts(updated, blocks)
        selectedIdsRef.current = resolved.filter((node) => node.selected).map((node) => node.id)
        return resolved
      })
      const selectedIds = selectedIdsRef.current as string[] | null
      if (selectedIds !== null) {
        syncPanelWithSelection(selectedIds)
      }

      // Handle position changes (e.g., from keyboard arrow key movement)
      // Update container dimensions when child nodes are moved and persist to backend
      // Only persist if not in a drag operation (drag-end is handled by onNodeDragStop)
      const isInDragOperation =
        getDragStartPosition() !== null || multiNodeDragStartRef.current.size > 0
      const keyboardPositionUpdates: Array<{ id: string; position: { x: number; y: number } }> = []
      for (const change of changes) {
        if (
          change.type === 'position' &&
          !change.dragging &&
          'position' in change &&
          change.position
        ) {
          updateContainerDimensionsDuringMove(change.id, change.position)
          if (!isInDragOperation) {
            keyboardPositionUpdates.push({ id: change.id, position: change.position })
          }
        }
      }
      // Persist keyboard movements to backend for collaboration sync
      if (keyboardPositionUpdates.length > 0) {
        collaborativeBatchUpdatePositions(keyboardPositionUpdates)
      }
    },
    [
      blocks,
      updateContainerDimensionsDuringMove,
      collaborativeBatchUpdatePositions,
      getDragStartPosition,
    ]
  )

  /**
   * Effect to resize loops when nodes change (add/remove/position change).
   * Runs on structural changes only - not during drag (position-only changes).
   * Skips during loading.
   */
  useEffect(() => {
    // Skip during initial render when nodes aren't loaded yet or workflow not ready
    if (derivedNodes.length === 0 || !isWorkflowReady) return

    // Resize all loops to fit their children
    resizeLoopNodesWrapper()
  }, [derivedNodes, resizeLoopNodesWrapper, isWorkflowReady])

  /** Cleans up orphaned nodes with invalid parent references after deletion. */
  useEffect(() => {
    if (!isWorkflowReady) return

    // Create a mapping of node IDs to check for missing parent references
    const nodeIds = new Set(Object.keys(blocks))

    // Check for nodes with invalid parent references and collect updates
    const orphanedUpdates: Array<{
      id: string
      position: { x: number; y: number }
      parentId: string
    }> = []
    Object.entries(blocks).forEach(([id, block]) => {
      const parentId = block.data?.parentId

      // If block has a parent reference but parent no longer exists
      if (parentId && !nodeIds.has(parentId)) {
        logger.warn('Found orphaned node with invalid parent reference', {
          nodeId: id,
          missingParentId: parentId,
        })

        const absolutePosition = getNodeAbsolutePosition(id)
        orphanedUpdates.push({ id, position: absolutePosition, parentId: '' })
      }
    })

    // Batch update all orphaned nodes at once
    if (orphanedUpdates.length > 0) {
      batchUpdateBlocksWithParent(orphanedUpdates)
    }
  }, [blocks, batchUpdateBlocksWithParent, getNodeAbsolutePosition, isWorkflowReady])

  /** Handles edge removal changes. */
  const onEdgesChange = useCallback(
    (changes: any) => {
      const edgeIdsToRemove = changes
        .filter((change: any) => change.type === 'remove')
        .map((change: any) => change.id)
        .filter((edgeId: string) => {
          // Prevent removing edges connected to protected blocks
          const edge = edges.find((e) => e.id === edgeId)
          if (!edge) return true
          return !isEdgeProtected(edge, blocks)
        })

      if (edgeIdsToRemove.length > 0) {
        collaborativeBatchRemoveEdges(edgeIdsToRemove)
      }
    },
    [collaborativeBatchRemoveEdges, edges, blocks]
  )

  /**
   * Finds the best node at a given flow position for drop-on-block connection.
   * Skips subflow containers as they have their own connection logic.
   */
  const findNodeAtPosition = useCallback(
    (position: { x: number; y: number }) => {
      const cursorRect = {
        x: position.x - 1,
        y: position.y - 1,
        width: 2,
        height: 2,
      }

      const intersecting = getIntersectingNodes(cursorRect, true).filter(
        (node) => node.type !== 'subflowNode'
      )

      if (intersecting.length === 0) return undefined
      if (intersecting.length === 1) return intersecting[0]

      return intersecting.reduce((closest, node) => {
        const getDistance = (n: Node) => {
          const absPos = getNodeAbsolutePosition(n.id)
          const dims = getBlockDimensions(n.id)
          const centerX = absPos.x + dims.width / 2
          const centerY = absPos.y + dims.height / 2
          return Math.hypot(position.x - centerX, position.y - centerY)
        }

        return getDistance(node) < getDistance(closest) ? node : closest
      })
    },
    [getIntersectingNodes, getNodeAbsolutePosition, getBlockDimensions]
  )

  /**
   * Captures the source handle when a connection drag starts.
   * Resets connectionCompletedRef to track if onConnect handles this connection.
   */
  const onConnectStart = useCallback((_event: any, params: any) => {
    const handleId: string | undefined = params?.handleId
    setIsErrorConnectionDrag(handleId === 'error')
    connectionSourceRef.current = {
      nodeId: params?.nodeId,
      handleId: params?.handleId,
    }
    connectionCompletedRef.current = false
  }, [])

  /** Handles new edge connections with container boundary validation. */
  const onConnect = useCallback(
    (connection: any) => {
      if (connection.source && connection.target) {
        // Check if connecting nodes across container boundaries
        const sourceNode = getNodes().find((n) => n.id === connection.source)
        const targetNode = getNodes().find((n) => n.id === connection.target)

        if (!sourceNode || !targetNode) return

        // Prevent connections to/from protected blocks
        if (isEdgeProtected(connection, blocks)) {
          addNotification({
            level: 'info',
            message: 'Cannot connect to locked blocks or blocks inside locked containers',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }

        // Get parent information (handle container start node case)
        const sourceParentId =
          blocks[sourceNode.id]?.data?.parentId ||
          (connection.sourceHandle === 'loop-start-source' ||
          connection.sourceHandle === 'parallel-start-source'
            ? connection.source
            : undefined)
        const targetParentId = blocks[targetNode.id]?.data?.parentId

        // Generate a unique edge ID
        const edgeId = crypto.randomUUID()

        // Special case for container start source: Always allow connections to nodes within the same container
        if (
          (connection.sourceHandle === 'loop-start-source' ||
            connection.sourceHandle === 'parallel-start-source') &&
          blocks[targetNode.id]?.data?.parentId === sourceNode.id
        ) {
          // This is a connection from container start to a node inside the container - always allow

          addEdge({
            ...connection,
            id: edgeId,
            type: 'workflowEdge',
            // Add metadata about the container context
            data: {
              parentId: sourceNode.id,
              isInsideContainer: true,
            },
          })
          connectionCompletedRef.current = true
          return
        }

        // Prevent connections across container boundaries
        if (
          (sourceParentId && !targetParentId) ||
          (!sourceParentId && targetParentId) ||
          (sourceParentId && targetParentId && sourceParentId !== targetParentId)
        ) {
          return
        }

        // Track if this connection is inside a container
        const isInsideContainer = Boolean(sourceParentId) || Boolean(targetParentId)
        const parentId = sourceParentId || targetParentId

        // Add appropriate metadata for container context
        addEdge({
          ...connection,
          id: edgeId,
          type: 'workflowEdge',
          data: isInsideContainer
            ? {
                parentId,
                isInsideContainer,
              }
            : undefined,
        })
        connectionCompletedRef.current = true
      }
    },
    [addEdge, getNodes, blocks, addNotification, activeWorkflowId]
  )

  /**
   * Handles connection drag end. Detects if the edge was dropped over a block
   * and automatically creates a connection to that block's target handle.
   *
   * Uses connectionCompletedRef to check if onConnect already handled this connection
   * (ReactFlow pattern for distinguishing handle-to-handle vs handle-to-body drops).
   */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      setIsErrorConnectionDrag(false)

      const source = connectionSourceRef.current
      if (!source?.nodeId) {
        connectionSourceRef.current = null
        return
      }

      // If onConnect already handled this connection, skip (handle-to-handle case)
      if (connectionCompletedRef.current) {
        connectionSourceRef.current = null
        return
      }

      // Get cursor position in flow coordinates
      const clientPos = 'changedTouches' in event ? event.changedTouches[0] : event
      const flowPosition = screenToFlowPosition({
        x: clientPos.clientX,
        y: clientPos.clientY,
      })

      // Find node under cursor
      const targetNode = findNodeAtPosition(flowPosition)

      // Create connection if valid target found (handle-to-body case)
      if (targetNode && targetNode.id !== source.nodeId) {
        onConnect({
          source: source.nodeId,
          sourceHandle: source.handleId,
          target: targetNode.id,
          targetHandle: 'target',
        })
      }

      connectionSourceRef.current = null
    },
    [screenToFlowPosition, findNodeAtPosition, onConnect]
  )

  /** Handles node drag to detect container intersections and update highlighting. */
  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: any) => {
      // Note: We don't emit position updates during drag to avoid flooding socket events.
      // The final position is sent in onNodeDragStop for collaborative updates.

      // Get the current parent ID of the node being dragged
      const currentParentId = blocks[node.id]?.data?.parentId || null

      // If the node is inside a container, update container dimensions during drag
      if (currentParentId) {
        updateContainerDimensionsDuringMove(node.id, node.position)
      }

      // Check if this is a starter block - starter blocks should never be in containers
      const isStarterBlock = node.data?.type === 'starter'
      if (isStarterBlock) {
        // If it's a starter block, remove any highlighting and don't allow it to be dragged into containers
        if (potentialParentId) {
          clearDragHighlights()
          setPotentialParentId(null)
        }
        return // Exit early - don't process any container intersections for starter blocks
      }

      // Get the node's absolute position to properly calculate intersections
      const nodeAbsolutePos = getNodeAbsolutePosition(node.id)

      // Prevent subflows from being dragged into other subflows
      if (node.type === 'subflowNode') {
        // Clear any highlighting for subflow nodes
        if (potentialParentId) {
          clearDragHighlights()
          setPotentialParentId(null)
        }
        return // Exit early - subflows cannot be placed inside other subflows
      }

      // Find intersections with container nodes using absolute coordinates
      const intersectingNodes = getNodes()
        .filter((n) => {
          // Only consider container nodes that aren't the dragged node
          if (n.type !== 'subflowNode' || n.id === node.id) return false

          // Don't allow dropping into locked containers
          if (blocks[n.id]?.locked) return false

          // Get the container's absolute position
          const containerAbsolutePos = getNodeAbsolutePosition(n.id)

          // Get dimensions based on node type (must match actual rendered dimensions)
          const nodeWidth =
            node.type === 'subflowNode'
              ? node.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH
              : BLOCK_DIMENSIONS.FIXED_WIDTH

          const nodeHeight =
            node.type === 'subflowNode'
              ? node.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
              : Math.max(node.height || BLOCK_DIMENSIONS.MIN_HEIGHT, BLOCK_DIMENSIONS.MIN_HEIGHT)

          // Check intersection using absolute coordinates
          const nodeRect = {
            left: nodeAbsolutePos.x,
            right: nodeAbsolutePos.x + nodeWidth,
            top: nodeAbsolutePos.y,
            bottom: nodeAbsolutePos.y + nodeHeight,
          }

          const containerRect = {
            left: containerAbsolutePos.x,
            right: containerAbsolutePos.x + (n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
            top: containerAbsolutePos.y,
            bottom:
              containerAbsolutePos.y + (n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
          }

          // Check intersection with absolute coordinates for accurate detection
          return (
            nodeRect.left < containerRect.right &&
            nodeRect.right > containerRect.left &&
            nodeRect.top < containerRect.bottom &&
            nodeRect.bottom > containerRect.top
          )
        })
        // Add more information for sorting
        .map((n) => ({
          container: n,
          depth: getNodeDepth(n.id),
          // Calculate size for secondary sorting
          size:
            (n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH) *
            (n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
        }))

      // Update potential parent if there's at least one intersecting container node
      if (intersectingNodes.length > 0) {
        // Sort by depth first (deepest/most nested containers first), then by size if same depth
        const sortedContainers = intersectingNodes.sort((a, b) => {
          // First try to compare by hierarchy depth
          if (a.depth !== b.depth) {
            return b.depth - a.depth // Higher depth (more nested) comes first
          }
          // If same depth, use size as secondary criterion
          return a.size - b.size // Smaller container takes precedence
        })

        // Use the most appropriate container (deepest or smallest at same depth)
        const bestContainerMatch = sortedContainers[0]

        setPotentialParentId(bestContainerMatch.container.id)

        // Add highlight class and change cursor
        const kind = (bestContainerMatch.container.data as SubflowNodeData)?.kind
        if (kind === 'loop' || kind === 'parallel') {
          highlightContainerNode(bestContainerMatch.container.id, kind)
        }
      } else {
        // Remove highlighting if no longer over a container
        if (potentialParentId) {
          clearDragHighlights()
          setPotentialParentId(null)
        }
      }
    },
    [
      getNodes,
      potentialParentId,
      blocks,
      getNodeAbsolutePosition,
      getNodeDepth,
      updateContainerDimensionsDuringMove,
      highlightContainerNode,
    ]
  )

  /** Captures initial parent ID and position when drag starts. */
  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: any) => {
      // Note: Protected blocks are already non-draggable via the `draggable` node property

      // Store the original parent ID when starting to drag
      const currentParentId = blocks[node.id]?.data?.parentId || null
      setDragStartParentId(currentParentId)
      // Initialize potentialParentId to the current parent so a click without movement doesn't remove from subflow
      setPotentialParentId(currentParentId)
      // Store starting position for undo/redo move entry
      setDragStartPosition({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        parentId: currentParentId,
      })

      // Capture all selected nodes' positions for multi-node undo/redo
      const allNodes = getNodes()
      const selectedNodes = allNodes.filter((n) => n.selected)
      multiNodeDragStartRef.current.clear()
      selectedNodes.forEach((n) => {
        const block = blocks[n.id]
        if (block) {
          multiNodeDragStartRef.current.set(n.id, {
            x: n.position.x,
            y: n.position.y,
            parentId: block.data?.parentId,
          })
        }
      })
    },
    [blocks, setDragStartPosition, getNodes, setPotentialParentId]
  )

  /** Handles node drag stop to establish parent-child relationships. */
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: any) => {
      clearDragHighlights()

      // Get all selected nodes to update their positions too
      const allNodes = getNodes()
      const selectedNodes = allNodes.filter((n) => n.selected)

      // If multiple nodes are selected, update all their positions
      if (selectedNodes.length > 1) {
        const positionUpdates = computeClampedPositionUpdates(selectedNodes, blocks, allNodes)
        collaborativeBatchUpdatePositions(positionUpdates, {
          previousPositions: multiNodeDragStartRef.current,
        })

        // Process parent updates using shared helper
        executeBatchParentUpdate(
          selectedNodes,
          potentialParentId,
          'Batch moved nodes to new parent'
        )

        // Clear drag start state
        setDragStartPosition(null)
        setPotentialParentId(null)
        multiNodeDragStartRef.current.clear()
        return
      }

      // Single node drag - original logic
      const finalPosition = getClampedPositionForNode(node.id, node.position, blocks, allNodes)

      updateBlockPosition(node.id, finalPosition)

      // Record single move entry on drag end to avoid micro-moves
      const start = getDragStartPosition()
      if (start && start.id === node.id) {
        const before = { x: start.x, y: start.y, parentId: start.parentId }
        const after = {
          x: finalPosition.x,
          y: finalPosition.y,
          parentId: node.parentId || blocks[node.id]?.data?.parentId,
        }
        const moved =
          before.x !== after.x || before.y !== after.y || before.parentId !== after.parentId
        if (moved) {
          window.dispatchEvent(
            new CustomEvent('workflow-record-move', {
              detail: { blockId: node.id, before, after },
            })
          )
        }
        setDragStartPosition(null)
      }

      // Don't process parent changes if the node hasn't actually changed parent or is being moved within same parent
      if (potentialParentId === dragStartParentId) return

      // Prevent moving locked blocks out of locked containers
      // Unlocked blocks (e.g., duplicates) can be moved out freely
      if (dragStartParentId && blocks[dragStartParentId]?.locked && blocks[node.id]?.locked) {
        addNotification({
          level: 'info',
          message: 'Cannot move locked blocks out of locked containers',
          workflowId: activeWorkflowId || undefined,
        })
        setPotentialParentId(dragStartParentId) // Reset to original parent
        return
      }

      // Check if this is a starter block - starter blocks should never be in containers
      const isStarterBlock = node.data?.type === 'starter'
      if (isStarterBlock) {
        logger.warn('Prevented starter block from being placed inside a container', {
          blockId: node.id,
          attemptedParentId: potentialParentId,
        })
        setPotentialParentId(null)
        return // Exit early - don't allow starter blocks to have parents
      }

      // Trigger blocks cannot be placed inside loop or parallel subflows
      if (potentialParentId) {
        const block = blocks[node.id]
        if (block && TriggerUtils.isTriggerBlock(block)) {
          addNotification({
            level: 'error',
            message: 'Triggers cannot be placed inside loop or parallel subflows.',
            workflowId: activeWorkflowId || undefined,
          })
          logger.warn('Prevented trigger block from being placed inside a container', {
            blockId: node.id,
            blockType: block.type,
            attemptedParentId: potentialParentId,
          })
          setPotentialParentId(null)
          return
        }
      }

      // Update the node's parent relationship
      if (potentialParentId) {
        // Remove existing edges before moving into container
        const edgesToRemove = edgesForDisplay.filter(
          (e) => e.source === node.id || e.target === node.id
        )

        if (edgesToRemove.length > 0) {
          removeEdgesForNode(node.id, edgesToRemove)

          logger.info('Removed edges when moving node into subflow', {
            blockId: node.id,
            targetParentId: potentialParentId,
            edgeCount: edgesToRemove.length,
          })
        }

        // Compute relative position BEFORE updating parent to avoid stale state
        // Account for header (50px), left padding (16px), and top padding (16px)
        const containerAbsPosBefore = getNodeAbsolutePosition(potentialParentId)
        const nodeAbsPosBefore = getNodeAbsolutePosition(node.id)
        const headerHeight = 50
        const leftPadding = 16
        const topPadding = 16

        const relativePositionBefore = {
          x: nodeAbsPosBefore.x - containerAbsPosBefore.x - leftPadding,
          y: nodeAbsPosBefore.y - containerAbsPosBefore.y - headerHeight - topPadding,
        }

        // Auto-connect when moving an existing block into a container
        const existingChildBlocks = Object.values(blocks)
          .filter((b) => b.data?.parentId === potentialParentId && b.id !== node.id)
          .map((b) => ({ id: b.id, type: b.type, position: b.position }))

        const autoConnectEdge = tryCreateAutoConnectEdge(relativePositionBefore, node.id, {
          targetParentId: potentialParentId,
          existingChildBlocks,
          containerId: potentialParentId,
        })

        const edgesToAdd: Edge[] = autoConnectEdge ? [autoConnectEdge] : []

        // Moving to a new parent container - pass both removed and added edges for undo/redo
        const affectedEdges = [...edgesToRemove, ...edgesToAdd]
        updateNodeParent(node.id, potentialParentId, affectedEdges)

        setDisplayNodes((nodes) =>
          nodes.map((n) => {
            if (n.id === node.id) {
              return {
                ...n,
                position: relativePositionBefore,
                parentId: potentialParentId,
                extent: 'parent' as const,
              }
            }
            return n
          })
        )

        // Add edges after parent update (skip undo recording - it's part of parent update)
        if (edgesToAdd.length > 0) {
          collaborativeBatchAddEdges(edgesToAdd, { skipUndoRedo: true })
        }
      } else if (!potentialParentId && dragStartParentId) {
        // Moving OUT of a subflow to canvas
        // Get absolute position BEFORE removing from parent
        const absolutePosition = getNodeAbsolutePosition(node.id)

        // Remove edges connected to this node since it's leaving its parent
        const edgesToRemove = edgesForDisplay.filter(
          (e) => e.source === node.id || e.target === node.id
        )

        if (edgesToRemove.length > 0) {
          removeEdgesForNode(node.id, edgesToRemove)

          logger.info('Removed edges when moving node out of subflow', {
            blockId: node.id,
            sourceParentId: dragStartParentId,
            edgeCount: edgesToRemove.length,
          })
        }

        // Clear the parent relationship
        updateNodeParent(node.id, null, edgesToRemove)

        // Immediately update displayNodes to prevent React Flow from using stale parent data
        setDisplayNodes((nodes) =>
          nodes.map((n) => {
            if (n.id === node.id) {
              return {
                ...n,
                position: absolutePosition,
                parentId: undefined,
                extent: undefined,
              }
            }
            return n
          })
        )

        logger.info('Moved node out of subflow', {
          blockId: node.id,
          sourceParentId: dragStartParentId,
        })
      }

      // Reset state
      setPotentialParentId(null)
    },
    [
      getNodes,
      dragStartParentId,
      potentialParentId,
      updateNodeParent,
      updateBlockPosition,
      collaborativeBatchAddEdges,
      tryCreateAutoConnectEdge,
      blocks,
      edgesForDisplay,
      removeEdgesForNode,
      getNodeAbsolutePosition,
      getDragStartPosition,
      setDragStartPosition,
      addNotification,
      activeWorkflowId,
      collaborativeBatchUpdatePositions,
      executeBatchParentUpdate,
    ]
  )

  /** Captures initial positions when selection drag starts (for marquee-selected nodes). */
  const onSelectionDragStart = useCallback(
    (_event: React.MouseEvent, nodes: Node[]) => {
      if (nodes.length > 0) {
        const firstNodeParentId = blocks[nodes[0].id]?.data?.parentId || null
        setDragStartParentId(firstNodeParentId)
      }

      // Filter to nodes that won't be deselected (exclude children whose parent is selected)
      const nodeIds = new Set(nodes.map((n) => n.id))
      const effectiveNodes = nodes.filter((n) => {
        const parentId = blocks[n.id]?.data?.parentId
        return !parentId || !nodeIds.has(parentId)
      })

      // Capture positions for undo/redo before applying display changes
      multiNodeDragStartRef.current.clear()
      effectiveNodes.forEach((n) => {
        const blk = blocks[n.id]
        if (blk) {
          multiNodeDragStartRef.current.set(n.id, {
            x: n.position.x,
            y: n.position.y,
            parentId: blk.data?.parentId,
          })
        }
      })

      // Apply visual deselection of children
      setDisplayNodes((allNodes) => resolveParentChildSelectionConflicts(allNodes, blocks))
    },
    [blocks]
  )

  /** Handles selection drag to detect potential parent containers for batch drops. */
  const onSelectionDrag = useCallback(
    (_event: React.MouseEvent, nodes: Node[]) => {
      if (nodes.length === 0) return

      // Filter out nodes that can't be placed in containers
      const eligibleNodes = nodes.filter(canNodeEnterContainer)

      // If no eligible nodes, clear any potential parent
      if (eligibleNodes.length === 0) {
        if (potentialParentId) {
          clearDragHighlights()
          setPotentialParentId(null)
        }
        return
      }

      // Calculate bounding box of all dragged nodes using absolute positions
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY

      eligibleNodes.forEach((node) => {
        const absolutePos = getNodeAbsolutePosition(node.id)
        const width = BLOCK_DIMENSIONS.FIXED_WIDTH
        const height = Math.max(
          node.height || BLOCK_DIMENSIONS.MIN_HEIGHT,
          BLOCK_DIMENSIONS.MIN_HEIGHT
        )

        minX = Math.min(minX, absolutePos.x)
        minY = Math.min(minY, absolutePos.y)
        maxX = Math.max(maxX, absolutePos.x + width)
        maxY = Math.max(maxY, absolutePos.y + height)
      })

      // Use bounding box for intersection detection
      const selectionRect = { left: minX, right: maxX, top: minY, bottom: maxY }

      // Find containers that intersect with the selection bounding box
      const allNodes = getNodes()
      const intersectingContainers = allNodes
        .filter((containerNode) => {
          if (containerNode.type !== 'subflowNode') return false
          // Skip if any dragged node is this container
          if (nodes.some((n) => n.id === containerNode.id)) return false

          const containerAbsolutePos = getNodeAbsolutePosition(containerNode.id)
          const containerRect = {
            left: containerAbsolutePos.x,
            right:
              containerAbsolutePos.x +
              (containerNode.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
            top: containerAbsolutePos.y,
            bottom:
              containerAbsolutePos.y +
              (containerNode.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
          }

          // Check intersection
          return (
            selectionRect.left < containerRect.right &&
            selectionRect.right > containerRect.left &&
            selectionRect.top < containerRect.bottom &&
            selectionRect.bottom > containerRect.top
          )
        })
        .map((n) => ({
          container: n,
          depth: getNodeDepth(n.id),
          size:
            (n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH) *
            (n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
        }))

      if (intersectingContainers.length > 0) {
        // Sort by depth first (deepest first), then by size
        const sortedContainers = intersectingContainers.sort((a, b) => {
          if (a.depth !== b.depth) return b.depth - a.depth
          return a.size - b.size
        })

        const bestMatch = sortedContainers[0]

        if (bestMatch.container.id !== potentialParentId) {
          setPotentialParentId(bestMatch.container.id)

          // Add highlight
          const kind = (bestMatch.container.data as SubflowNodeData)?.kind
          if (kind === 'loop' || kind === 'parallel') {
            highlightContainerNode(bestMatch.container.id, kind)
          }
        }
      } else if (potentialParentId) {
        clearDragHighlights()
        setPotentialParentId(null)
      }
    },
    [
      canNodeEnterContainer,
      getNodes,
      potentialParentId,
      getNodeAbsolutePosition,
      getNodeDepth,
      clearDragHighlights,
      highlightContainerNode,
    ]
  )

  const onSelectionDragStop = useCallback(
    (_event: React.MouseEvent, nodes: any[]) => {
      clearDragHighlights()
      if (nodes.length === 0) return

      const allNodes = getNodes()
      const positionUpdates = computeClampedPositionUpdates(nodes, blocks, allNodes)
      collaborativeBatchUpdatePositions(positionUpdates, {
        previousPositions: multiNodeDragStartRef.current,
      })

      // Process parent updates using shared helper
      executeBatchParentUpdate(nodes, potentialParentId, 'Batch moved selection to new parent')

      // Clear drag state
      setDragStartPosition(null)
      setPotentialParentId(null)
      multiNodeDragStartRef.current.clear()
    },
    [
      blocks,
      getNodes,
      collaborativeBatchUpdatePositions,
      potentialParentId,
      clearDragHighlights,
      executeBatchParentUpdate,
    ]
  )

  const onPaneClick = useCallback(() => {
    setSelectedEdges(new Map())
    usePanelEditorStore.getState().clearCurrentBlock()
  }, [])

  /**
   * Handles node click to select the node in ReactFlow.
   * Parent-child conflict resolution happens automatically in onNodesChange.
   */
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey
      setNodes((nodes) =>
        nodes.map((n) => ({
          ...n,
          selected: isMultiSelect ? (n.id === node.id ? true : n.selected) : n.id === node.id,
        }))
      )
    },
    [setNodes]
  )

  /** Handles edge selection with container context tracking and Shift-click multi-selection. */
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: any) => {
      event.stopPropagation() // Prevent bubbling

      // Determine if edge is inside a loop by checking its source/target nodes
      const sourceNode = getNodes().find((n) => n.id === edge.source)
      const targetNode = getNodes().find((n) => n.id === edge.target)

      // An edge is inside a loop if either source or target has a parent
      // If source and target have different parents, prioritize source's parent
      const parentLoopId = sourceNode?.parentId || targetNode?.parentId

      // Create a unique identifier that combines edge ID and parent context
      const contextId = `${edge.id}${parentLoopId ? `-${parentLoopId}` : ''}`

      if (event.shiftKey) {
        // Shift-click: toggle edge in selection
        setSelectedEdges((prev) => {
          const next = new Map(prev)
          if (next.has(contextId)) {
            next.delete(contextId)
          } else {
            next.set(contextId, edge.id)
          }
          return next
        })
      } else {
        // Normal click: replace selection with this edge
        setSelectedEdges(new Map([[contextId, edge.id]]))
      }
    },
    [getNodes]
  )

  /** Stable delete handler to avoid creating new function references per edge. */
  const handleEdgeDelete = useCallback(
    (edgeId: string) => {
      // Prevent removing edges connected to protected blocks
      const edge = edges.find((e) => e.id === edgeId)
      if (edge && isEdgeProtected(edge, blocks)) {
        addNotification({
          level: 'info',
          message: 'Cannot remove connections from locked blocks',
          workflowId: activeWorkflowId || undefined,
        })
        return
      }
      removeEdge(edgeId)
      // Remove this edge from selection (find by edge ID value)
      setSelectedEdges((prev) => {
        const next = new Map(prev)
        for (const [contextId, id] of next) {
          if (id === edgeId) {
            next.delete(contextId)
          }
        }
        return next
      })
    },
    [removeEdge, edges, blocks, addNotification, activeWorkflowId]
  )

  /** Transforms edges to include selection state and delete handlers. Memoized to prevent re-renders. */
  const edgesWithSelection = useMemo(() => {
    const nodeMap = new Map(displayNodes.map((n) => [n.id, n]))

    return edgesForDisplay.map((edge) => {
      const sourceNode = nodeMap.get(edge.source)
      const targetNode = nodeMap.get(edge.target)
      const parentLoopId = sourceNode?.parentId || targetNode?.parentId
      const edgeContextId = `${edge.id}${parentLoopId ? `-${parentLoopId}` : ''}`

      return {
        ...edge,
        data: {
          ...edge.data,
          isSelected: selectedEdges.has(edgeContextId),
          isInsideLoop: Boolean(parentLoopId),
          parentLoopId,
          sourceHandle: edge.sourceHandle,
          onDelete: handleEdgeDelete,
        },
      }
    })
  }, [edgesForDisplay, displayNodes, selectedEdges, handleEdgeDelete])

  /** Handles Delete/Backspace to remove selected edges or blocks. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return
      }

      // Ignore when typing/navigating inside editable inputs or editors
      if (isInEditableElement()) {
        return
      }

      // Handle edge deletion first (edges take priority if selected)
      if (selectedEdges.size > 0) {
        // Get all selected edge IDs and filter out edges connected to protected blocks
        const edgeIds = Array.from(selectedEdges.values()).filter((edgeId) => {
          const edge = edges.find((e) => e.id === edgeId)
          if (!edge) return true
          return !isEdgeProtected(edge, blocks)
        })
        if (edgeIds.length > 0) {
          collaborativeBatchRemoveEdges(edgeIds)
        }
        setSelectedEdges(new Map())
        return
      }

      // Handle block deletion
      if (!effectivePermissions.canEdit) {
        return
      }

      const selectedNodes = getNodes().filter((node) => node.selected)
      if (selectedNodes.length === 0) {
        return
      }

      event.preventDefault()
      const selectedIds = selectedNodes.map((node) => node.id)
      const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(
        selectedIds,
        blocks
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
      if (deletableIds.length > 0) {
        collaborativeBatchRemoveBlocks(deletableIds)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedEdges,
    collaborativeBatchRemoveEdges,
    getNodes,
    collaborativeBatchRemoveBlocks,
    effectivePermissions.canEdit,
    blocks,
    edges,
    addNotification,
    activeWorkflowId,
  ])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <div className='relative h-full w-full flex-1'>
        {/* Loading spinner - always mounted, animation paused when hidden to avoid overhead */}
        <div
          className={`absolute inset-0 z-[5] flex items-center justify-center bg-[var(--bg)] transition-opacity duration-150 ${isWorkflowReady ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
        >
          <div
            className={`h-[18px] w-[18px] rounded-full ${isWorkflowReady ? '' : 'animate-spin'}`}
            style={{
              background:
                'conic-gradient(from 0deg, hsl(var(--muted-foreground)) 0deg 120deg, transparent 120deg 180deg, hsl(var(--muted-foreground)) 180deg 300deg, transparent 300deg 360deg)',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
              WebkitMask:
                'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
            }}
          />
        </div>

        {isWorkflowReady && (
          <>
            {showTrainingModal && <TrainingModal />}

            <ReactFlow
              nodes={displayNodes}
              edges={edgesWithSelection}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={effectivePermissions.canEdit ? onConnect : undefined}
              onConnectStart={effectivePermissions.canEdit ? onConnectStart : undefined}
              onConnectEnd={effectivePermissions.canEdit ? onConnectEnd : undefined}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onMouseDown={handleCanvasMouseDown}
              onDrop={effectivePermissions.canEdit ? onDrop : undefined}
              onDragOver={effectivePermissions.canEdit ? onDragOver : undefined}
              onInit={(instance) => {
                requestAnimationFrame(() => {
                  instance.fitView(reactFlowFitViewOptions)
                  setIsCanvasReady(true)
                })
              }}
              fitViewOptions={reactFlowFitViewOptions}
              minZoom={0.1}
              maxZoom={1.3}
              panOnScroll
              defaultEdgeOptions={defaultEdgeOptions}
              proOptions={reactFlowProOptions}
              connectionLineStyle={connectionLineStyle}
              connectionLineType={ConnectionLineType.SmoothStep}
              onPaneClick={onPaneClick}
              onEdgeClick={onEdgeClick}
              onNodeClick={handleNodeClick}
              onPaneContextMenu={handlePaneContextMenu}
              onNodeContextMenu={handleNodeContextMenu}
              onSelectionContextMenu={handleSelectionContextMenu}
              onPointerMove={handleCanvasPointerMove}
              onPointerLeave={handleCanvasPointerLeave}
              elementsSelectable={true}
              selectionOnDrag={selectionProps.selectionOnDrag}
              selectionMode={SelectionMode.Partial}
              panOnDrag={selectionProps.panOnDrag}
              selectionKeyCode={selectionProps.selectionKeyCode}
              multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
              nodesConnectable={effectivePermissions.canEdit}
              nodesDraggable={effectivePermissions.canEdit}
              draggable={false}
              noWheelClassName='allow-scroll'
              edgesFocusable={true}
              edgesUpdatable={effectivePermissions.canEdit}
              className={`workflow-container h-full transition-opacity duration-150 ${reactFlowStyles} ${isCanvasReady ? 'opacity-100' : 'opacity-0'} ${isHandMode ? 'canvas-mode-hand' : 'canvas-mode-cursor'}`}
              onNodeDrag={effectivePermissions.canEdit ? onNodeDrag : undefined}
              onNodeDragStop={effectivePermissions.canEdit ? onNodeDragStop : undefined}
              onSelectionDragStart={effectivePermissions.canEdit ? onSelectionDragStart : undefined}
              onSelectionDrag={effectivePermissions.canEdit ? onSelectionDrag : undefined}
              onSelectionDragStop={effectivePermissions.canEdit ? onSelectionDragStop : undefined}
              onNodeDragStart={effectivePermissions.canEdit ? onNodeDragStart : undefined}
              snapToGrid={snapToGrid}
              snapGrid={snapGrid}
              elevateEdgesOnSelect={true}
              onlyRenderVisibleElements={false}
              deleteKeyCode={null}
              elevateNodesOnSelect={true}
              autoPanOnConnect={effectivePermissions.canEdit}
              autoPanOnNodeDrag={effectivePermissions.canEdit}
            />

            <Cursors />

            <WorkflowControls />

            <Suspense fallback={null}>
              <LazyChat />
            </Suspense>

            {/* Context Menus */}
            <BlockMenu
              isOpen={isBlockMenuOpen}
              position={contextMenuPosition}
              menuRef={contextMenuRef}
              onClose={closeContextMenu}
              selectedBlocks={contextMenuBlocks}
              onCopy={handleContextCopy}
              onPaste={handleContextPaste}
              onDuplicate={handleContextDuplicate}
              onDelete={handleContextDelete}
              onToggleEnabled={handleContextToggleEnabled}
              onToggleHandles={handleContextToggleHandles}
              onRemoveFromSubflow={handleContextRemoveFromSubflow}
              onOpenEditor={handleContextOpenEditor}
              onRename={handleContextRename}
              onRunFromBlock={handleContextRunFromBlock}
              onRunUntilBlock={handleContextRunUntilBlock}
              hasClipboard={hasClipboard()}
              showRemoveFromSubflow={contextMenuBlocks.some(
                (b) => b.parentId && (b.parentType === 'loop' || b.parentType === 'parallel')
              )}
              canRunFromBlock={runFromBlockState.canRun}
              disableEdit={
                !effectivePermissions.canEdit ||
                contextMenuBlocks.some((b) => b.locked || b.isParentLocked)
              }
              userCanEdit={effectivePermissions.canEdit}
              isExecuting={isExecuting}
              isPositionalTrigger={
                contextMenuBlocks.length === 1 &&
                edges.filter((e) => e.target === contextMenuBlocks[0]?.id).length === 0
              }
              onToggleLocked={handleContextToggleLocked}
              canAdmin={effectivePermissions.canAdmin}
            />

            <CanvasMenu
              isOpen={isPaneMenuOpen}
              position={contextMenuPosition}
              menuRef={contextMenuRef}
              onClose={closeContextMenu}
              onUndo={undo}
              onRedo={redo}
              onPaste={handleContextPaste}
              onAddBlock={handleContextAddBlock}
              onAutoLayout={handleAutoLayout}
              onFitToView={() => fitViewToBounds({ padding: 0.1, duration: 300 })}
              onOpenLogs={handleContextOpenLogs}
              onToggleVariables={handleContextToggleVariables}
              onToggleChat={handleContextToggleChat}
              isVariablesOpen={isVariablesOpen}
              isChatOpen={isChatOpen}
              hasClipboard={hasClipboard()}
              disableEdit={!effectivePermissions.canEdit}
              canUndo={canUndo}
              canRedo={canRedo}
              hasLockedBlocks={Object.values(blocks).some((b) => b.locked)}
            />
          </>
        )}

        <Notifications />

        {isWorkflowReady && isWorkflowEmpty && effectivePermissions.canEdit && <CommandList />}

        <Panel />
      </div>

      <DiffControls />

      <Terminal />

      {oauthModal && (
        <Suspense fallback={null}>
          <LazyOAuthRequiredModal
            isOpen={true}
            onClose={() => setOauthModal(null)}
            provider={oauthModal.provider}
            toolName={oauthModal.providerName}
            serviceId={oauthModal.serviceId}
            requiredScopes={oauthModal.requiredScopes}
            newScopes={oauthModal.newScopes}
          />
        </Suspense>
      )}
    </div>
  )
})

WorkflowContent.displayName = 'WorkflowContent'

/** Workflow page with ReactFlowProvider and error boundary wrapper. */
const Workflow = React.memo(() => {
  return (
    <ReactFlowProvider>
      <ErrorBoundary>
        <WorkflowContent />
      </ErrorBoundary>
    </ReactFlowProvider>
  )
})

Workflow.displayName = 'Workflow'

export default Workflow
