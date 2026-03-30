'use client'

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  applyNodeChanges,
  ConnectionLineType,
  type Edge,
  type Node,
  type NodeChange,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { createLogger } from '@sim/logger'
import { useShallow } from 'zustand/react/shallow'
import { useSession } from '@/lib/auth/auth-client'
import type { OAuthConnectEventDetail } from '@/lib/copilot/tools/client/base-tool'
import type { OAuthProvider } from '@/lib/oauth'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  CommandList,
  DiffControls,
  Notifications,
  Panel,
  Terminal,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { BlockMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/block-menu'
import { CanvasMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/canvas-menu'
import { Cursors } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/cursors/cursors'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error/index'
import type { SubflowNodeData } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { WorkflowControls } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-controls/workflow-controls'
import {
  useAutoLayout,
  useCanvasContextMenu,
  useCurrentWorkflow,
  useDynamicHandleRefresh,
  useNodeUtilities,
  useShiftSelectionLock,
  useWorkflowExecution,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useAutoConnectEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-auto-connect-edge'
import { useCanvasKeyboard } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-canvas-keyboard'
import { useLockNotifications } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-lock-notifications'
import { useNodeDerivation } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-node-derivation'
import {
  calculateContainerDimensions,
  calculatePasteOffset,
  clampPositionToContainer,
  clearDragHighlights,
  computeClampedPositionUpdates,
  estimateBlockDimensions,
  filterProtectedBlocks,
  getClampedPositionForNode,
  getDescendantBlockIds,
  getEdgeSelectionContextId,
  getNodeSelectionContextId,
  isEdgeProtected,
  mapEdgesByNode,
  resolveSelectionConflicts,
  validateTriggerPaste,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import {
  CONNECTION_LINE_STYLE_DEFAULT,
  CONNECTION_LINE_STYLE_ERROR,
  DEFAULT_PASTE_OFFSET,
  defaultEdgeOptions,
  edgeTypes,
  embeddedFitViewOptions,
  embeddedResizeFitViewOptions,
  nodeTypes,
  reactFlowFitViewOptions,
  reactFlowProOptions,
  reactFlowStyles,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-constants'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { getBlock } from '@/blocks'
import { useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { useAutoConnect, useSnapToGridSize } from '@/hooks/queries/general-settings'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useOAuthReturnForWorkflow } from '@/hooks/use-oauth-return'
import { useCanvasModeStore } from '@/stores/canvas-mode'
import { useChatStore } from '@/stores/chat/store'
import { defaultWorkflowExecutionState, useExecutionStore } from '@/stores/execution'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useNotificationStore } from '@/stores/notifications'
import { usePanelEditorStore } from '@/stores/panel'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useVariablesStore } from '@/stores/variables/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getUniqueBlockName, prepareBlockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
interface WorkflowContentProps {
  workspaceId?: string
  workflowId?: string
  embedded?: boolean
  /** Sandbox mode: full editing enabled but no workspace API calls (used by Sim Academy). */
  sandbox?: boolean
}

const WorkflowContent = React.memo(
  ({
    workspaceId: propWorkspaceId,
    workflowId: propWorkflowId,
    embedded,
    sandbox,
  }: WorkflowContentProps = {}) => {
    const [isCanvasReady, setIsCanvasReady] = useState(false)
    const [selectedEdges, setSelectedEdges] = useState<SelectedEdgesMap>(new Map())
    const [isErrorConnectionDrag, setIsErrorConnectionDrag] = useState(false)
    const canvasContainerRef = useRef<HTMLDivElement>(null)
    const embeddedFitFrameRef = useRef<number | null>(null)
    const hasCompletedInitialEmbeddedFitRef = useRef(false)
    const canvasMode = useCanvasModeStore((state) => state.mode)
    const isHandMode = embedded ? true : canvasMode === 'hand'
    const { handleCanvasMouseDown, selectionProps } = useShiftSelectionLock({ isHandMode })
    const [oauthModal, setOauthModal] = useState<{
      provider: OAuthProvider
      serviceId: string
      providerName: string
      requiredScopes: string[]
      newScopes?: string[]
    } | null>(null)

    const potentialParentIdRef = useRef<string | null>(null)

    const dragStartParentIdRef = useRef<string | null>(null)

    const params = useParams()
    const router = useRouter()
    const reactFlowInstance = useReactFlow()
    const { screenToFlowPosition, getNodes, setNodes, getIntersectingNodes } = reactFlowInstance
    const { fitViewToBounds, getViewportCenter } = useCanvasViewport(reactFlowInstance, {
      embedded,
    })
    const { emitCursorUpdate } = useSocket()
    useDynamicHandleRefresh()

    const workspaceId = propWorkspaceId || (params.workspaceId as string)
    const workflowIdParam = propWorkflowId || (params.workflowId as string)

    const addNotification = useNotificationStore((state) => state.addNotification)

    useOAuthReturnForWorkflow(workflowIdParam)

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

    const { handleRunFromBlock, handleRunUntilBlock, handleRunWorkflow, handleCancelExecution } =
      useWorkflowExecution()

    const snapToGridSize = useSnapToGridSize()
    const snapToGrid = snapToGridSize > 0

    const isAutoConnectEnabled = useAutoConnect() && !sandbox
    const autoConnectRef = useRef(isAutoConnectEnabled)
    autoConnectRef.current = isAutoConnectEnabled

    // Panel open states for context menu
    const isVariablesOpen = useVariablesStore((state) => state.isOpen)
    const isChatOpen = useChatStore((state) => state.isChatOpen)

    const snapGrid: [number, number] = useMemo(
      () => [snapToGridSize, snapToGridSize],
      [snapToGridSize]
    )

    const { blocks, edges, lastSaved } = currentWorkflow

    const blocksRef = useRef(blocks)
    blocksRef.current = blocks

    const allBlocksLocked = useMemo(() => {
      const blockList = Object.values(blocks)
      return blockList.length > 0 && blockList.every((b) => b.locked)
    }, [blocks])

    const hasBlocks = useMemo(() => Object.keys(blocks).length > 0, [blocks])

    const hasLockedBlocks = useMemo(() => Object.values(blocks).some((b) => b.locked), [blocks])

    const isWorkflowReady = useMemo(
      () =>
        hydration.phase === 'ready' &&
        hydration.workflowId === workflowIdParam &&
        activeWorkflowId === workflowIdParam &&
        Boolean(workflows[workflowIdParam]) &&
        lastSaved !== undefined,
      [
        hydration.phase,
        hydration.workflowId,
        workflowIdParam,
        activeWorkflowId,
        workflows,
        lastSaved,
      ]
    )

    const scheduleEmbeddedFit = useCallback(() => {
      if (!embedded || !isWorkflowReady) return

      if (embeddedFitFrameRef.current !== null) {
        cancelAnimationFrame(embeddedFitFrameRef.current)
      }

      embeddedFitFrameRef.current = requestAnimationFrame(() => {
        embeddedFitFrameRef.current = null

        const container = canvasContainerRef.current
        if (!container) return

        const rect = container.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return

        const nodes = reactFlowInstance.getNodes()
        if (nodes.length > 0) {
          void reactFlowInstance.fitView(embeddedResizeFitViewOptions)
        }

        if (!hasCompletedInitialEmbeddedFitRef.current) {
          hasCompletedInitialEmbeddedFitRef.current = true
          setIsCanvasReady(true)
        }
      })
    }, [embedded, isWorkflowReady, reactFlowInstance])

    const {
      getNodeDepth,
      getNodeAbsolutePosition,
      isDescendantOf,
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
    const canNodeEnterContainer = useCallback((node: Node): boolean => {
      if (node.data?.type === 'starter') return false
      const block = blocksRef.current[node.id]
      return !(block && TriggerUtils.isTriggerBlock(block))
    }, [])

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

    const { handleAutoLayout: autoLayoutWithFitView } = useAutoLayout(activeWorkflowId || null, {
      embedded,
    })

    const isWorkflowEmpty = useMemo(() => Object.keys(blocks).length === 0, [blocks])

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
    const diffBlocksRef = useRef(blocks)

    /** Tracks blocks to pan to after diff updates. */
    const pendingZoomBlockIdsRef = useRef<Set<string> | null>(null)
    const seenDiffBlocksRef = useRef<Set<string>>(new Set())

    useEffect(() => {
      if (!isDiffReady || !diffAnalysis) {
        pendingZoomBlockIdsRef.current = null
        seenDiffBlocksRef.current.clear()
      } else {
        const newBlocks = new Set<string>()
        const allBlocks = [
          ...(diffAnalysis.new_blocks || []),
          ...(diffAnalysis.edited_blocks || []),
        ]

        for (const id of allBlocks) {
          if (!seenDiffBlocksRef.current.has(id)) {
            newBlocks.add(id)
          }
          seenDiffBlocksRef.current.add(id)
        }

        if (newBlocks.size > 0) {
          pendingZoomBlockIdsRef.current = newBlocks
        }
      }

      if (!isWorkflowReady) return
      if (hasActiveDiff && isDiffReady && blocks !== diffBlocksRef.current) {
        diffBlocksRef.current = blocks
        setTimeout(() => reapplyDiffMarkers(), 0)
      }
    }, [blocks, hasActiveDiff, isDiffReady, reapplyDiffMarkers, isWorkflowReady, diffAnalysis])

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

    const edgesForDisplayRef = useRef(edgesForDisplay)
    edgesForDisplayRef.current = edgesForDisplay

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

    const executeBatchParentUpdate = useCallback(
      (nodesToProcess: Node[], targetParentId: string | null, logMessage: string) => {
        const currentBlocks = blocksRef.current
        const currentEdges = edgesForDisplayRef.current

        const nodeIds = new Set(nodesToProcess.map((n) => n.id))

        const nodesNeedingUpdate = nodesToProcess.filter((n) => {
          const block = currentBlocks[n.id]
          if (!block) return false
          const currentParent = block.data?.parentId || null
          if (currentParent && nodeIds.has(currentParent)) return false
          return currentParent !== targetParentId
        })

        if (nodesNeedingUpdate.length === 0) return

        // Filter out nodes that cannot enter containers (when target is a container)
        let validNodes = targetParentId
          ? nodesNeedingUpdate.filter(canNodeEnterContainer)
          : nodesNeedingUpdate

        // Exclude nodes that would create a cycle (moving a container into one of its descendants)
        if (targetParentId) {
          validNodes = validNodes.filter((n) => !isDescendantOf(n.id, targetParentId))
        }

        if (validNodes.length === 0) return

        // Find boundary edges (edges that cross the container boundary)
        const movingNodeIds = new Set(validNodes.map((n) => n.id))
        const boundaryEdges = currentEdges.filter((e) => {
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
        canNodeEnterContainer,
        isDescendantOf,
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

    const { activeBlockIds, pendingBlocks, isDebugging, isExecuting } = useExecutionStore(
      useShallow((state) => {
        const wf = activeWorkflowId ? state.workflowExecutions.get(activeWorkflowId) : undefined
        return {
          activeBlockIds: wf?.activeBlockIds ?? defaultWorkflowExecutionState.activeBlockIds,
          pendingBlocks: wf?.pendingBlocks ?? defaultWorkflowExecutionState.pendingBlocks,
          isDebugging: wf?.isDebugging ?? false,
          isExecuting: wf?.isExecuting ?? false,
        }
      })
    )
    const getLastExecutionSnapshot = useExecutionStore((s) => s.getLastExecutionSnapshot)

    const connectionLineStyle = isErrorConnectionDrag
      ? CONNECTION_LINE_STYLE_ERROR
      : CONNECTION_LINE_STYLE_DEFAULT

    const updateNodeParent = useCallback(
      (nodeId: string, newParentId: string | null, affectedEdges: any[] = []) => {
        const node = getNodes().find((n: any) => n.id === nodeId)
        if (!node) return

        const currentBlocks = blocksRef.current
        const currentBlock = currentBlocks[nodeId]
        if (!currentBlock) return

        const oldParentId = node.parentId || currentBlock.data?.parentId
        const oldPosition = { ...node.position }
        if (!affectedEdges.length && !newParentId && oldParentId) {
          affectedEdges = edgesForDisplayRef.current.filter(
            (e) => e.source === nodeId || e.target === nodeId
          )
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
        getNodeAbsolutePosition,
        updateNodeParentUtil,
        resizeLoopNodesWrapper,
      ]
    )

    /** Applies auto-layout to the workflow canvas. */
    const handleAutoLayout = useCallback(async () => {
      if (Object.keys(blocksRef.current).length === 0) return
      await autoLayoutWithFitView()
    }, [autoLayoutWithFitView])

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
        const currentBlocks = blocksRef.current

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

          // Prevent cycle: pasting a container that is the target container itself or one of its ancestors.
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

          // Adjust each block's position to be relative to the container and set parentId
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

          // Update pasteData.blocks with the modified blocks
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

        // Set pending selection before adding blocks
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
      if (deletableIds.length > 0) {
        collaborativeBatchRemoveBlocks(deletableIds)
      }
    }, [contextMenuBlocks, collaborativeBatchRemoveBlocks, addNotification, activeWorkflowId])

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

    const { handleToggleWorkflowLock } = useLockNotifications({
      allBlocksLocked: allBlocksLocked && !sandbox,
      isWorkflowReady,
      canAdmin: effectivePermissions.canAdmin,
      addNotification,
      activeWorkflowId,
      collaborativeBatchToggleLocked,
    })

    const handleContextRemoveFromSubflow = useCallback(() => {
      const blocksToRemove = contextMenuBlocks.filter(
        (block) =>
          block.parentId && (block.parentType === 'loop' || block.parentType === 'parallel')
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

      const isSourceSatisfied = (sourceId: string) => {
        if (snapshot?.executedBlocks.includes(sourceId)) return true
        const sourceIncomingEdges = edges.filter((edge) => edge.target === sourceId)
        return sourceIncomingEdges.length === 0
      }

      const dependenciesSatisfied =
        isTriggerBlock ||
        (snapshot && incomingEdges.every((edge) => isSourceSatisfied(edge.source)))
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

    useCanvasKeyboard({
      blocksRef,
      debouncedAutoLayout,
      undo,
      redo,
      getNodes,
      copyBlocks,
      hasClipboard,
      canEdit: effectivePermissions.canEdit,
      clipboard,
      getViewportCenter,
      executePasteOperation,
      selectedEdges,
      setSelectedEdges,
      collaborativeBatchRemoveEdges,
      collaborativeBatchRemoveBlocks,
      edges,
      addNotification,
      activeWorkflowId,
    })

    /**
     * Removes all edges connected to a block, skipping individual edge recording for undo/redo.
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

    const { tryCreateAutoConnectEdge } = useAutoConnectEdge({
      blocksRef,
      getNodes,
      getNodeAnchorPosition,
      isPointInLoopNode,
      autoConnectRef,
    })

    /**
     * Checks if adding a block would violate constraints.
     */
    const checkTriggerConstraints = useCallback(
      (blockType: string): boolean => {
        const currentBlocks = blocksRef.current
        const triggerIssue = TriggerUtils.getTriggerAdditionIssue(currentBlocks, blockType)
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

        const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(
          currentBlocks,
          blockType
        )
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

    /**
     * Shared handler for drops of toolbar items onto the workflow canvas.
     */
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

            const autoConnectEdge = tryCreateAutoConnectEdge(position, id, {
              targetParentId: null,
            })

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

      const handleShowTriggerWarning = (event: Event) => {
        const { type, triggerName } = (event as CustomEvent).detail
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

      const handleAddBlockFromToolbar = (event: Event) => {
        if (!effectivePermissions.canEdit) return

        const { type, enableTriggerMode, presetOperation } = (event as CustomEvent).detail

        if (!type) return
        if (type === 'connectionBlock') return

        const currentBlocks = blocksRef.current
        const basePosition = getViewportCenter()

        if (type === 'loop' || type === 'parallel') {
          const id = crypto.randomUUID()
          const baseName = type === 'loop' ? 'Loop' : 'Parallel'
          const name = getUniqueBlockName(baseName, currentBlocks)

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
        const name = getUniqueBlockName(baseName, currentBlocks)

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

      const handleRemoveFromSubflow = (event: Event) => {
        const customEvent = event as CustomEvent<{ blockIds: string[] }>
        const blockIds = customEvent.detail?.blockIds
        if (!blockIds || blockIds.length === 0) return

        try {
          const currentBlocks = blocksRef.current
          const currentEdges = edgesForDisplayRef.current

          const validBlockIds = blockIds.filter((id) => {
            const block = currentBlocks[id]
            return block?.data?.parentId
          })
          if (validBlockIds.length === 0) return

          const validBlockIdSet = new Set(validBlockIds)
          const descendantIds = getDescendantBlockIds(validBlockIds, currentBlocks)
          const movingNodeIds = new Set([...validBlockIds, ...descendantIds])

          const boundaryEdges = currentEdges.filter((e) => {
            const sourceInSelection = movingNodeIds.has(e.source)
            const targetInSelection = movingNodeIds.has(e.target)
            return sourceInSelection !== targetInSelection
          })

          const boundaryEdgesByNode = new Map<string, Edge[]>()
          for (const edge of boundaryEdges) {
            const movedEnd = movingNodeIds.has(edge.source) ? edge.source : edge.target
            let id: string | undefined = movedEnd
            const seen = new Set<string>()
            while (id) {
              if (seen.has(id)) break
              seen.add(id)
              if (validBlockIdSet.has(id)) {
                const list = boundaryEdgesByNode.get(id) ?? []
                list.push(edge)
                boundaryEdgesByNode.set(id, list)
                break
              }
              id = currentBlocks[id]?.data?.parentId
            }
          }

          const absolutePositions = new Map<string, { x: number; y: number }>()
          for (const blockId of validBlockIds) {
            absolutePositions.set(blockId, getNodeAbsolutePosition(blockId))
          }

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

          collaborativeBatchUpdateParent(updates)

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
        } catch (err) {
          logger.error('Failed to remove from subflow', { err })
        }
      }

      window.addEventListener('open-oauth-connect', handleOpenOAuthConnect as EventListener)
      window.addEventListener('show-trigger-warning', handleShowTriggerWarning as EventListener)
      window.addEventListener('add-block-from-toolbar', handleAddBlockFromToolbar as EventListener)
      window.addEventListener(
        'toolbar-drop-on-empty-workflow-overlay',
        handleOverlayToolbarDrop as EventListener
      )
      window.addEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)

      return () => {
        window.removeEventListener('open-oauth-connect', handleOpenOAuthConnect as EventListener)
        window.removeEventListener(
          'show-trigger-warning',
          handleShowTriggerWarning as EventListener
        )
        window.removeEventListener(
          'add-block-from-toolbar',
          handleAddBlockFromToolbar as EventListener
        )
        window.removeEventListener(
          'toolbar-drop-on-empty-workflow-overlay',
          handleOverlayToolbarDrop as EventListener
        )
        window.removeEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
        emitCursorUpdate(null)
      }
    }, [
      addNotification,
      activeWorkflowId,
      getViewportCenter,
      addBlock,
      effectivePermissions.canEdit,
      checkTriggerConstraints,
      tryCreateAutoConnectEdge,
      screenToFlowPosition,
      handleToolbarDrop,
      getNodeAbsolutePosition,
      collaborativeBatchUpdateParent,
      emitCursorUpdate,
    ])

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

    /** Handles drag over events for container node highlighting. */
    const onDragOver = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault()

        if (!event.dataTransfer?.types.includes('application/json')) return

        try {
          const reactFlowBounds = event.currentTarget.getBoundingClientRect()
          const position = screenToFlowPosition({
            x: event.clientX - reactFlowBounds.left,
            y: event.clientY - reactFlowBounds.top,
          })

          const containerInfo = isPointInLoopNode(position)

          if (containerInfo) {
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

    const workflowCount = useMemo(() => Object.keys(workflows).length, [workflows])

    useEffect(() => {
      if (sandbox) return

      if (!embedded) {
        if (hydration.phase === 'metadata-loading' || hydration.phase === 'idle') {
          return
        }

        if (workflowCount === 0) {
          logger.info('No workflows found, redirecting to workspace root')
          router.replace(`/workspace/${workspaceId}/w`)
          return
        }

        if (!currentWorkflowExists) {
          logger.info(
            `Workflow ${workflowIdParam} not found, redirecting to first available workflow`
          )

          const workspaceWorkflows = Object.entries(workflows)
            .filter(([, workflow]) => workflow.workspaceId === workspaceId)
            .map(([id]) => id)

          if (workspaceWorkflows.length > 0) {
            router.replace(`/workspace/${workspaceId}/w/${workspaceWorkflows[0]}`)
          } else {
            router.replace(`/workspace/${workspaceId}/w`)
          }
          return
        }

        const workflowData = workflows[workflowIdParam]
        if (workflowData && workflowData.workspaceId !== workspaceId) {
          logger.warn(
            `Workflow ${workflowIdParam} belongs to workspace ${workflowData.workspaceId}, not ${workspaceId}`
          )
          router.replace(`/workspace/${workflowData.workspaceId}/w/${workflowIdParam}`)
          return
        }
      }
      const currentId = workflowIdParam
      const currentWorkspaceHydration = hydration.workspaceId

      const isRegistryReady = hydration.phase !== 'metadata-loading' && hydration.phase !== 'idle'

      if (
        !currentId ||
        !currentWorkflowExists ||
        !isRegistryReady ||
        (currentWorkspaceHydration && currentWorkspaceHydration !== workspaceId)
      ) {
        return
      }

      if (loadingWorkflowRef.current === currentId) {
        return
      }

      if (hydration.phase === 'state-loading' && hydration.workflowId === currentId) {
        return
      }

      const hasLoadError = hydration.phase === 'error' && hydration.workflowId === currentId

      const needsWorkflowLoad =
        !hasLoadError &&
        (activeWorkflowId !== currentId ||
          (activeWorkflowId === currentId && hydration.phase !== 'ready'))

      if (needsWorkflowLoad) {
        loadingWorkflowRef.current = currentId

        const { clearDiff } = useWorkflowDiffStore.getState()
        clearDiff()

        setIsCanvasReady(false)

        setActiveWorkflow(currentId)
          .catch((error) => {
            logger.error(`Failed to set active workflow ${currentId}:`, error)
          })
          .finally(() => {
            if (loadingWorkflowRef.current === currentId) {
              loadingWorkflowRef.current = null
            }
          })
      }
    }, [
      embedded,
      workflowIdParam,
      currentWorkflowExists,
      workflowCount,
      activeWorkflowId,
      setActiveWorkflow,
      hydration.phase,
      hydration.workflowId,
      hydration.workspaceId,
      workspaceId,
      sandbox,
      router,
      workflows,
    ])

    useWorkspaceEnvironment(sandbox ? '' : workspaceId)

    const {
      displayNodes,
      setDisplayNodes,
      blocksStructureHash,
      derivedNodes,
      nodesForRender,
      nodeMap,
      selectedNodeIds,
      selectedNodeIdsKey,
      elevatedNodeIdSet,
      lastInteractedNodeId,
    } = useNodeDerivation({
      blocks,
      embedded,
      pendingSelection,
      clearPendingSelection,
      sandbox,
    })

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

    /**
     * Updates container dimensions in displayNodes during drag or keyboard movement.
     */
    const updateContainerDimensionsDuringMove = useCallback(
      (movedNodeId: string, movedNodePosition: { x: number; y: number }) => {
        const currentBlocks = blocksRef.current
        const ancestorIds: string[] = []
        const visited = new Set<string>()
        let currentId = currentBlocks[movedNodeId]?.data?.parentId
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId)
          ancestorIds.push(currentId)
          currentId = currentBlocks[currentId]?.data?.parentId
        }
        if (ancestorIds.length === 0) return

        setDisplayNodes((currentNodes) => {
          const computedDimensions = new Map<string, { width: number; height: number }>()

          for (const containerId of ancestorIds) {
            const childNodes = currentNodes.filter((n) => n.parentId === containerId)
            if (childNodes.length === 0) continue

            const childPositions = childNodes.map((node) => {
              const nodePosition = node.id === movedNodeId ? movedNodePosition : node.position
              const dims = computedDimensions.get(node.id)
              const width = dims?.width ?? node.data?.width ?? getBlockDimensions(node.id).width
              const height = dims?.height ?? node.data?.height ?? getBlockDimensions(node.id).height
              return { x: nodePosition.x, y: nodePosition.y, width, height }
            })

            computedDimensions.set(containerId, calculateContainerDimensions(childPositions))
          }

          return currentNodes.map((node) => {
            const newDims = computedDimensions.get(node.id)
            if (!newDims) return node
            const currentWidth = node.data?.width ?? CONTAINER_DIMENSIONS.DEFAULT_WIDTH
            const currentHeight = node.data?.height ?? CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
            if (newDims.width === currentWidth && newDims.height === currentHeight) {
              return node
            }
            return {
              ...node,
              data: {
                ...node.data,
                width: newDims.width,
                height: newDims.height,
              },
            }
          })
        })
      },
      [getBlockDimensions]
    )

    /** Handles node changes - applies changes and resolves parent-child selection conflicts. */
    const onNodesChange = useCallback(
      (changes: NodeChange[]) => {
        const hasSelectionChange = changes.some((c) => c.type === 'select')
        setDisplayNodes((currentNodes) => {
          const updated = applyNodeChanges(changes, currentNodes)
          if (!hasSelectionChange) return updated

          const preferredNodeId = [...changes]
            .reverse()
            .find(
              (change): change is NodeChange & { id: string; selected: boolean } =>
                change.type === 'select' && 'selected' in change && change.selected === true
            )?.id

          return resolveSelectionConflicts(updated, blocksRef.current, preferredNodeId)
        })

        const isInDragOperation =
          getDragStartPosition() !== null || multiNodeDragStartRef.current.size > 0
        const keyboardPositionUpdates: Array<{ id: string; position: { x: number; y: number } }> =
          []
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
        if (keyboardPositionUpdates.length > 0) {
          collaborativeBatchUpdatePositions(keyboardPositionUpdates)
        }
      },
      [updateContainerDimensionsDuringMove, collaborativeBatchUpdatePositions, getDragStartPosition]
    )

    // ═══════════════════════════════════════════════════════════════════════════
    // EFFECT 5/7: Resize loops when nodes change (kept as-is)
    // ═══════════════════════════════════════════════════════════════════════════
    useEffect(() => {
      if (derivedNodes.length === 0 || !isWorkflowReady) return
      resizeLoopNodesWrapper()
    }, [derivedNodes, resizeLoopNodesWrapper, isWorkflowReady])

    // ═══════════════════════════════════════════════════════════════════════════
    // EFFECT 6/7: Orphaned node cleanup (kept as-is)
    // ═══════════════════════════════════════════════════════════════════════════
    useEffect(() => {
      if (!isWorkflowReady) return

      const nodeIds = new Set(Object.keys(blocks))

      const orphanedUpdates: Array<{
        id: string
        position: { x: number; y: number }
        parentId: string
      }> = []
      Object.entries(blocks).forEach(([id, block]) => {
        const parentId = block.data?.parentId

        if (parentId && !nodeIds.has(parentId)) {
          logger.warn('Found orphaned node with invalid parent reference', {
            nodeId: id,
            missingParentId: parentId,
          })

          const absolutePosition = getNodeAbsolutePosition(id)
          orphanedUpdates.push({ id, position: absolutePosition, parentId: '' })
        }
      })

      if (orphanedUpdates.length > 0) {
        batchUpdateBlocksWithParent(orphanedUpdates)
      }
    }, [blocks, batchUpdateBlocksWithParent, getNodeAbsolutePosition, isWorkflowReady])

    /** Handles edge removal changes. */
    const onEdgesChange = useCallback(
      (changes: any) => {
        const currentBlocks = blocksRef.current
        const edgeIdsToRemove = changes
          .filter((change: any) => change.type === 'remove')
          .map((change: any) => change.id)
          .filter((edgeId: string) => {
            const edge = edges.find((e) => e.id === edgeId)
            if (!edge) return true
            return !isEdgeProtected(edge, currentBlocks)
          })

        if (edgeIdsToRemove.length > 0) {
          collaborativeBatchRemoveEdges(edgeIdsToRemove)
        }
      },
      [collaborativeBatchRemoveEdges, edges]
    )

    /**
     * Finds the best node at a given flow position for drop-on-block connection.
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
          const allNodes = getNodes()
          const sourceNode = allNodes.find((n) => n.id === connection.source)
          const targetNode = allNodes.find((n) => n.id === connection.target)

          if (!sourceNode || !targetNode) return

          const currentBlocks = blocksRef.current

          if (isEdgeProtected(connection, currentBlocks)) {
            addNotification({
              level: 'info',
              message: 'Cannot connect to locked blocks or blocks inside locked containers',
              workflowId: activeWorkflowId || undefined,
            })
            return
          }

          const sourceParentId =
            currentBlocks[sourceNode.id]?.data?.parentId ||
            (connection.sourceHandle === 'loop-start-source' ||
            connection.sourceHandle === 'parallel-start-source'
              ? connection.source
              : undefined)
          const targetParentId = currentBlocks[targetNode.id]?.data?.parentId

          const edgeId = crypto.randomUUID()

          // Special case for container start source
          if (
            (connection.sourceHandle === 'loop-start-source' ||
              connection.sourceHandle === 'parallel-start-source') &&
            currentBlocks[targetNode.id]?.data?.parentId === sourceNode.id
          ) {
            addEdge({
              ...connection,
              id: edgeId,
              type: 'workflowEdge',
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

          const isInsideContainer = Boolean(sourceParentId) || Boolean(targetParentId)
          const parentId = sourceParentId || targetParentId

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
      [addEdge, getNodes, addNotification, activeWorkflowId]
    )

    /**
     * Handles connection drag end.
     */
    const onConnectEnd = useCallback(
      (event: MouseEvent | TouchEvent) => {
        setIsErrorConnectionDrag(false)

        const source = connectionSourceRef.current
        if (!source?.nodeId) {
          connectionSourceRef.current = null
          return
        }

        if (connectionCompletedRef.current) {
          connectionSourceRef.current = null
          return
        }

        const clientPos = 'changedTouches' in event ? event.changedTouches[0] : event
        const flowPosition = screenToFlowPosition({
          x: clientPos.clientX,
          y: clientPos.clientY,
        })

        const targetNode = findNodeAtPosition(flowPosition)

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

    const onNodeDrag = useCallback(
      (_event: React.MouseEvent, node: any) => {
        const currentBlocks = blocksRef.current
        const currentParentId = currentBlocks[node.id]?.data?.parentId || null

        if (currentParentId) {
          updateContainerDimensionsDuringMove(node.id, node.position)
        }

        const isStarterBlock = node.data?.type === 'starter'
        if (isStarterBlock) {
          if (potentialParentIdRef.current) {
            clearDragHighlights()
            potentialParentIdRef.current = null
          }
          return
        }

        const nodeAbsolutePos = getNodeAbsolutePosition(node.id)

        const intersectingNodes = getNodes()
          .filter((n) => {
            if (n.type !== 'subflowNode' || n.id === node.id) return false
            if (currentBlocks[n.id]?.locked) return false

            const containerAbsolutePos = getNodeAbsolutePosition(n.id)

            const nodeWidth =
              node.type === 'subflowNode'
                ? node.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH
                : BLOCK_DIMENSIONS.FIXED_WIDTH

            const nodeHeight =
              node.type === 'subflowNode'
                ? node.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
                : Math.max(node.height || BLOCK_DIMENSIONS.MIN_HEIGHT, BLOCK_DIMENSIONS.MIN_HEIGHT)

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

            return (
              nodeRect.left < containerRect.right &&
              nodeRect.right > containerRect.left &&
              nodeRect.top < containerRect.bottom &&
              nodeRect.bottom > containerRect.top
            )
          })
          .map((n) => ({
            container: n,
            depth: getNodeDepth(n.id),
            size:
              (n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH) *
              (n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
          }))

        if (intersectingNodes.length > 0) {
          const sortedContainers = intersectingNodes.sort((a, b) => {
            if (a.depth !== b.depth) {
              return b.depth - a.depth
            }
            return a.size - b.size
          })

          const validContainers = sortedContainers.filter(
            ({ container }) => !isDescendantOf(node.id, container.id)
          )

          const bestContainerMatch = validContainers[0]

          if (bestContainerMatch) {
            potentialParentIdRef.current = bestContainerMatch.container.id

            const kind = (bestContainerMatch.container.data as SubflowNodeData)?.kind
            if (kind === 'loop' || kind === 'parallel') {
              highlightContainerNode(bestContainerMatch.container.id, kind)
            }
          } else {
            clearDragHighlights()
            potentialParentIdRef.current = null
          }
        } else {
          if (potentialParentIdRef.current) {
            clearDragHighlights()
            potentialParentIdRef.current = null
          }
        }
      },
      [
        getNodes,
        getNodeAbsolutePosition,
        getNodeDepth,
        isDescendantOf,
        updateContainerDimensionsDuringMove,
        highlightContainerNode,
      ]
    )

    const onNodeDragStart = useCallback(
      (_event: React.MouseEvent, node: any) => {
        const currentBlocks = blocksRef.current
        const currentParentId = currentBlocks[node.id]?.data?.parentId || null
        dragStartParentIdRef.current = currentParentId
        potentialParentIdRef.current = currentParentId
        setDragStartPosition({
          id: node.id,
          x: node.position.x,
          y: node.position.y,
          parentId: currentParentId,
        })

        const allNodes = getNodes()
        const selectedNodes = allNodes.filter((n) => n.selected)
        multiNodeDragStartRef.current.clear()
        selectedNodes.forEach((n) => {
          const block = currentBlocks[n.id]
          if (block) {
            multiNodeDragStartRef.current.set(n.id, {
              x: n.position.x,
              y: n.position.y,
              parentId: block.data?.parentId,
            })
          }
        })
        if (!multiNodeDragStartRef.current.has(node.id)) {
          multiNodeDragStartRef.current.set(node.id, {
            x: node.position.x,
            y: node.position.y,
            parentId: currentParentId ?? undefined,
          })
        }

        const draggedNodeInSelected = allNodes.find((n) => n.id === node.id)
        if (draggedNodeInSelected && !draggedNodeInSelected.selected && selectedNodes.length > 0) {
          const draggedParentId = currentBlocks[node.id]?.data?.parentId
          const parentIsSelected =
            draggedParentId && selectedNodes.some((n) => n.id === draggedParentId)
          const contextMismatch =
            getNodeSelectionContextId(draggedNodeInSelected, currentBlocks) !==
            getNodeSelectionContextId(selectedNodes[0], currentBlocks)
          if (!parentIsSelected && !contextMismatch) {
            setDisplayNodes((currentNodes) =>
              currentNodes.map((n) => (n.id === node.id ? { ...n, selected: true } : n))
            )
          }
        }
      },
      [setDragStartPosition, getNodes]
    )

    const onNodeDragStop = useCallback(
      (_event: React.MouseEvent, node: any) => {
        clearDragHighlights()

        const currentBlocks = blocksRef.current
        const potentialParentId = potentialParentIdRef.current
        const dragStartParentId = dragStartParentIdRef.current

        const allNodes = getNodes()
        const selectedNodes = allNodes.filter((n) => n.selected)

        if (selectedNodes.length > 1) {
          const positionUpdates = computeClampedPositionUpdates(
            selectedNodes,
            currentBlocks,
            allNodes
          )
          collaborativeBatchUpdatePositions(positionUpdates, {
            previousPositions: multiNodeDragStartRef.current,
          })

          executeBatchParentUpdate(
            selectedNodes,
            potentialParentId,
            'Batch moved nodes to new parent'
          )

          setDragStartPosition(null)
          potentialParentIdRef.current = null
          multiNodeDragStartRef.current.clear()
          return
        }

        const finalPosition = getClampedPositionForNode(
          node.id,
          node.position,
          currentBlocks,
          allNodes
        )

        updateBlockPosition(node.id, finalPosition)

        const start = getDragStartPosition()
        if (start && start.id === node.id) {
          const before = { x: start.x, y: start.y, parentId: start.parentId }
          const after = {
            x: finalPosition.x,
            y: finalPosition.y,
            parentId: node.parentId || currentBlocks[node.id]?.data?.parentId,
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

        if (potentialParentId === dragStartParentId) return

        if (
          dragStartParentId &&
          currentBlocks[dragStartParentId]?.locked &&
          currentBlocks[node.id]?.locked
        ) {
          addNotification({
            level: 'info',
            message: 'Cannot move locked blocks out of locked containers',
            workflowId: activeWorkflowId || undefined,
          })
          potentialParentIdRef.current = dragStartParentId
          return
        }

        const isStarterBlock = node.data?.type === 'starter'
        if (isStarterBlock) {
          logger.warn('Prevented starter block from being placed inside a container', {
            blockId: node.id,
            attemptedParentId: potentialParentId,
          })
          potentialParentIdRef.current = null
          return
        }

        if (potentialParentId) {
          const block = currentBlocks[node.id]
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
            potentialParentIdRef.current = null
            return
          }
        }

        if (potentialParentId && isDescendantOf(node.id, potentialParentId)) {
          addNotification({
            level: 'info',
            message: 'Cannot place a container inside one of its own nested containers',
            workflowId: activeWorkflowId || undefined,
          })
          potentialParentIdRef.current = null
          return
        }

        const currentEdges = edgesForDisplayRef.current

        if (potentialParentId) {
          const edgesToRemove = currentEdges.filter(
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

          const containerAbsPosBefore = getNodeAbsolutePosition(potentialParentId)
          const nodeAbsPosBefore = getNodeAbsolutePosition(node.id)
          const headerHeight = 50
          const leftPadding = 16
          const topPadding = 16

          const relativePositionBefore = {
            x: nodeAbsPosBefore.x - containerAbsPosBefore.x - leftPadding,
            y: nodeAbsPosBefore.y - containerAbsPosBefore.y - headerHeight - topPadding,
          }

          const existingChildBlocks = Object.values(currentBlocks)
            .filter((b) => b.data?.parentId === potentialParentId && b.id !== node.id)
            .map((b) => ({ id: b.id, type: b.type, position: b.position }))

          const autoConnectEdge = tryCreateAutoConnectEdge(relativePositionBefore, node.id, {
            targetParentId: potentialParentId,
            existingChildBlocks,
            containerId: potentialParentId,
          })

          const edgesToAdd: Edge[] = autoConnectEdge ? [autoConnectEdge] : []

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

          if (edgesToAdd.length > 0) {
            collaborativeBatchAddEdges(edgesToAdd, { skipUndoRedo: true })
          }
        } else if (!potentialParentId && dragStartParentId) {
          const absolutePosition = getNodeAbsolutePosition(node.id)

          const edgesToRemove = currentEdges.filter(
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

          updateNodeParent(node.id, null, edgesToRemove)

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

        potentialParentIdRef.current = null
      },
      [
        getNodes,
        isDescendantOf,
        updateNodeParent,
        updateBlockPosition,
        collaborativeBatchAddEdges,
        tryCreateAutoConnectEdge,
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

    /** Captures initial positions when selection drag starts. */
    const onSelectionDragStart = useCallback((_event: React.MouseEvent, nodes: Node[]) => {
      const currentBlocks = blocksRef.current
      if (nodes.length > 0) {
        const firstNodeParentId = currentBlocks[nodes[0].id]?.data?.parentId || null
        dragStartParentIdRef.current = firstNodeParentId
      }

      const nodeIds = new Set(nodes.map((n) => n.id))
      const effectiveNodes = nodes.filter((n) => {
        const parentId = currentBlocks[n.id]?.data?.parentId
        return !parentId || !nodeIds.has(parentId)
      })

      multiNodeDragStartRef.current.clear()
      effectiveNodes.forEach((n) => {
        const blk = currentBlocks[n.id]
        if (blk) {
          multiNodeDragStartRef.current.set(n.id, {
            x: n.position.x,
            y: n.position.y,
            parentId: blk.data?.parentId,
          })
        }
      })

      setDisplayNodes((allNodes) => resolveSelectionConflicts(allNodes, currentBlocks))
    }, [])

    /** Handles selection drag to detect potential parent containers. */
    const onSelectionDrag = useCallback(
      (_event: React.MouseEvent, nodes: Node[]) => {
        if (nodes.length === 0) return

        const eligibleNodes = nodes.filter(canNodeEnterContainer)

        if (eligibleNodes.length === 0) {
          if (potentialParentIdRef.current) {
            clearDragHighlights()
            potentialParentIdRef.current = null
          }
          return
        }

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

        const selectionRect = { left: minX, right: maxX, top: minY, bottom: maxY }

        const allNodes = getNodes()
        const intersectingContainers = allNodes
          .filter((containerNode) => {
            if (containerNode.type !== 'subflowNode') return false
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
          const sortedContainers = intersectingContainers.sort((a, b) => {
            if (a.depth !== b.depth) return b.depth - a.depth
            return a.size - b.size
          })

          const bestMatch = sortedContainers[0]

          if (bestMatch.container.id !== potentialParentIdRef.current) {
            potentialParentIdRef.current = bestMatch.container.id

            const kind = (bestMatch.container.data as SubflowNodeData)?.kind
            if (kind === 'loop' || kind === 'parallel') {
              highlightContainerNode(bestMatch.container.id, kind)
            }
          }
        } else if (potentialParentIdRef.current) {
          clearDragHighlights()
          potentialParentIdRef.current = null
        }
      },
      [
        canNodeEnterContainer,
        getNodes,
        getNodeAbsolutePosition,
        getNodeDepth,
        highlightContainerNode,
      ]
    )

    const onSelectionDragStop = useCallback(
      (_event: React.MouseEvent, nodes: any[]) => {
        clearDragHighlights()
        if (nodes.length === 0) return

        const currentBlocks = blocksRef.current
        const potentialParentId = potentialParentIdRef.current

        const allNodes = getNodes()
        const positionUpdates = computeClampedPositionUpdates(nodes, currentBlocks, allNodes)
        collaborativeBatchUpdatePositions(positionUpdates, {
          previousPositions: multiNodeDragStartRef.current,
        })

        executeBatchParentUpdate(nodes, potentialParentId, 'Batch moved selection to new parent')

        setDragStartPosition(null)
        potentialParentIdRef.current = null
        multiNodeDragStartRef.current.clear()
      },
      [getNodes, collaborativeBatchUpdatePositions, executeBatchParentUpdate]
    )

    const onPaneClick = useCallback(() => {
      setSelectedEdges(new Map())
      usePanelEditorStore.getState().clearCurrentBlock()
    }, [])

    const handleNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
      const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey
      setDisplayNodes((currentNodes) => {
        const updated = currentNodes.map((currentNode) => ({
          ...currentNode,
          selected: isMultiSelect
            ? currentNode.id === node.id
              ? true
              : currentNode.selected
            : currentNode.id === node.id,
        }))
        return resolveSelectionConflicts(
          updated,
          blocksRef.current,
          isMultiSelect ? node.id : undefined
        )
      })
    }, [])

    /** Handles edge selection with container context tracking and Shift-click multi-selection. */
    const onEdgeClick = useCallback(
      (event: React.MouseEvent, edge: any) => {
        event.stopPropagation()

        const currentBlocks = blocksRef.current
        const contextId = `${edge.id}${(() => {
          const selectionContextId = getEdgeSelectionContextId(edge, getNodes(), currentBlocks)
          return selectionContextId ? `-${selectionContextId}` : ''
        })()}`

        if (event.shiftKey) {
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
          setSelectedEdges(new Map([[contextId, edge.id]]))
        }
      },
      [getNodes]
    )

    /** Stable delete handler to avoid creating new function references per edge. */
    const handleEdgeDelete = useCallback(
      (edgeId: string) => {
        const currentBlocks = blocksRef.current
        const edge = edges.find((e) => e.id === edgeId)
        if (edge && isEdgeProtected(edge, currentBlocks)) {
          addNotification({
            level: 'info',
            message: 'Cannot remove connections to locked blocks',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }
        removeEdge(edgeId)
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
      [removeEdge, edges, addNotification, activeWorkflowId]
    )

    /** Transforms edges to include selection state and delete handlers. */
    const edgesWithSelection = useMemo(() => {
      return edgesForDisplay.map((edge) => {
        const sourceNode = nodeMap.get(edge.source)
        const targetNode = nodeMap.get(edge.target)
        const parentLoopId = sourceNode?.parentId || targetNode?.parentId
        const edgeContextId = `${edge.id}${parentLoopId ? `-${parentLoopId}` : ''}`
        const connectedToElevated =
          elevatedNodeIdSet.has(edge.source) || elevatedNodeIdSet.has(edge.target)
        const elevatedZIndex = Math.max(
          22,
          (sourceNode?.zIndex ?? 21) + 1,
          (targetNode?.zIndex ?? 21) + 1
        )

        return {
          ...edge,
          zIndex: connectedToElevated ? elevatedZIndex : 0,
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
    }, [edgesForDisplay, nodeMap, elevatedNodeIdSet, selectedEdges, handleEdgeDelete])

    useEffect(() => {
      if (!embedded || !isWorkflowReady) {
        return
      }

      const container = canvasContainerRef.current
      if (!container) {
        return
      }

      scheduleEmbeddedFit()

      const resizeObserver = new ResizeObserver(() => {
        scheduleEmbeddedFit()
      })

      resizeObserver.observe(container)

      return () => {
        resizeObserver.disconnect()

        if (embeddedFitFrameRef.current !== null) {
          cancelAnimationFrame(embeddedFitFrameRef.current)
          embeddedFitFrameRef.current = null
        }
      }
    }, [embedded, isWorkflowReady, scheduleEmbeddedFit, blocksStructureHash])

    return (
      <div className='flex h-full w-full overflow-hidden'>
        <div className='flex min-w-0 flex-1 flex-col'>
          <div
            ref={canvasContainerRef}
            className='relative flex-1 overflow-hidden'
            data-tour='canvas'
          >
            {!isWorkflowReady && (
              <div className='absolute inset-0 z-[5] flex items-center justify-center bg-[var(--bg)]'>
                <div
                  className='h-[18px] w-[18px] animate-spin rounded-full'
                  style={{
                    background:
                      'conic-gradient(from 0deg, hsl(var(--muted-foreground)) 0deg 120deg, transparent 120deg 180deg, hsl(var(--muted-foreground)) 180deg 300deg, transparent 300deg 360deg)',
                    mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
                    WebkitMask:
                      'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
                  }}
                />
              </div>
            )}

            {isWorkflowReady && (
              <>
                <ReactFlow
                  nodes={nodesForRender}
                  edges={edgesWithSelection}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={!embedded && effectivePermissions.canEdit ? onConnect : undefined}
                  onConnectStart={
                    !embedded && effectivePermissions.canEdit ? onConnectStart : undefined
                  }
                  onConnectEnd={
                    !embedded && effectivePermissions.canEdit ? onConnectEnd : undefined
                  }
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onMouseDown={handleCanvasMouseDown}
                  onDrop={effectivePermissions.canEdit ? onDrop : undefined}
                  onDragOver={effectivePermissions.canEdit ? onDragOver : undefined}
                  onInit={(instance) => {
                    if (embedded) {
                      return
                    }

                    requestAnimationFrame(() => {
                      instance.fitView(reactFlowFitViewOptions)
                      setIsCanvasReady(true)
                    })
                  }}
                  fitViewOptions={embedded ? embeddedFitViewOptions : reactFlowFitViewOptions}
                  minZoom={0.1}
                  maxZoom={1.3}
                  panOnScroll
                  defaultEdgeOptions={defaultEdgeOptions}
                  proOptions={reactFlowProOptions}
                  connectionLineStyle={connectionLineStyle}
                  connectionLineType={ConnectionLineType.SmoothStep}
                  onPaneClick={onPaneClick}
                  onEdgeClick={embedded ? undefined : onEdgeClick}
                  onNodeClick={handleNodeClick}
                  onPaneContextMenu={handlePaneContextMenu}
                  onNodeContextMenu={handleNodeContextMenu}
                  onSelectionContextMenu={handleSelectionContextMenu}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerLeave={handleCanvasPointerLeave}
                  elementsSelectable={!embedded}
                  selectionOnDrag={embedded ? false : selectionProps.selectionOnDrag}
                  selectionMode={SelectionMode.Partial}
                  panOnDrag={embedded ? true : selectionProps.panOnDrag}
                  selectionKeyCode={embedded ? null : selectionProps.selectionKeyCode}
                  multiSelectionKeyCode={embedded ? null : ['Meta', 'Control', 'Shift']}
                  nodesConnectable={!embedded && effectivePermissions.canEdit}
                  nodesDraggable={!embedded && effectivePermissions.canEdit}
                  draggable={false}
                  noWheelClassName='allow-scroll'
                  edgesFocusable={!embedded}
                  edgesUpdatable={!embedded && effectivePermissions.canEdit}
                  className={`workflow-container h-full bg-[var(--bg)] transition-opacity duration-150 ${reactFlowStyles} ${isCanvasReady ? 'opacity-100' : 'opacity-0'} ${isHandMode ? 'canvas-mode-hand' : 'canvas-mode-cursor'}`}
                  onNodeDrag={effectivePermissions.canEdit ? onNodeDrag : undefined}
                  onNodeDragStop={effectivePermissions.canEdit ? onNodeDragStop : undefined}
                  onSelectionDragStart={
                    effectivePermissions.canEdit ? onSelectionDragStart : undefined
                  }
                  onSelectionDrag={effectivePermissions.canEdit ? onSelectionDrag : undefined}
                  onSelectionDragStop={
                    effectivePermissions.canEdit ? onSelectionDragStop : undefined
                  }
                  onNodeDragStart={effectivePermissions.canEdit ? onNodeDragStart : undefined}
                  snapToGrid={snapToGrid}
                  snapGrid={snapGrid}
                  elevateEdgesOnSelect={false}
                  onlyRenderVisibleElements={false}
                  deleteKeyCode={null}
                  elevateNodesOnSelect={false}
                  autoPanOnConnect={effectivePermissions.canEdit}
                  autoPanOnNodeDrag={effectivePermissions.canEdit}
                />

                <Cursors />

                {!embedded && (
                  <>
                    <WorkflowControls />
                    <Suspense fallback={null}>
                      <LazyChat />
                    </Suspense>

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
                        (b) =>
                          b.parentId && (b.parentType === 'loop' || b.parentType === 'parallel')
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
                      hasLockedBlocks={hasLockedBlocks}
                      onToggleWorkflowLock={handleToggleWorkflowLock}
                      allBlocksLocked={allBlocksLocked}
                      canAdmin={effectivePermissions.canAdmin}
                      hasBlocks={hasBlocks}
                    />
                  </>
                )}
              </>
            )}

            <Notifications embedded={embedded} />

            {!embedded && isWorkflowReady && isWorkflowEmpty && effectivePermissions.canEdit && (
              <CommandList />
            )}

            {!embedded && <DiffControls />}
          </div>

          <Terminal />
        </div>

        {(!embedded || sandbox) && <Panel workspaceId={sandbox ? workspaceId : undefined} />}

        {!embedded && !sandbox && oauthModal && (
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
  }
)

WorkflowContent.displayName = 'WorkflowContent'

interface WorkflowProps {
  workspaceId?: string
  workflowId?: string
  embedded?: boolean
  /** Sandbox mode: full editing enabled but no workspace API calls (used by Sim Academy). */
  sandbox?: boolean
}

/** Workflow page with ReactFlowProvider and error boundary wrapper. */
const Workflow = React.memo(
  ({ workspaceId, workflowId, embedded, sandbox }: WorkflowProps = {}) => {
    return (
      <ReactFlowProvider>
        <ErrorBoundary>
          <WorkflowContent
            workspaceId={workspaceId}
            workflowId={workflowId}
            embedded={embedded}
            sandbox={sandbox}
          />
        </ErrorBoundary>
      </ReactFlowProvider>
    )
  }
)

Workflow.displayName = 'Workflow'

export default Workflow
