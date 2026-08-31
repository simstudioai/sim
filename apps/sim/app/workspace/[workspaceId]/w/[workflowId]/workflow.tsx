'use client'

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  applyNodeChanges,
  ConnectionLineType,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnectStart,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import type { SubflowNodeData } from '@sim/workflow-renderer'
import {
  BLOCK_DIMENSIONS,
  BLOCK_Z_BASE,
  CONNECTION_PICKER_Z,
  CONTAINER_CHILD_Z_BASE,
  CONTAINER_DIMENSIONS,
  EDGE_Z_MAX,
  getBlockZIndex,
  getEdgeZIndex,
  getEdgeZIndexForTarget,
  getNoteBlockHeight,
  normalizeCursorSourceHandleId,
} from '@sim/workflow-renderer'
import {
  normalizeWorkflowEdgeSourceHandle,
  normalizeWorkflowEdgeTargetHandle,
  WORKFLOW_TARGET_HANDLE_ID,
} from '@sim/workflow-types/workflow'
import { useShallow } from 'zustand/react/shallow'
import { useSession } from '@/lib/auth/auth-client'
import type { OAuthConnectEventDetail } from '@/lib/copilot/tools/client/base-tool'
import { consumeOAuthReturnContext, writeOAuthReturnContext } from '@/lib/credentials/client-state'
import type { OAuthProvider } from '@/lib/oauth'
import { OPERATION_SUBBLOCK_ID } from '@/lib/permission-groups/operation-access'
import {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { getDefaultBlockName } from '@/lib/workflows/blocks/canvas-presentation'
import { requestNoteImage, requestNoteRename } from '@/lib/workflows/notes/canvas-requests'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  CommandList,
  DiffControls,
  Panel,
  Terminal,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { BlockMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/block-menu'
import { CanvasMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/canvas-menu'
import {
  CONNECTION_BLOCK_SELECTOR_DIMENSIONS,
  CONNECTION_BLOCK_SELECTOR_NODE_ID,
  type ConnectionBlockSelectorData,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/connection-block-selector/connection-block-selector'
import { Cursors } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/cursors/cursors'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error/index'
import { FocusBlockDeepLink } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/focus-block-deep-link'
import { WorkflowSearchReplace } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/search-replace/workflow-search-replace'
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
import {
  applyEdgeSelectionChanges,
  calculateContainerDimensions,
  clampPositionToContainer,
  clearDragHighlights,
  computeClampedPositionUpdates,
  estimateBlockDimensions,
  filterProtectedBlocks,
  getArrowNavigationDirection,
  getClampedPositionForNode,
  getDescendantBlockIds,
  getEdgeSelectionMapKey,
  getNodeSelectionContextId,
  getRunFromBlockDependencyState,
  getWorkflowLockToggleIds,
  isBlockProtected,
  isEdgeProtected,
  isInEditableElement,
  isPositionalTriggerBlock,
  reconcileCanvasEdges,
  reconcileCanvasNodes,
  resolveSelectionConflicts,
  SUBFLOW_DROP_TARGET_CLASS,
  shouldHighlightContainerDropTarget,
  validateTriggerPaste,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import {
  isEdgeConnectedToEditor,
  isEdgeHighlighted,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/edge-highlight'
import {
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
import { isAnnotationOnlyBlock } from '@/executor/constants'
import { useCustomBlocks } from '@/hooks/queries/custom-blocks'
import { useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { useFolderMap } from '@/hooks/queries/folders'
import {
  useAutoConnect,
  useAutoFocusOnClick,
  useSnapToGridSize,
} from '@/hooks/queries/general-settings'
import {
  findLockedAncestorFolder,
  isFolderOrAncestorLocked,
} from '@/hooks/queries/utils/folder-tree'
import { useUpdateWorkflow, useWorkflowMap } from '@/hooks/queries/workflows'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useOAuthReturnForWorkflow } from '@/hooks/use-oauth-return'
import { useOperationAccess } from '@/hooks/use-operation-access'
import { useCanvasModeStore } from '@/stores/canvas-mode'
import { useChatStore } from '@/stores/chat/store'
import {
  defaultWorkflowExecutionState,
  useExecutionStore,
  useLastExecutionSnapshot,
} from '@/stores/execution'
import { useSearchModalStore } from '@/stores/modals/search/store'
import type { PendingConnect } from '@/stores/modals/search/types'
import { usePanelEditorSearchStore, usePanelEditorStore, usePanelStore } from '@/stores/panel'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useVariablesModalStore } from '@/stores/variables/modal'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowSearchReplaceStore } from '@/stores/workflow-search-replace/store'
import { prepareBlockState } from '@/stores/workflows/prepare-block-state'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getUniqueBlockName } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** Lazy-loaded components for non-critical UI that can load after initial render */
const LazyChat = lazy(() =>
  import('@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/chat').then((mod) => ({
    default: mod.Chat,
  }))
)

const logger = createLogger('Workflow')

const DEFAULT_PASTE_OFFSET = { x: 50, y: 50 }
const CONNECTION_BLOCK_SELECTOR_FOCUS_DURATION_MS = 300
const SUBFLOW_FOCUS_STABLE_FRAMES = 2
const SUBFLOW_FOCUS_MIN_WAIT_FRAMES = 4
const SUBFLOW_FOCUS_MAX_WAIT_FRAMES = 18
const SUBFLOW_FOCUS_LAYOUT_TOLERANCE_PX = 0.5
const SUBFLOW_FOCUS_PADDING = 0.08
const CONNECTION_LINE_STYLE = {
  stroke: 'var(--connection-line-stroke)',
  strokeWidth: 2,
}

/**
 * The in-flight drag line is an edge, so it belongs at the top of the edge band
 * rather than at React Flow's stylesheet default of 1001 — which sits above
 * every card and even above a selected container child.
 */
const CONNECTION_LINE_CONTAINER_STYLE = { zIndex: EDGE_Z_MAX }

const getRegularBlockWidth = (type: string) =>
  type === 'note' || type === 'noteBlock'
    ? BLOCK_DIMENSIONS.NOTE_WIDTH
    : BLOCK_DIMENSIONS.FIXED_WIDTH

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
          : getRegularBlockWidth(b.type)
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
 * Shows the last selected block in the panel. Clears when nothing is selected.
 */
function syncPanelWithSelection(selectedIds: string[]) {
  const { currentBlockId, clearCurrentBlock, setCurrentBlockId } = usePanelEditorStore.getState()
  const blocks = useWorkflowStore.getState().blocks
  const editorSelectedIds = selectedIds.filter((id) => blocks[id]?.type !== 'note')

  if (editorSelectedIds.length === 0) {
    if (currentBlockId) clearCurrentBlock()
  } else {
    const lastSelectedId = editorSelectedIds[editorSelectedIds.length - 1]
    if (lastSelectedId !== currentBlockId) {
      setCurrentBlockId(lastSelectedId)
    }
  }
}

/** Footprint estimate for a new, not-yet-measured block of the given type. */
function estimateNewBlockDimensions(blockType: string): { width: number; height: number } {
  return blockType === 'loop' || blockType === 'parallel'
    ? { width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH, height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT }
    : estimateBlockDimensions(blockType)
}

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

interface AddBlockFromToolbarDetail {
  type?: unknown
  enableTriggerMode?: unknown
  presetOperation?: unknown
  pendingConnect?: PendingConnect
}

/**
 * Main workflow canvas content component.
 * Renders the ReactFlow canvas with blocks, edges, and all interactive features.
 */
interface WorkflowContentProps {
  workspaceId?: string
  workflowId?: string
  embedded?: boolean
}

const WorkflowContent = React.memo(
  ({
    workspaceId: propWorkspaceId,
    workflowId: propWorkflowId,
    embedded,
  }: WorkflowContentProps = {}) => {
    const [isCanvasReady, setIsCanvasReady] = useState(false)
    const [potentialParentId, setPotentialParentId] = useState<string | null>(null)
    const [selectedEdges, setSelectedEdges] = useState<SelectedEdgesMap>(new Map())
    const [pendingConnect, setPendingConnect] = useState<PendingConnect | null>(null)
    const hasPointerDownSinceSelectorOpenedRef = useRef(false)
    const closeConnectionBlockSelector = useCallback(() => {
      hasPointerDownSinceSelectorOpenedRef.current = false
      setPendingConnect(null)
    }, [])
    const canvasContainerRef = useRef<HTMLDivElement>(null)
    const embeddedFitFrameRef = useRef<number | null>(null)
    const hasCompletedInitialEmbeddedFitRef = useRef(false)
    const initializedViewportWorkflowIdRef = useRef<string | null>(null)
    const userFocusedWorkflowIdRef = useRef<string | null>(null)
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

    const params = useParams()
    const router = useRouter()
    const reactFlowInstance = useReactFlow()
    const { screenToFlowPosition, getNodes, setNodes } = reactFlowInstance
    const { fitViewToBounds, getViewportCenter } = useCanvasViewport(reactFlowInstance, {
      embedded,
    })
    const { emitCursorUpdate, joinWorkflow, leaveWorkflow } = useSocket()
    useDynamicHandleRefresh()

    const workspaceId = propWorkspaceId || (params.workspaceId as string)
    const workflowIdParam = propWorkflowId || (params.workflowId as string)

    useEffect(() => {
      if (!embedded || !workflowIdParam) return
      joinWorkflow(workflowIdParam)
      return () => {
        leaveWorkflow()
      }
    }, [embedded, workflowIdParam, joinWorkflow, leaveWorkflow])

    useOAuthReturnForWorkflow(workflowIdParam)

    const {
      data: workflows = {},
      isLoading: isWorkflowMapLoading,
      isPlaceholderData: isWorkflowMapPlaceholderData,
    } = useWorkflowMap(workspaceId)
    const { data: folders = {} } = useFolderMap(workspaceId)
    const updateWorkflowMutation = useUpdateWorkflow()

    const {
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

    useEffect(() => {
      userFocusedWorkflowIdRef.current = null
    }, [activeWorkflowId, workflowIdParam])

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

    const isAutoConnectEnabled = useAutoConnect()
    const autoConnectRef = useRef(isAutoConnectEnabled)
    autoConnectRef.current = isAutoConnectEnabled

    const isAutoFocusOnClickEnabled = useAutoFocusOnClick()

    // Panel open states for context menu
    const isVariablesOpen = useVariablesModalStore((state) => state.isOpen)
    const isChatOpen = useChatStore((state) => state.isChatOpen)

    const snapGrid: [number, number] = useMemo(
      () => [snapToGridSize, snapToGridSize],
      [snapToGridSize]
    )

    const { blocks, edges, lastSaved } = currentWorkflow
    const workflowMetadata = workflows[workflowIdParam]
    const workflowRowLocked = !!workflowMetadata?.locked
    const workflowFolderLocked = isFolderOrAncestorLocked(workflowMetadata?.folderId, folders)

    const allBlocksLocked = useMemo(() => {
      const blockList = Object.values(blocks)
      return blockList.length > 0 && blockList.every((b) => b.locked)
    }, [blocks])
    const workflowLocked = workflowRowLocked || workflowFolderLocked
    const workflowReadOnly = workflowLocked
    const canvasOpacityClass = isCanvasReady
      ? workflowReadOnly
        ? 'opacity-75'
        : 'opacity-100'
      : 'opacity-0'

    const hasBlocks = useMemo(() => Object.keys(blocks).length > 0, [blocks])

    const hasLockedBlocks = useMemo(() => Object.values(blocks).some((b) => b.locked), [blocks])

    const isWorkflowReady = useMemo(
      () =>
        !isWorkflowMapPlaceholderData &&
        hydration.phase === 'ready' &&
        hydration.workflowId === workflowIdParam &&
        activeWorkflowId === workflowIdParam &&
        Boolean(workflows[workflowIdParam]) &&
        lastSaved !== undefined,
      [
        isWorkflowMapPlaceholderData,
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
    const canNodeEnterContainer = useCallback(
      (node: Node): boolean => {
        if (node.data?.type === 'starter') return false
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
    const highlightContainerNode = useCallback((containerId: string) => {
      clearDragHighlights()
      const containerElement = document.querySelector(`[data-id="${containerId}"]`)
      if (containerElement) {
        containerElement.classList.add(SUBFLOW_DROP_TARGET_CLASS)
        document.body.style.cursor = 'copy'
      }
    }, [])

    const { handleAutoLayout: autoLayoutWithFitView } = useAutoLayout(activeWorkflowId || null, {
      embedded,
    })

    const isWorkflowEmpty = !hasBlocks

    /** Handles OAuth connect events dispatched by Copilot tools. */
    useEffect(() => {
      const handleOpenOAuthConnect = (event: Event) => {
        const detail = (event as CustomEvent<OAuthConnectEventDetail>).detail
        if (!detail) return

        writeOAuthReturnContext({
          origin: 'workflow',
          workflowId: workflowIdParam,
          displayName: detail.providerName,
          providerId: detail.providerId,
          preCount: 0,
          workspaceId,
          reconnect: true,
          requestedAt: Date.now(),
        })

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
    }, [workflowIdParam, workspaceId])

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
    const connectionSourceRef = useRef<{
      nodeId: string | null
      handleId: string | null
    } | null>(null)

    /** Tracks whether onConnect successfully handled the connection (ReactFlow pattern). */
    const connectionCompletedRef = useRef(false)

    /** Set when Escape aborts an in-flight connection drag so no edge or selector results. */
    const connectionCancelledRef = useRef(false)

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
        const timeoutId = setTimeout(() => reapplyDiffMarkers(), 0)
        return () => clearTimeout(timeoutId)
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

      return edgesToFilter
        .map((edge) => {
          /* Heals an edge still carrying a side-anchored handle id from an
             older snapshot so it renders against a handle that exists. */
          const sourceHandle = normalizeWorkflowEdgeSourceHandle(edge.sourceHandle) ?? undefined
          const targetHandle = normalizeWorkflowEdgeTargetHandle(edge.targetHandle) ?? undefined
          if (
            sourceHandle === (edge.sourceHandle ?? undefined) &&
            targetHandle === (edge.targetHandle ?? undefined)
          ) {
            return edge
          }
          return { ...edge, sourceHandle, targetHandle }
        })
        .filter((edge) => {
          const sourceBlock = blocks[edge.source]
          const targetBlock = blocks[edge.target]
          return Boolean(sourceBlock && targetBlock)
        })
    }, [edges, isShowingDiff, isDiffReady, diffAnalysis, blocks])

    const { userPermissions, workspacePermissions, permissionsError } =
      useWorkspacePermissionsContext()
    /** Returns read-only permissions when viewing snapshot or a locked workflow. */
    const effectivePermissions = useMemo(() => {
      if (currentWorkflow.isSnapshotView || workflowReadOnly) {
        return {
          ...userPermissions,
          canEdit: false,
          canAdmin: currentWorkflow.isSnapshotView ? false : userPermissions.canAdmin,
          canRead: userPermissions.canRead,
        }
      }
      return userPermissions
    }, [userPermissions, currentWorkflow.isSnapshotView, workflowReadOnly])
    const {
      collaborativeBatchAddEdges,
      collaborativeBatchRemoveEdges,
      collaborativeBatchUpdatePositions,
      collaborativeBatchUpdateParent,
      collaborativeBatchAddBlocks,
      collaborativeBatchRemoveBlocks,
      collaborativeBatchToggleBlockEnabled,
      collaborativeBatchToggleLocked,
      collaborativeSetBlockErrorEnabled,
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
        isDescendantOf,
        calculateRelativePosition,
        getNodeAbsolutePosition,
        shiftUpdatesToContainerBounds,
        collaborativeBatchUpdateParent,
        resizeLoopNodesWrapper,
      ]
    )

    /**
     * Block queued to be centered once its node mounts and has been measured.
     * Creation is asynchronous — the store write, the node mount, and the
     * dimension measurement each land on a later frame — so `addBlock` records
     * the id and the effect below performs the camera move.
     */
    const pendingFocusBlockIdRef = useRef<string | null>(null)

    const { resolveSeedGate } = useOperationAccess()

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
        pendingFocusBlockIdRef.current = id

        const blockData: Record<string, unknown> = { ...(data || {}) }
        if (parentId) blockData.parentId = parentId
        if (extent) blockData.extent = extent

        const seedGate = resolveSeedGate(getBlock(type))

        const block = prepareBlockState({
          id,
          type,
          name,
          position,
          data: blockData,
          parentId,
          extent,
          triggerMode,
          isSeededValueAllowed: seedGate,
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
          /* The same gate as the declared default, deliberately: a preset is
             offered by search and the connection picker, whose index reads as
             unrestricted until the config resolves — so it is not the informed
             pick it looks like, and honouring it would persist an operation
             from an unfiltered list. */
          const presetOperation = presetSubBlockValues[OPERATION_SUBBLOCK_ID]
          const presetOperationDenied =
            typeof presetOperation === 'string' && !seedGate(OPERATION_SUBBLOCK_ID, presetOperation)

          Object.assign(
            subBlockValues[id],
            presetOperationDenied
              ? omit(presetSubBlockValues, [OPERATION_SUBBLOCK_ID])
              : presetSubBlockValues
          )
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
      [collaborativeBatchAddBlocks, setSelectedEdges, setPendingSelection, resolveSeedGate]
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
    const lastExecutionSnapshot = useLastExecutionSnapshot(workflowIdParam)

    const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

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
          /* Both absolutes are in the container's own coordinate space, so the
             difference is already the child's position within it — the header
             and padding are accounted for by the clamp, not subtracted here. */
          const nodeAbsPos = getNodeAbsolutePosition(nodeId)
          const parentAbsPos = getNodeAbsolutePosition(newParentId)
          newPosition = {
            x: nodeAbsPos.x - parentAbsPos.x,
            y: nodeAbsPos.y - parentAbsPos.y,
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

    const notifyProtectedBlockRemoval = useCallback(
      (protectedIds: string[], allProtected: boolean) => {
        if (protectedIds.length === 0) return false

        if (allProtected) {
          toast({
            message: 'Cannot delete locked blocks or blocks inside locked containers',
          })
          return true
        }

        toast({
          message: `Skipped ${protectedIds.length} protected block(s)`,
        })
        return false
      },
      []
    )

    const removeBlocksWithProtection = useCallback(
      (blockIds: string[]) => {
        const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(blockIds, blocks)
        if (notifyProtectedBlockRemoval(protectedIds, allProtected)) return []

        if (deletableIds.length > 0) {
          collaborativeBatchRemoveBlocks(deletableIds)
        }

        return deletableIds
      },
      [blocks, collaborativeBatchRemoveBlocks, notifyProtectedBlockRemoval]
    )

    const cutBlocksWithProtection = useCallback(
      (blockIds: string[]) => {
        const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(blockIds, blocks)
        if (notifyProtectedBlockRemoval(protectedIds, allProtected)) return

        if (deletableIds.length > 0) {
          copyBlocks(deletableIds)
          collaborativeBatchRemoveBlocks(deletableIds)
        }
      },
      [blocks, collaborativeBatchRemoveBlocks, copyBlocks, notifyProtectedBlockRemoval]
    )

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
              ...clipboardBlocks.map((b) => b.position.x + getRegularBlockWidth(b.type))
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
            toast.error('Triggers cannot be placed inside loop or parallel subflows.')
            return
          }

          // Prevent cycle: pasting a container that is the target container itself or one of its ancestors.
          // Use original clipboard IDs since preparePasteData regenerates them via generateId().
          const ancestorIds = new Set<string>()
          let walkId: string | undefined = targetContainer.loopId
          while (walkId && !ancestorIds.has(walkId)) {
            ancestorIds.add(walkId)
            walkId = blocks[walkId]?.data?.parentId as string | undefined
          }
          const originalClipboardBlocks = clipboard ? Object.values(clipboard.blocks) : []
          const wouldCreateCycle = originalClipboardBlocks.some(
            (b) => (b.type === 'loop' || b.type === 'parallel') && ancestorIds.has(b.id)
          )
          if (wouldCreateCycle) {
            toast.error('Cannot paste a subflow inside itself or its own descendant.')
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
                    getRegularBlockWidth(block.type) -
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
          toast.error(validation.message!)
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

    const handleContextCut = useCallback(() => {
      cutBlocksWithProtection(contextMenuBlocks.map((b) => b.id))
    }, [contextMenuBlocks, cutBlocksWithProtection])

    const handleContextDelete = useCallback(() => {
      removeBlocksWithProtection(contextMenuBlocks.map((b) => b.id))
    }, [contextMenuBlocks, removeBlocksWithProtection])

    const handleContextToggleEnabled = useCallback(() => {
      const blockIds = contextMenuBlocks.map((block) => block.id)
      collaborativeBatchToggleBlockEnabled(blockIds)
    }, [contextMenuBlocks, collaborativeBatchToggleBlockEnabled])

    const handleContextToggleLocked = useCallback(() => {
      const blockIds = contextMenuBlocks.map((block) => block.id)
      collaborativeBatchToggleLocked(blockIds)
    }, [contextMenuBlocks, collaborativeBatchToggleLocked])

    const handleToggleWorkflowLock = useCallback(() => {
      const currentBlocks = useWorkflowStore.getState().blocks
      const allLocked = Object.values(currentBlocks).every((b) => b.locked)
      const ids = getWorkflowLockToggleIds(currentBlocks, !allLocked)
      if (ids.length > 0) collaborativeBatchToggleLocked(ids)
    }, [collaborativeBatchToggleLocked])

    const lockNotificationIdRef = useRef<string | null>(null)

    const clearLockNotification = useCallback(() => {
      if (lockNotificationIdRef.current) {
        toast.dismiss(lockNotificationIdRef.current)
        lockNotificationIdRef.current = null
      }
    }, [])

    // Clear any in-flight lock toast when switching workflows so a fresh one is shown for the new workflow.
    useEffect(() => {
      clearLockNotification()
    }, [activeWorkflowId, clearLockNotification])

    /**
     * Locate the folder ancestor that supplies the inherited lock so the
     * notification can name it. Null when the lock is row/block-level instead.
     */
    const inheritedLockFolderName = useMemo(() => {
      if (!workflowFolderLocked) return null
      return findLockedAncestorFolder(workflowMetadata?.folderId, folders)?.name ?? null
    }, [workflowFolderLocked, workflowMetadata?.folderId, folders])

    const prevIsAdminRef = useRef(
      workspacePermissions?.viewer?.isAdmin ?? effectivePermissions.canAdmin
    )
    const prevLockSignatureRef = useRef<string | null>(null)
    useEffect(() => {
      if (!isWorkflowReady) return

      const isAdmin = workspacePermissions?.viewer?.isAdmin ?? effectivePermissions.canAdmin
      const canAdminChanged = prevIsAdminRef.current !== isAdmin
      prevIsAdminRef.current = isAdmin

      const lockSignature = workflowReadOnly
        ? workflowRowLocked
          ? 'row'
          : `folder:${inheritedLockFolderName ?? ''}`
        : null
      const lockSignatureChanged = prevLockSignatureRef.current !== lockSignature
      prevLockSignatureRef.current = lockSignature

      if (canAdminChanged || lockSignatureChanged) {
        clearLockNotification()
      }

      if (workflowReadOnly) {
        if (lockNotificationIdRef.current) return
        const isFolderInherited = workflowFolderLocked && !workflowRowLocked
        const message = isFolderInherited
          ? inheritedLockFolderName
            ? `This workflow is locked by folder "${inheritedLockFolderName}"`
            : 'This workflow is locked by a parent folder'
          : isAdmin
            ? 'This workflow is locked'
            : 'This workflow is locked. Ask an admin to unlock it.'

        const showInlineUnlock = isAdmin && !isFolderInherited

        lockNotificationIdRef.current = toast({
          message,
          duration: 0,
          ...(showInlineUnlock
            ? {
                action: {
                  label: 'Unlock Workflow',
                  onClick: () => window.dispatchEvent(new CustomEvent('unlock-workflow')),
                },
              }
            : {}),
        })
      } else {
        clearLockNotification()
      }
    }, [
      workflowReadOnly,
      workflowRowLocked,
      workflowFolderLocked,
      inheritedLockFolderName,
      isWorkflowReady,
      effectivePermissions.canAdmin,
      workspacePermissions,
      clearLockNotification,
    ])

    // Clean up notification on unmount
    useEffect(() => clearLockNotification, [clearLockNotification])

    /**
     * `mutate` is the only stable handle on a TanStack Query v5 mutation; the
     * mutation object itself rebuilds on every state change (e.g. `isPending`
     * flipping during the unlock call), so depend on `.mutate` directly.
     */
    const updateWorkflowMutate = updateWorkflowMutation.mutate
    useEffect(() => {
      const handleUnlockWorkflow = () => {
        if (workflowRowLocked && activeWorkflowId) {
          updateWorkflowMutate({
            workspaceId,
            workflowId: activeWorkflowId,
            metadata: { locked: false },
          })
        }
      }

      window.addEventListener('unlock-workflow', handleUnlockWorkflow)
      return () => window.removeEventListener('unlock-workflow', handleUnlockWorkflow)
    }, [activeWorkflowId, updateWorkflowMutate, workflowRowLocked, workspaceId])

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

    const handleContextAddImage = useCallback(() => {
      if (contextMenuBlocks.length === 1) requestNoteImage(contextMenuBlocks[0].id)
    }, [contextMenuBlocks])

    const handleContextRename = useCallback(() => {
      if (contextMenuBlocks.length !== 1) return
      const block = contextMenuBlocks[0]
      /* A note renames itself on the card. Routing it through the panel editor
         would latch that editor's rename onto a block it refuses to show, and
         the name would then be applied over whatever was selected next. */
      if (block.type === 'note') {
        requestNoteRename(block.id)
        return
      }
      usePanelEditorStore.getState().setCurrentBlockId(block.id)
      usePanelEditorStore.getState().triggerRename()
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
      const { dependenciesSatisfied } = getRunFromBlockDependencyState(
        block.id,
        edges,
        lastExecutionSnapshot
      )
      const isNoteBlock = block.type === 'note'
      const isInsideSubflow =
        block.parentId && (block.parentType === 'loop' || block.parentType === 'parallel')

      if (isInsideSubflow) return { canRun: false, reason: 'Cannot run from inside subflow' }
      if (!dependenciesSatisfied) return { canRun: false, reason: 'Run previous blocks first' }
      if (isNoteBlock) return { canRun: false, reason: undefined }
      if (isExecuting) return { canRun: false, reason: undefined }

      return { canRun: true, reason: undefined }
    }, [contextMenuBlocks, edges, lastExecutionSnapshot, isExecuting])

    const handleContextAddBlock = useCallback(() => {
      useSearchModalStore.getState().open()
    }, [])

    const handleContextOpenLogs = useCallback(() => {
      router.push(`/workspace/${workspaceId}/logs?workflowIds=${workflowIdParam}`)
    }, [router, workspaceId, workflowIdParam])

    const handleContextOpenSearchReplace = useCallback(() => {
      useWorkflowSearchReplaceStore.getState().open()
    }, [])

    const handleContextToggleVariables = useCallback(() => {
      const { isOpen, setIsOpen } = useVariablesModalStore.getState()
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
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'x') {
          const selection = window.getSelection()
          const hasTextSelection = selection && selection.toString().length > 0

          if (hasTextSelection || !effectivePermissions.canEdit) {
            return
          }

          const selectedNodes = getNodes().filter((node) => node.selected)
          if (selectedNodes.length > 0) {
            event.preventDefault()
            cutBlocksWithProtection(selectedNodes.map((node) => node.id))
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
      cutBlocksWithProtection,
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

    /**
     * The block the user touched most recently, retained after deselection
     * and reset on reload. Drives z-ordering (the last touched card stays on
     * top) and is the fallback source for positionless adds.
     */
    const [lastInteractedNodeId, setLastInteractedNodeId] = useState<string | null>(null)

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
          id: generateId(),
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
     * Drops a proposed spot below any root-level block already occupying it,
     * cascading in top-to-bottom order so repeated adds stack instead of pile.
     */
    const nudgeBelowOccupiedSpots = useCallback(
      (
        start: { x: number; y: number },
        dimensions: { width: number; height: number }
      ): { x: number; y: number } => {
        const occupants = Object.values(blocks)
          .filter((block) => !block.data?.parentId)
          .map((block) => {
            const blockDimensions = getBlockDimensions(block.id)
            return {
              left: block.position.x,
              right: block.position.x + blockDimensions.width,
              top: block.position.y,
              bottom: block.position.y + blockDimensions.height,
            }
          })
          .sort((a, b) => a.top - b.top)

        let y = start.y
        for (const rect of occupants) {
          const overlapsX = start.x < rect.right && start.x + dimensions.width > rect.left
          const overlapsY = y < rect.bottom && y + dimensions.height > rect.top
          if (overlapsX && overlapsY) {
            y = rect.bottom + DEFAULT_VERTICAL_SPACING
          }
        }

        return { x: start.x, y }
      },
      [blocks, getBlockDimensions]
    )

    /**
     * Positions a block added without an explicit drop point after its
     * auto-connect source: one layout column to the right, vertically centred
     * on the source, then nudged below any root-level block already occupying
     * that spot (a fan-out from a source that already has a next block).
     */
    const getPositionAfterSourceBlock = useCallback(
      (sourceBlockId: string, blockType: string): { x: number; y: number } => {
        const sourcePosition = getNodeAbsolutePosition(sourceBlockId)
        const sourceDimensions = getBlockDimensions(sourceBlockId)
        const newBlockDimensions = estimateNewBlockDimensions(blockType)

        return nudgeBelowOccupiedSpots(
          {
            x: sourcePosition.x + sourceDimensions.width + DEFAULT_HORIZONTAL_SPACING,
            y: sourcePosition.y + sourceDimensions.height / 2 - newBlockDimensions.height / 2,
          },
          newBlockDimensions
        )
      },
      [getBlockDimensions, getNodeAbsolutePosition, nudgeBelowOccupiedSpots]
    )

    /**
     * Edge for a positionless add (cmdk, toolbar click). The source is the
     * rightmost eligible selected block — multi-selects carry no click
     * order, so the visual end of the selection is the deterministic pick —
     * falling back to the last block the user touched this session, then to
     * the canvas's only flow block (a fresh workflow's trigger), where
     * attachment is unambiguous. Ineligible candidates (notes, disabled and
     * response blocks, container children — the new block lands at root
     * level, so that edge would cross the container boundary) fall through
     * to the next signal rather than blocking attachment, and annotations
     * never take an edge as target. With no eligible source there is no
     * edge: guessing one produced edges the user never implied.
     */
    const tryCreateEdgeForPositionlessAdd = useCallback(
      (targetBlockId: string, targetBlockType: string): Edge | undefined => {
        if (!autoConnectRef.current) return undefined
        if (isAnnotationOnlyBlock(targetBlockType)) return undefined

        const isEligibleSource = (blockId: string): boolean => {
          const block = blocks[blockId]
          return !!block && isAutoConnectSourceCandidate(block) && !block.data?.parentId
        }

        let sourceId: string | null = null
        for (const node of getNodes()) {
          if (!node.selected || !isEligibleSource(node.id)) continue
          if (!sourceId || blocks[node.id].position.x > blocks[sourceId].position.x) {
            sourceId = node.id
          }
        }

        if (!sourceId && lastInteractedNodeId && isEligibleSource(lastInteractedNodeId)) {
          sourceId = lastInteractedNodeId
        }

        if (!sourceId) {
          const flowBlocks = Object.values(blocks).filter(
            (block) => !isAnnotationOnlyBlock(block.type)
          )
          if (flowBlocks.length === 1 && isEligibleSource(flowBlocks[0].id)) {
            sourceId = flowBlocks[0].id
          }
        }

        if (!sourceId) return undefined

        const sourceHandle = determineSourceHandle({ id: sourceId, type: blocks[sourceId].type })
        return createEdgeObject(sourceId, targetBlockId, sourceHandle)
      },
      [
        blocks,
        getNodes,
        lastInteractedNodeId,
        isAutoConnectSourceCandidate,
        determineSourceHandle,
        createEdgeObject,
      ]
    )

    /**
     * Position for a block added unattached: parked at the bottom of the
     * rightmost column of root-level flow blocks — near the end of the
     * workflow, where the user is most likely to wire it in. Notes don't
     * anchor the column. Returns null when the canvas has no root-level flow
     * block to anchor on.
     */
    const getUnattachedBlockPosition = useCallback(
      (blockType: string): { x: number; y: number } | null => {
        const anchorCandidates = Object.values(blocks).filter(
          (block) => !block.data?.parentId && !isAnnotationOnlyBlock(block.type)
        )
        if (anchorCandidates.length === 0) return null

        const anchor = anchorCandidates.reduce((rightmost, block) =>
          block.position.x > rightmost.position.x ? block : rightmost
        )

        return nudgeBelowOccupiedSpots(
          {
            x: anchor.position.x,
            y: anchor.position.y + getBlockDimensions(anchor.id).height + DEFAULT_VERTICAL_SPACING,
          },
          estimateNewBlockDimensions(blockType)
        )
      },
      [blocks, getBlockDimensions, nudgeBelowOccupiedSpots]
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
          toast.error(message)
          return true
        }

        const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(blocks, blockType)
        if (singleInstanceIssue) {
          toast.error(
            `A workflow can only have one ${singleInstanceIssue.blockName} block. Please remove the existing one before adding a new one.`
          )
          return true
        }

        return false
      },
      [blocks]
    )

    /**
     * Shared handler for drops of toolbar items onto the workflow canvas.
     *
     * This encapsulates the full drop behavior (container handling, auto-connect,
     * trigger constraints, etc.) so it can be reused both for direct ReactFlow
     * drops and for drops forwarded from the empty-workflow command list overlay.
     *
     * @param data - Drag data from the toolbar (type + optional trigger mode).
     * @param position - The point that was dropped on, in ReactFlow coordinates.
     */
    const handleToolbarDrop = useCallback(
      (
        data: {
          type: string
          enableTriggerMode?: boolean
          presetOperation?: string
          forcedSource?: { nodeId: string; handleId: string }
        },
        position: { x: number; y: number }
      ) => {
        if (!data.type || data.type === 'connectionBlock') return

        const operationConfig = data.presetOperation
          ? { operation: data.presetOperation }
          : undefined

        const { forcedSource } = data

        /**
         * Edge for the new block. With a `forcedSource` (a drag-release from a
         * handle), wire from that exact handle — but only when it stays within the
         * resolved container context, matching onConnect's boundary rules; a
         * cross-boundary source yields no edge. Otherwise fall back to normal
         * proximity auto-connect.
         */
        const resolveEdge = (
          targetId: string,
          targetParentId: string | null,
          fallback: () => Edge | undefined
        ): Edge | undefined => {
          if (!forcedSource) return fallback()

          const isContainerStartHandle =
            forcedSource.handleId === 'loop-start-source' ||
            forcedSource.handleId === 'parallel-start-source'
          if (isContainerStartHandle) {
            // A container-start handle may only wire to a child of that container.
            return forcedSource.nodeId === targetParentId
              ? createEdgeObject(forcedSource.nodeId, targetId, forcedSource.handleId)
              : undefined
          }

          const sourceBlock = blocks[forcedSource.nodeId]
          if (!sourceBlock) return undefined
          const sourceParentId = sourceBlock.data?.parentId ?? null
          return sourceParentId === targetParentId
            ? createEdgeObject(forcedSource.nodeId, targetId, forcedSource.handleId)
            : undefined
        }

        try {
          /** The new block's footprint — centres the drop, and clamps it in a container. */
          const blockDimensions =
            data.type === 'loop' || data.type === 'parallel'
              ? {
                  width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
                  height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
                }
              : estimateBlockDimensions(data.type)

          /**
           * Where the block's top-left lands. A toolbar drop puts it under the
           * cursor; a drag-release puts it over the picker box it replaces,
           * which is centred on the release point.
           *
           * `position` stays the point the user dropped on, and that is what
           * resolves the container below. Resolving it from the top-left corner
           * instead placed a block released over a subflow's header — or
           * anywhere within half a block of its top edge — outside that subflow.
           */
          const placement = forcedSource
            ? { x: position.x, y: position.y - blockDimensions.height / 2 }
            : position

          const containerInfo = isPointInLoopNode(position)

          clearDragHighlights()

          if (data.type === 'loop' || data.type === 'parallel') {
            const id = generateId()
            const baseName = data.type === 'loop' ? 'Loop' : 'Parallel'
            const name = getUniqueBlockName(baseName, blocks)

            if (containerInfo) {
              const rawPosition = {
                x: placement.x - containerInfo.loopPosition.x,
                y: placement.y - containerInfo.loopPosition.y,
              }

              const relativePosition = clampPositionToContainer(
                rawPosition,
                containerInfo.dimensions,
                blockDimensions
              )

              const existingChildBlocks = Object.values(blocks)
                .filter((b) => b.data?.parentId === containerInfo.loopId)
                .map((b) => ({ id: b.id, type: b.type, position: b.position }))

              const autoConnectEdge = resolveEdge(id, containerInfo.loopId, () =>
                tryCreateAutoConnectEdge(relativePosition, id, {
                  targetParentId: containerInfo.loopId,
                  existingChildBlocks,
                  containerId: containerInfo.loopId,
                })
              )

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
              const autoConnectEdge = resolveEdge(id, null, () =>
                tryCreateAutoConnectEdge(placement, id, {
                  targetParentId: null,
                })
              )

              addBlock(
                id,
                data.type,
                name,
                placement,
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

          // Validate block config for regular blocks
          const blockConfig = getBlock(data.type)
          if (!blockConfig) {
            logger.error('Invalid block type:', { data })
            return
          }

          // Generate id and name here so they're available in all code paths
          const id = generateId()
          // Prefer semantic default names for triggers; then ensure unique numbering centrally
          const defaultTriggerNameDrop = TriggerUtils.getDefaultTriggerName(data.type)
          const baseName = defaultTriggerNameDrop || getDefaultBlockName(blockConfig)
          const name = getUniqueBlockName(baseName, blocks)

          if (containerInfo) {
            // Only reject blocks that will actually be triggers: pure trigger blocks
            // and explicit trigger-mode drops. A dual-mode block (e.g. Gmail) added
            // without trigger mode is an ordinary block and is valid in a subflow.
            const isTriggerBlock =
              blockConfig.category === 'triggers' || data.enableTriggerMode === true

            if (isTriggerBlock) {
              toast.error('Triggers cannot be placed inside loop or parallel subflows.')
              return
            }

            // Calculate raw position relative to container origin
            const rawPosition = {
              x: placement.x - containerInfo.loopPosition.x,
              y: placement.y - containerInfo.loopPosition.y,
            }

            // Clamp position to keep block inside container's content area
            const relativePosition = clampPositionToContainer(
              rawPosition,
              containerInfo.dimensions,
              blockDimensions
            )

            // Capture existing child blocks for auto-connect
            const existingChildBlocks = Object.values(blocks)
              .filter((b) => b.data?.parentId === containerInfo.loopId)
              .map((b) => ({ id: b.id, type: b.type, position: b.position }))

            const autoConnectEdge = resolveEdge(id, containerInfo.loopId, () =>
              tryCreateAutoConnectEdge(relativePosition, id, {
                targetParentId: containerInfo.loopId,
                existingChildBlocks,
                containerId: containerInfo.loopId,
              })
            )

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
              autoConnectEdge,
              undefined,
              operationConfig
            )

            // Resize the container node to fit the new block
            // Immediate resize without delay
            resizeLoopNodesWrapper()
          } else {
            // Centralized trigger constraints
            if (checkTriggerConstraints(data.type)) return

            const autoConnectEdge = resolveEdge(id, null, () =>
              tryCreateAutoConnectEdge(placement, id, {
                targetParentId: null,
              })
            )

            // Regular canvas drop with auto-connect edge
            // Use enableTriggerMode from drag data if present (when dragging from Triggers tab)
            const enableTriggerMode = data.enableTriggerMode || false
            addBlock(
              id,
              data.type,
              name,
              placement,
              undefined,
              undefined,
              undefined,
              autoConnectEdge,
              enableTriggerMode,
              operationConfig
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
        tryCreateAutoConnectEdge,
        checkTriggerConstraints,
        createEdgeObject,
      ]
    )

    /** Handles toolbar block click events to add blocks to the canvas. */
    useEffect(() => {
      const handleAddBlockFromToolbar = (event: CustomEvent<AddBlockFromToolbarDetail>) => {
        // Check if user has permission to interact with blocks
        if (!effectivePermissions.canEdit) {
          return
        }

        const { type, enableTriggerMode, presetOperation, pendingConnect } = event.detail

        if (typeof type !== 'string' || !type) return
        if (type === 'connectionBlock') return

        /**
         * A genuine edge drag-release carries `pendingConnect`. Delegating to
         * `handleToolbarDrop` preserves container-aware placement and connects
         * from the exact released handle — the release point goes through
         * verbatim, and the drop handler owns both the container hit-test and
         * the centring the picker box implies.
         */
        if (pendingConnect) {
          handleToolbarDrop(
            {
              type,
              enableTriggerMode: enableTriggerMode === true,
              presetOperation: typeof presetOperation === 'string' ? presetOperation : undefined,
              forcedSource: pendingConnect.source,
            },
            pendingConnect.position
          )
          return
        }

        const basePosition = getViewportCenter()

        if (type === 'loop' || type === 'parallel') {
          const id = generateId()
          const baseName = type === 'loop' ? 'Loop' : 'Parallel'
          const name = getUniqueBlockName(baseName, blocks)

          const autoConnectEdge = tryCreateEdgeForPositionlessAdd(id, type)
          const position = autoConnectEdge
            ? getPositionAfterSourceBlock(autoConnectEdge.source, type)
            : (getUnattachedBlockPosition(type) ?? basePosition)

          addBlock(
            id,
            type,
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

        const blockConfig = getBlock(type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { type })
          return
        }

        if (checkTriggerConstraints(type)) return

        const id = generateId()
        const defaultTriggerName = TriggerUtils.getDefaultTriggerName(type)
        const baseName = defaultTriggerName || getDefaultBlockName(blockConfig)
        const name = getUniqueBlockName(baseName, blocks)

        const autoConnectEdge = tryCreateEdgeForPositionlessAdd(id, type)
        const position = autoConnectEdge
          ? getPositionAfterSourceBlock(autoConnectEdge.source, type)
          : (getUnattachedBlockPosition(type) ?? basePosition)

        addBlock(
          id,
          type,
          name,
          position,
          undefined,
          undefined,
          undefined,
          autoConnectEdge,
          enableTriggerMode === true,
          typeof presetOperation === 'string' && presetOperation
            ? { operation: presetOperation }
            : undefined
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
      handleToolbarDrop,
      tryCreateEdgeForPositionlessAdd,
      getPositionAfterSourceBlock,
      getUnattachedBlockPosition,
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
        toast.error(message)
      }

      window.addEventListener('show-trigger-warning', handleShowTriggerWarning as EventListener)

      return () => {
        window.removeEventListener(
          'show-trigger-warning',
          handleShowTriggerWarning as EventListener
        )
      }
    }, [])

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

    const onDropLocked = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault()
        if (!event.dataTransfer?.types.includes('application/json')) return
        const message = effectivePermissions.canAdmin
          ? 'Unlock the workflow to add blocks.'
          : 'This workflow is locked. Ask an admin to unlock it.'
        toast({ message })
      },
      [effectivePermissions.canAdmin]
    )

    const handleCanvasPointerMove = useCallback(
      (event: React.PointerEvent<Element>) => {
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
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

          // Highlight container if hovering over it

          if (containerInfo) {
            const containerNode = getNodes().find((n) => n.id === containerInfo.loopId)
            if (containerNode?.type === 'subflowNode') {
              const kind = (containerNode.data as SubflowNodeData)?.kind
              if (kind === 'loop' || kind === 'parallel') {
                highlightContainerNode(containerInfo.loopId)
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
    const currentWorkflowExists =
      !isWorkflowMapPlaceholderData && Boolean(workflows[workflowIdParam])

    useEffect(() => {
      const currentId = workflowIdParam
      // Wait for workflow data to be available before attempting to load
      if (
        isWorkflowMapLoading ||
        isWorkflowMapPlaceholderData ||
        !currentId ||
        !currentWorkflowExists ||
        !hydration.workspaceId ||
        hydration.workspaceId !== workspaceId
      ) {
        return
      }

      // Prevent duplicate loads - if we're already loading this workflow, skip
      if (loadingWorkflowRef.current === currentId) {
        return
      }

      if (hydration.phase === 'creating') {
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
      isWorkflowMapLoading,
      isWorkflowMapPlaceholderData,
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
      if (embedded) return

      if (
        isWorkflowMapLoading ||
        isWorkflowMapPlaceholderData ||
        !hydration.workspaceId ||
        hydration.workspaceId !== workspaceId
      ) {
        return
      }

      if (hydration.phase === 'creating') {
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
        logger.info(
          `Workflow ${workflowIdParam} not found, redirecting to first available workflow`
        )

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
      embedded,
      workflowIdParam,
      isWorkflowMapLoading,
      isWorkflowMapPlaceholderData,
      currentWorkflowExists,
      workflowCount,
      hydration.phase,
      hydration.workspaceId,
      workspaceId,
      router,
      workflows,
    ])

    const blockConfigCache = useRef<Map<string, any>>(new Map())
    const getBlockConfig = useCallback((type: string) => {
      const cached = blockConfigCache.current.get(type)
      if (cached) return cached
      // Don't cache a miss: custom (deploy-as-block) blocks resolve only once the
      // client overlay hydrates, so an early miss must re-resolve on a later render.
      const config = getBlock(type)
      if (config) blockConfigCache.current.set(type, config)
      return config
    }, [])

    // Bust cached custom-block node configs when the org overlay (hydrated by
    // CustomBlocksLoader) changes, so renames/icon edits refresh existing nodes.
    const { data: customBlocksData } = useCustomBlocks(workspaceId)
    useEffect(() => {
      for (const cb of customBlocksData ?? []) blockConfigCache.current.delete(cb.type)
    }, [customBlocksData])

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
          // Compute nesting depth so children always render above parents
          let depth = 0
          let pid = block.data?.parentId as string | undefined
          while (pid && depth < 100) {
            depth++
            pid = blocks[pid]?.data?.parentId as string | undefined
          }
          nodeArray.push({
            id: block.id,
            type: 'subflowNode',
            position: block.position,
            parentId: block.data?.parentId,
            extent: block.data?.extent || undefined,
            dragHandle: '.workflow-drag-handle',
            draggable: !workflowReadOnly && !isBlockProtected(block.id, blocks),
            zIndex: depth,
            data: {
              ...block.data,
              name: block.name,
              width: block.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
              height: block.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
              kind: block.type === 'loop' ? 'loop' : 'parallel',
              isWorkflowLocked: workflowReadOnly,
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

        // A card carries its place in the canvas z-scale from the start: React
        // Flow reads a missing zIndex as 0, which would sit a card at the same
        // level as a subflow container and below the edge band. A card inside a
        // container starts higher still, so it clears the parent's interactive
        // body area (which needs pointer-events for click-to-select).
        const cardZIndex = block.data?.parentId ? CONTAINER_CHILD_Z_BASE : BLOCK_Z_BASE

        // Create stable node object - React Flow will handle shallow comparison
        nodeArray.push({
          id: block.id,
          type: nodeType,
          position,
          parentId: block.data?.parentId,
          dragHandle,
          draggable: !workflowReadOnly && !isBlockProtected(block.id, blocks),
          zIndex: cardZIndex,
          extent: (() => {
            // Clamp children to subflow body (exclude header)
            const parentId = block.data?.parentId as string | undefined
            if (!parentId) return block.data?.extent || undefined

            // Constrain the top and left to the container's own gutter, the same
            // floor `clampPositionToContainer` applies everywhere else — a drag
            // that stopped somewhere different from a drop was the whole reason
            // these numbers were written out by hand and drifted. Right and
            // bottom stay free so a block can move anywhere in the body.
            const minX = CONTAINER_DIMENSIONS.LEFT_PADDING
            const minY = CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING
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
            ...(embedded && { isEmbedded: true }),
            isWorkflowLocked: workflowReadOnly,
            onSetErrorOutputEnabled: collaborativeSetBlockErrorEnabled,
            onRemoveEdges: collaborativeBatchRemoveEdges,
          },
          // Include dynamic dimensions for container resizing calculations (must match rendered size)
          // Both note and workflow blocks calculate dimensions deterministically via useBlockDimensions
          // Use estimated dimensions for blocks without measured height to ensure selection bounds are correct
          width: getRegularBlockWidth(block.type),
          height: block.height
            ? block.type === 'note'
              ? block.height
              : Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT)
            : estimateBlockDimensions(block.type).height,
        })
      })

      return nodeArray
    }, [
      blocksStructureHash,
      blocks,
      activeBlockIds,
      pendingBlocks,
      isDebugging,
      getBlockConfig,
      embedded,
      workflowReadOnly,
      collaborativeSetBlockErrorEnabled,
      collaborativeBatchRemoveEdges,
    ])

    // Local state for nodes - allows smooth drag without store updates on every frame
    const [displayNodes, setDisplayNodes] = useState<Node[]>([])

    const selectedNodeIds = useMemo(
      () => displayNodes.filter((node) => node.selected).map((node) => node.id),
      [displayNodes]
    )
    const selectedNodeIdsKey = selectedNodeIds.join(',')

    useEffect(() => {
      syncPanelWithSelection(selectedNodeIds)
    }, [selectedNodeIdsKey])

    // Keep the most recently selected block on top even after deselection, so a
    // dragged block doesn't suddenly drop behind other overlapping blocks.
    useEffect(() => {
      if (selectedNodeIds.length > 0) {
        setLastInteractedNodeId(selectedNodeIds[selectedNodeIds.length - 1])
      }
    }, [selectedNodeIdsKey])

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
        const resolved = resolveSelectionConflicts(withSelection, blocks)
        setDisplayNodes(resolved)
        return
      }

      setDisplayNodes((currentNodes) => reconcileCanvasNodes(currentNodes, derivedNodes))
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

          const validBlockIdSet = new Set(validBlockIds)
          const descendantIds = getDescendantBlockIds(validBlockIds, blocks)
          const movingNodeIds = new Set([...validBlockIds, ...descendantIds])

          // Find boundary edges (one end inside the subtree, one end outside)
          const boundaryEdges = edgesForDisplay.filter((e) => {
            const sourceInSelection = movingNodeIds.has(e.source)
            const targetInSelection = movingNodeIds.has(e.target)
            return sourceInSelection !== targetInSelection
          })

          // Attribute each boundary edge to the validBlockId that is the ancestor of the moved endpoint
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
              id = blocks[id]?.data?.parentId
            }
          }

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

    useEffect(() => {
      const handleToggleWorkflowLock = (e: CustomEvent<{ blockIds: string[] }>) => {
        collaborativeBatchToggleLocked(e.detail.blockIds)
      }

      window.addEventListener('toggle-workflow-lock', handleToggleWorkflowLock as EventListener)
      return () =>
        window.removeEventListener(
          'toggle-workflow-lock',
          handleToggleWorkflowLock as EventListener
        )
    }, [collaborativeBatchToggleLocked])

    /**
     * Updates container dimensions in displayNodes during drag or keyboard movement.
     * Resizes the moved node's immediate parent and all ancestor containers (for nested loops/parallels).
     */
    const updateContainerDimensionsDuringMove = useCallback(
      (movedNodeId: string, movedNodePosition: { x: number; y: number }) => {
        const ancestorIds: string[] = []
        const visited = new Set<string>()
        let currentId = blocks[movedNodeId]?.data?.parentId
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId)
          ancestorIds.push(currentId)
          currentId = blocks[currentId]?.data?.parentId
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
      [blocks, getBlockDimensions]
    )

    /** Handles node changes - applies changes and resolves parent-child selection conflicts. */
    const onNodesChange = useCallback(
      (changes: NodeChange[]) => {
        const selectorPositionChange = [...changes]
          .reverse()
          .find(
            (change) =>
              change.type === 'position' &&
              change.id === CONNECTION_BLOCK_SELECTOR_NODE_ID &&
              change.position
          )

        if (selectorPositionChange?.type === 'position' && selectorPositionChange.position) {
          const { position } = selectorPositionChange
          setPendingConnect((current) =>
            current
              ? {
                  ...current,
                  position: {
                    x: position.x,
                    y: position.y + CONNECTION_BLOCK_SELECTOR_DIMENSIONS.height / 2,
                  },
                }
              : current
          )
        }

        const workflowChanges = changes.filter(
          (change) => !('id' in change) || change.id !== CONNECTION_BLOCK_SELECTOR_NODE_ID
        )
        const hasSelectionChange = workflowChanges.some((c) => c.type === 'select')
        setDisplayNodes((currentNodes) => {
          // Filter out cross-context selection changes before applying so that
          // nodes at a different nesting level never appear selected, even for
          // a single frame.
          let changesToApply = workflowChanges
          if (hasSelectionChange) {
            const currentlySelected = currentNodes.filter((n) => n.selected)
            // Only filter on additive multi-select (shift-click), not replacement
            // clicks. A replacement click includes deselections of currently selected
            // nodes; a shift-click only adds selections.
            const isReplacementClick = workflowChanges.some(
              (c) =>
                c.type === 'select' &&
                'selected' in c &&
                !c.selected &&
                currentlySelected.some((n) => n.id === c.id)
            )
            if (!isReplacementClick && currentlySelected.length > 0) {
              const selectionContext = getNodeSelectionContextId(currentlySelected[0], blocks)
              changesToApply = workflowChanges.filter((c) => {
                if (c.type !== 'select' || !('selected' in c) || !c.selected) return true
                const node = currentNodes.find((n) => n.id === c.id)
                if (!node) return true
                return getNodeSelectionContextId(node, blocks) === selectionContext
              })
            }
          }

          const updated = applyNodeChanges(changesToApply, currentNodes)
          if (!hasSelectionChange) return updated

          const preferredNodeId = [...changesToApply]
            .reverse()
            .find(
              (change): change is NodeChange & { id: string; selected: boolean } =>
                change.type === 'select' && 'selected' in change && change.selected === true
            )?.id

          return resolveSelectionConflicts(updated, blocks, preferredNodeId)
        })

        // Handle position changes (e.g., from keyboard arrow key movement)
        // Update container dimensions when child nodes are moved and persist to backend
        // Only persist if not in a drag operation (drag-end is handled by onNodeDragStop)
        const isInDragOperation =
          getDragStartPosition() !== null || multiNodeDragStartRef.current.size > 0
        const keyboardPositionUpdates: Array<{ id: string; position: { x: number; y: number } }> =
          []
        for (const change of workflowChanges) {
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

    /** Synchronizes transient edge selection and handles edge removal changes. */
    const onEdgesChange = useCallback(
      (changes: EdgeChange[]) => {
        const selectionChanges = changes.filter(
          (change): change is Extract<EdgeChange, { type: 'select' }> => change.type === 'select'
        )
        if (selectionChanges.length > 0) {
          const focusedEdgeTestId = document.activeElement?.getAttribute('data-testid')
          const shouldRestoreEdgeFocus = selectionChanges.some(
            (change) => change.selected && focusedEdgeTestId === `rf__edge-${change.id}`
          )
          const nodes = getNodes()
          setSelectedEdges((current) =>
            applyEdgeSelectionChanges(current, selectionChanges, (edgeId) => {
              const edge = edgesForDisplay.find((candidate) => candidate.id === edgeId)
              return edge ? getEdgeSelectionMapKey(edge, nodes, blocks) : null
            })
          )
          if (shouldRestoreEdgeFocus) {
            requestAnimationFrame(() => {
              const focusedEdge = Array.from(
                document.querySelectorAll<SVGGElement>('.react-flow__edge')
              ).find((edge) => edge.getAttribute('data-testid') === focusedEdgeTestId)
              focusedEdge?.focus({ preventScroll: true })
            })
          }
        }

        const edgeIdsToRemove = changes
          .filter(
            (change): change is Extract<EdgeChange, { type: 'remove' }> => change.type === 'remove'
          )
          .map((change) => change.id)
          .filter((edgeId: string) => {
            // Prevent removing edges targeting protected blocks
            const edge = edges.find((e) => e.id === edgeId)
            if (!edge) return true
            return !isEdgeProtected(edge, blocks)
          })

        if (edgeIdsToRemove.length > 0) {
          collaborativeBatchRemoveEdges(edgeIdsToRemove)
        }
      },
      [blocks, collaborativeBatchRemoveEdges, edges, edgesForDisplay, getNodes]
    )

    /**
     * Finds the node under the cursor using DOM hit-testing for pixel-perfect
     * detection that matches exactly what the user sees on screen.
     * Uses the same approach as ReactFlow's internal handle detection.
     */
    const findNodeAtScreenPosition = useCallback(
      (clientX: number, clientY: number) => {
        const elements = document.elementsFromPoint(clientX, clientY)
        const nodes = getNodes()

        for (const el of elements) {
          const nodeEl = el.closest('.react-flow__node') as HTMLElement | null
          if (!nodeEl) continue

          const nodeId = nodeEl.getAttribute('data-id')
          if (!nodeId) continue

          const node = nodes.find((n) => n.id === nodeId)
          if (node && node.type !== 'subflowNode') return node
        }

        return undefined
      },
      [getNodes]
    )

    /**
     * Aborts an in-flight connection drag on Escape.
     *
     * React Flow only tears a handle drag down on pointer release, so a synthetic
     * mouseup is dispatched to run its own cleanup: it stops auto-panning, clears
     * the connection line and handle highlights, and detaches its document
     * listeners. `connectionCancelledRef` turns the resulting `onConnect` and
     * `onConnectEnd` into no-ops so the drag leaves behind neither an edge nor the
     * block selector, and the real mouseup that follows is inert.
     *
     * Listens in the capture phase and stops propagation so Escape mid-drag only
     * cancels the edge and never reaches an unrelated Escape handler.
     */
    const handleConnectionEscape = useCallback((event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !connectionSourceRef.current) return
      event.preventDefault()
      event.stopPropagation()
      connectionCancelledRef.current = true
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    }, [])

    useEffect(
      () => () => window.removeEventListener('keydown', handleConnectionEscape, true),
      [handleConnectionEscape]
    )

    /**
     * Captures the source handle when a connection drag starts.
     * Resets connectionCompletedRef to track if onConnect handles this connection.
     */
    const onConnectStart = useCallback<OnConnectStart>(
      (_event, params) => {
        useSearchModalStore.getState().close()
        closeConnectionBlockSelector()
        canvasContainerRef.current?.setAttribute(
          'data-connection-line',
          params.handleId === 'error' ? 'error' : 'default'
        )
        canvasContainerRef.current?.setAttribute('data-connection-active', 'true')
        connectionSourceRef.current = {
          nodeId: params?.nodeId,
          handleId: params?.handleId,
        }
        connectionCompletedRef.current = false
        connectionCancelledRef.current = false
        window.addEventListener('keydown', handleConnectionEscape, true)
      },
      [closeConnectionBlockSelector, handleConnectionEscape]
    )

    /** Handles new edge connections with container boundary validation. */
    const onConnect = useCallback(
      (connection: any) => {
        if (connectionCancelledRef.current) return
        if (connection.source && connection.target) {
          const normalizedConnection = {
            ...connection,
            sourceHandle: normalizeCursorSourceHandleId(
              connection.sourceHandle,
              blocks[connection.source]?.type
            ),
            targetHandle: connection.targetHandle,
          }
          // Check if connecting nodes across container boundaries
          const sourceNode = getNodes().find((n) => n.id === connection.source)
          const targetNode = getNodes().find((n) => n.id === connection.target)

          if (!sourceNode || !targetNode) return

          // Prevent connections to protected blocks (outbound from locked blocks is allowed)
          if (isEdgeProtected(normalizedConnection, blocks)) {
            toast({
              message: 'Cannot connect to locked blocks or blocks inside locked containers',
            })
            return
          }

          // Get parent information (handle container start node case)
          const sourceParentId =
            blocks[sourceNode.id]?.data?.parentId ||
            (normalizedConnection.sourceHandle === 'loop-start-source' ||
            normalizedConnection.sourceHandle === 'parallel-start-source'
              ? normalizedConnection.source
              : undefined)
          const targetParentId = blocks[targetNode.id]?.data?.parentId

          // Generate a unique edge ID
          const edgeId = generateId()

          // Special case for container start source: Always allow connections to nodes within the same container
          if (
            (normalizedConnection.sourceHandle === 'loop-start-source' ||
              normalizedConnection.sourceHandle === 'parallel-start-source') &&
            blocks[targetNode.id]?.data?.parentId === sourceNode.id
          ) {
            // This is a connection from container start to a node inside the container - always allow

            addEdge({
              ...normalizedConnection,
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
            ...normalizedConnection,
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
      [addEdge, getNodes, blocks]
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
        window.removeEventListener('keydown', handleConnectionEscape, true)
        canvasContainerRef.current?.setAttribute('data-connection-line', 'default')
        canvasContainerRef.current?.setAttribute('data-connection-active', 'false')

        const source = connectionSourceRef.current
        if (!source?.nodeId || connectionCancelledRef.current) {
          connectionSourceRef.current = null
          return
        }

        // If onConnect already handled this connection, skip (handle-to-handle case)
        if (connectionCompletedRef.current) {
          connectionSourceRef.current = null
          return
        }

        // Find node under cursor using DOM hit-testing
        const clientPos = 'changedTouches' in event ? event.changedTouches[0] : event
        const targetNode = findNodeAtScreenPosition(clientPos.clientX, clientPos.clientY)
        const sourceHandle =
          normalizeCursorSourceHandleId(source.handleId, blocks[source.nodeId]?.type) ?? 'source'

        // Create connection if valid target found (handle-to-body case)
        if (targetNode && targetNode.id !== source.nodeId) {
          /*
           * Always source→target, and always onto the block's one input. Which
           * half of the card the drop landed on is not encoded in the handle
           * id: a second id for the same port would split edge identity, so
           * two drops on the same pair would persist as two overlapping edges
           * and neither the executor nor the copilot edit pipeline would
           * recognize the variant. Inputs never originate a drag either — the
           * `target` handle sets `isConnectableStart={false}`, so React Flow
           * only ever reports an output handle here.
           */
          onConnect({
            source: source.nodeId,
            sourceHandle,
            target: targetNode.id,
            targetHandle: WORKFLOW_TARGET_HANDLE_ID,
          })
        } else if (!targetNode) {
          const canvasBounds = canvasContainerRef.current?.getBoundingClientRect()
          const zoom = reactFlowInstance.getViewport().zoom
          const margin = 12
          const selectorWidth = CONNECTION_BLOCK_SELECTOR_DIMENSIONS.width * zoom
          const selectorHalfHeight = (CONNECTION_BLOCK_SELECTOR_DIMENSIONS.height * zoom) / 2
          const minScreenX = (canvasBounds?.left ?? 0) + margin
          const maxScreenX = (canvasBounds?.right ?? clientPos.clientX) - selectorWidth - margin
          const minScreenY = (canvasBounds?.top ?? 0) + selectorHalfHeight + margin
          const maxScreenY =
            (canvasBounds?.bottom ?? clientPos.clientY) - selectorHalfHeight - margin
          const position = screenToFlowPosition({
            x:
              maxScreenX >= minScreenX
                ? Math.min(Math.max(clientPos.clientX, minScreenX), maxScreenX)
                : clientPos.clientX,
            y:
              maxScreenY >= minScreenY
                ? Math.min(Math.max(clientPos.clientY, minScreenY), maxScreenY)
                : clientPos.clientY,
          })
          hasPointerDownSinceSelectorOpenedRef.current = false
          const nextPendingConnect: PendingConnect = {
            source: { nodeId: source.nodeId, handleId: sourceHandle },
            position,
          }
          setPendingConnect(nextPendingConnect)
          requestAnimationFrame(() => {
            const { zoom: currentZoom } = reactFlowInstance.getViewport()
            void reactFlowInstance.setCenter(
              nextPendingConnect.position.x + CONNECTION_BLOCK_SELECTOR_DIMENSIONS.width / 2,
              nextPendingConnect.position.y,
              {
                zoom: currentZoom,
                duration: CONNECTION_BLOCK_SELECTOR_FOCUS_DURATION_MS,
              }
            )
          })
        }

        connectionSourceRef.current = null
      },
      [
        findNodeAtScreenPosition,
        onConnect,
        blocks,
        reactFlowInstance,
        screenToFlowPosition,
        handleConnectionEscape,
      ]
    )

    /** Handles node drag to detect container intersections and update highlighting. */
    const onNodeDrag = useCallback(
      (_event: React.MouseEvent, node: any) => {
        if (node.id === CONNECTION_BLOCK_SELECTOR_NODE_ID) return

        // Note: We don't emit position updates during drag to avoid flooding socket events.
        // The final position is sent in onNodeDragStop for collaborative updates.

        // Get the current parent ID of the node being dragged
        const currentParentId = blocks[node.id]?.data?.parentId || null

        // If the node is inside a container, update container dimensions during drag
        if (currentParentId) {
          updateContainerDimensionsDuringMove(node.id, node.position)
        }

        // Embedded (mship panel) canvases allow repositioning but never
        // re-parenting: skip container-intersection detection so a drag over a
        // subflow neither highlights it nor arms potentialParentId. Both drag-stop
        // paths bail when potentialParentId still equals the drag-start parent, so
        // positions persist but a block can never be inserted into (or pulled out
        // of) a loop/parallel from the embedded view.
        if (embedded) return

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
                : getRegularBlockWidth(node.type ?? '')

            const nodeHeight =
              node.type === 'subflowNode'
                ? node.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
                : node.type === 'noteBlock'
                  ? node.height || getNoteBlockHeight(true)
                  : Math.max(
                      node.height || BLOCK_DIMENSIONS.MIN_HEIGHT,
                      BLOCK_DIMENSIONS.MIN_HEIGHT
                    )

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

          // Exclude containers that are inside the dragged node (would create a cycle)
          const validContainers = sortedContainers.filter(
            ({ container }) => !isDescendantOf(node.id, container.id)
          )

          // Use the most appropriate container (deepest or smallest at same depth)
          const bestContainerMatch = validContainers[0]

          if (bestContainerMatch) {
            setPotentialParentId(bestContainerMatch.container.id)

            if (
              !shouldHighlightContainerDropTarget(currentParentId, bestContainerMatch.container.id)
            ) {
              clearDragHighlights()
            } else {
              const kind = (bestContainerMatch.container.data as SubflowNodeData)?.kind
              if (kind === 'loop' || kind === 'parallel') {
                highlightContainerNode(bestContainerMatch.container.id)
              }
            }
          } else {
            clearDragHighlights()
            setPotentialParentId(null)
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
        embedded,
        getNodeAbsolutePosition,
        getNodeDepth,
        isDescendantOf,
        updateContainerDimensionsDuringMove,
        highlightContainerNode,
      ]
    )

    /** Captures initial parent ID and position when drag starts. */
    const onNodeDragStart = useCallback(
      (_event: React.MouseEvent, node: any) => {
        if (node.id === CONNECTION_BLOCK_SELECTOR_NODE_ID) return

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

        // Capture all selected nodes' positions for multi-node undo/redo.
        // Also include the dragged node itself — during shift+click+drag, ReactFlow
        // may have toggled (deselected) the node before drag starts, so it might not
        // appear in the selected set yet.
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
        if (!multiNodeDragStartRef.current.has(node.id)) {
          multiNodeDragStartRef.current.set(node.id, {
            x: node.position.x,
            y: node.position.y,
            parentId: currentParentId ?? undefined,
          })
        }

        // When shift+clicking an already-selected node, ReactFlow toggles (deselects)
        // it via onNodesChange before drag starts. Re-select the dragged node so all
        // previously selected nodes move together as a group — but only if the
        // deselection wasn't from a parent-child conflict (e.g. dragging a child
        // when its parent subflow is selected).
        const draggedNodeInSelected = allNodes.find((n) => n.id === node.id)
        if (draggedNodeInSelected && !draggedNodeInSelected.selected && selectedNodes.length > 0) {
          const draggedParentId = blocks[node.id]?.data?.parentId
          const parentIsSelected =
            draggedParentId && selectedNodes.some((n) => n.id === draggedParentId)
          const contextMismatch =
            getNodeSelectionContextId(draggedNodeInSelected, blocks) !==
            getNodeSelectionContextId(selectedNodes[0], blocks)
          if (!parentIsSelected && !contextMismatch) {
            setDisplayNodes((currentNodes) =>
              currentNodes.map((n) => (n.id === node.id ? { ...n, selected: true } : n))
            )
          }
        }
      },
      [blocks, setDragStartPosition, getNodes, setPotentialParentId]
    )

    /** Handles node drag stop to establish parent-child relationships. */
    const onNodeDragStop = useCallback(
      (_event: React.MouseEvent, node: any) => {
        if (node.id === CONNECTION_BLOCK_SELECTOR_NODE_ID) return

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

          // Only reparent when an actual drag changed the target container.
          // onNodeDragStart sets both potentialParentId and dragStartParentId to the
          // clicked node's current parent; they only diverge when onNodeDrag detects
          // the selection being dragged over a different container.
          if (potentialParentId !== dragStartParentId) {
            executeBatchParentUpdate(
              selectedNodes,
              potentialParentId,
              'Batch moved nodes to new parent'
            )
          }

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
          toast({ message: 'Cannot move locked blocks out of locked containers' })
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
            toast.error('Triggers cannot be placed inside loop or parallel subflows.')
            logger.warn('Prevented trigger block from being placed inside a container', {
              blockId: node.id,
              blockType: block.type,
              attemptedParentId: potentialParentId,
            })
            setPotentialParentId(null)
            return
          }
        }

        // Prevent placing a container inside one of its own nested containers (would create cycle)
        if (potentialParentId && isDescendantOf(node.id, potentialParentId)) {
          toast({
            message: 'Cannot place a container inside one of its own nested containers',
          })
          setPotentialParentId(null)
          return
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

          // Computed BEFORE updating the parent to avoid stale state. The two
          // absolutes share the container's coordinate space, so their
          // difference is the child's position within it — which is what the
          // sibling positions this is compared against are measured in too.
          const containerAbsPosBefore = getNodeAbsolutePosition(potentialParentId)
          const nodeAbsPosBefore = getNodeAbsolutePosition(node.id)

          const relativePositionBefore = {
            x: nodeAbsPosBefore.x - containerAbsPosBefore.x,
            y: nodeAbsPosBefore.y - containerAbsPosBefore.y,
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
        isDescendantOf,
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
        setDisplayNodes((allNodes) => resolveSelectionConflicts(allNodes, blocks))
      },
      [blocks]
    )

    /** Handles selection drag to detect potential parent containers for batch drops. */
    const onSelectionDrag = useCallback(
      (_event: React.MouseEvent, nodes: Node[]) => {
        if (nodes.length === 0) return

        // Filter out nodes that can't be placed in containers
        const eligibleNodes = nodes.filter(canNodeEnterContainer)
        const currentParentIds = new Set(
          eligibleNodes.map((node) => blocks[node.id]?.data?.parentId ?? null)
        )
        const sharedCurrentParentId =
          currentParentIds.size === 1 ? currentParentIds.values().next().value : null

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
          const width = getRegularBlockWidth(node.type ?? '')
          const height =
            node.type === 'noteBlock'
              ? node.height || getNoteBlockHeight(true)
              : Math.max(node.height || BLOCK_DIMENSIONS.MIN_HEIGHT, BLOCK_DIMENSIONS.MIN_HEIGHT)

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
          const shouldHighlightContainer = shouldHighlightContainerDropTarget(
            sharedCurrentParentId,
            bestMatch.container.id
          )

          if (bestMatch.container.id !== potentialParentId) {
            setPotentialParentId(bestMatch.container.id)

            if (shouldHighlightContainer) {
              const kind = (bestMatch.container.data as SubflowNodeData)?.kind
              if (kind === 'loop' || kind === 'parallel') {
                highlightContainerNode(bestMatch.container.id)
              }
            }
          }
          if (!shouldHighlightContainer) clearDragHighlights()
        } else if (potentialParentId) {
          clearDragHighlights()
          setPotentialParentId(null)
        }
      },
      [
        canNodeEnterContainer,
        blocks,
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
      if (pendingConnect && hasPointerDownSinceSelectorOpenedRef.current) {
        closeConnectionBlockSelector()
      }
    }, [closeConnectionBlockSelector, pendingConnect])

    const handleCanvasPointerDownCapture = () => {
      if (pendingConnect) {
        hasPointerDownSinceSelectorOpenedRef.current = true
      }
    }

    /**
     * Animates the camera so the given block centers in the canvas frame.
     * Regular cards defer by two frames and retain close zoom. Subflows wait
     * for the editor panel layout to settle, then fit the full container into
     * the centered canvas frame so large loops are not cropped.
     */
    const focusBlockInView = useCallback(
      (node: Node, onFocusStart?: () => void, durationMs = 500) => {
        const centerNode = () => {
          const currentNodes = getNodes()
          const mountedNode = currentNodes.find((candidate) => candidate.id === node.id) ?? node
          const getAbsolutePosition = (candidate: Node) =>
            candidate.parentId
              ? (candidate.positionAbsolute ?? getNodeAbsolutePosition(candidate.id))
              : candidate.position
          const getFocusDimensions = (candidate: Node) => {
            const subflowData =
              candidate.type === 'subflowNode' ? (candidate.data as SubflowNodeData) : undefined
            const declaredWidth = subflowData?.width
            const declaredHeight = subflowData?.height
            const width =
              typeof declaredWidth === 'number' && declaredWidth > 0
                ? declaredWidth
                : typeof candidate.width === 'number' && candidate.width > 0
                  ? candidate.width
                  : candidate.type === 'subflowNode'
                    ? CONTAINER_DIMENSIONS.DEFAULT_WIDTH
                    : 250
            const height =
              typeof declaredHeight === 'number' && declaredHeight > 0
                ? declaredHeight
                : typeof candidate.height === 'number' && candidate.height > 0
                  ? candidate.height
                  : candidate.type === 'subflowNode'
                    ? CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
                    : 100
            return { width, height }
          }

          if (mountedNode.type === 'subflowNode') {
            const focusCandidates = currentNodes.some(
              (candidate) => candidate.id === mountedNode.id
            )
              ? currentNodes
              : [...currentNodes, mountedNode]
            const nodesById = new Map(focusCandidates.map((candidate) => [candidate.id, candidate]))
            const focusNodes = focusCandidates
              .filter((candidate) => {
                let currentId: string | undefined = candidate.id
                const visitedIds = new Set<string>()
                while (currentId && !visitedIds.has(currentId)) {
                  if (currentId === mountedNode.id) return true
                  visitedIds.add(currentId)
                  currentId = nodesById.get(currentId)?.parentId
                }
                return false
              })
              .map((candidate) => ({
                ...candidate,
                position: getAbsolutePosition(candidate),
                ...getFocusDimensions(candidate),
              }))

            fitViewToBounds({
              nodes: focusNodes,
              padding: SUBFLOW_FOCUS_PADDING,
              maxZoom: 1,
              minZoom: 0.1,
              duration: durationMs,
            })
            onFocusStart?.()
            return
          }

          const position = getAbsolutePosition(mountedNode)
          const { width: nodeWidth, height: nodeHeight } = getFocusDimensions(mountedNode)
          const currentZoom = reactFlowInstance.getViewport().zoom
          const targetZoom = Math.max(currentZoom, 1)
          reactFlowInstance.setCenter(position.x + nodeWidth / 2, position.y + nodeHeight / 2, {
            zoom: targetZoom,
            duration: durationMs,
          })
          onFocusStart?.()
        }

        if (node.type !== 'subflowNode') {
          requestAnimationFrame(() => requestAnimationFrame(centerNode))
          return
        }

        let previousWidth = canvasContainerRef.current?.getBoundingClientRect().width
        let stableFrames = 0
        let elapsedFrames = 0
        let remainingFrames = SUBFLOW_FOCUS_MAX_WAIT_FRAMES

        const waitForSettledCanvas = () => {
          requestAnimationFrame(() => {
            const currentWidth = canvasContainerRef.current?.getBoundingClientRect().width
            if (
              currentWidth !== undefined &&
              previousWidth !== undefined &&
              Math.abs(currentWidth - previousWidth) <= SUBFLOW_FOCUS_LAYOUT_TOLERANCE_PX
            ) {
              stableFrames += 1
            } else {
              stableFrames = 0
            }

            previousWidth = currentWidth
            elapsedFrames += 1
            remainingFrames -= 1
            if (
              (elapsedFrames >= SUBFLOW_FOCUS_MIN_WAIT_FRAMES &&
                stableFrames >= SUBFLOW_FOCUS_STABLE_FRAMES) ||
              remainingFrames <= 0
            ) {
              centerNode()
              return
            }
            waitForSettledCanvas()
          })
        }

        waitForSettledCanvas()
      },
      [fitViewToBounds, getNodeAbsolutePosition, getNodes, reactFlowInstance]
    )

    /**
     * Centers a newly created block once its node has mounted and been
     * measured. A card added from a drag-release, the block menu, or the
     * toolbar can land outside the viewport (or under the editor panel), so
     * the camera follows it the same way it follows a click.
     *
     * Waits for real dimensions: `focusBlockInView` centers on the card's
     * midpoint, and an unmeasured node reports no size, which would center the
     * camera on its top-left corner instead.
     */
    useEffect(() => {
      const pendingId = pendingFocusBlockIdRef.current
      if (!pendingId) return

      const node = displayNodes.find((candidate) => candidate.id === pendingId)
      if (!node) return
      if (
        typeof node.width !== 'number' ||
        typeof node.height !== 'number' ||
        node.width <= 0 ||
        node.height <= 0
      ) {
        return
      }

      pendingFocusBlockIdRef.current = null
      if (embedded) return
      focusBlockInView(node)
    }, [displayNodes, embedded, focusBlockInView])

    /**
     * Handles node click to select the node in ReactFlow.
     * Uses the controlled display node state so parent-child conflicts are resolved
     * consistently for click, shift-click, and marquee selection.
     */
    const handleNodeClick = useCallback(
      (event: React.MouseEvent, node: Node) => {
        const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey

        // Ignore shift-clicks on nodes at a different nesting level
        if (isMultiSelect) {
          const clickedContext = getNodeSelectionContextId(node, blocks)
          const currentlySelected = getNodes().filter((n) => n.selected)
          if (currentlySelected.length > 0) {
            const selectionContext = getNodeSelectionContextId(currentlySelected[0], blocks)
            if (clickedContext !== selectionContext) {
              usePanelEditorStore.getState().clearCurrentBlock()
              return
            }
          }
        }

        setDisplayNodes((currentNodes) => {
          const updated = currentNodes.map((currentNode) => ({
            ...currentNode,
            selected: isMultiSelect
              ? currentNode.id === node.id
                ? true
                : currentNode.selected
              : currentNode.id === node.id,
          }))
          return resolveSelectionConflicts(updated, blocks, isMultiSelect ? node.id : undefined)
        })

        /**
         * Focus the clicked block: animate the camera so the card centers in
         * the canvas frame. Plain clicks focus both regular cards and subflow
         * containers; multi-select keeps the camera still. Users who would
         * rather keep their own framing turn auto-focus off in general
         * settings. onNodeClick never fires after a drag.
         */
        if (
          !embedded &&
          !isMultiSelect &&
          (node.type === 'workflowBlock' ||
            node.type === 'noteBlock' ||
            node.type === 'subflowNode')
        ) {
          /**
           * Marked whether or not the camera moves: with auto-focus on the
           * click reframes the canvas, and with it off the click is the user
           * deliberately keeping the framing they already have. Either way a
           * later canvas re-init must not `fitView` over it.
           */
          userFocusedWorkflowIdRef.current = activeWorkflowId ?? workflowIdParam
          if (isAutoFocusOnClickEnabled) {
            focusBlockInView(node)
          }
        }
      },
      [
        activeWorkflowId,
        blocks,
        getNodes,
        embedded,
        focusBlockInView,
        isAutoFocusOnClickEnabled,
        workflowIdParam,
      ]
    )

    /**
     * Arrow-key navigation: with a single block selected, Right/Down moves to
     * the next block in canvas reading order (left-to-right, top-to-bottom)
     * and Left/Up to the previous, wrapping at the ends. Selection, the
     * editor panel, and the camera focus all follow. Skipped while typing in
     * inputs/editors or interacting with menus, and in embedded mode.
     */
    useEffect(() => {
      if (embedded) return

      const handleArrowNavigation = (event: KeyboardEvent) => {
        const direction = getArrowNavigationDirection(event)
        if (direction === null) return

        const target = event.target as HTMLElement | null
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable ||
            target.closest(
              '[contenteditable="true"], [role="listbox"], [role="menu"], [role="combobox"], .cm-editor'
            ))
        ) {
          return
        }

        const workflowNodes = getNodes().filter((n) => n.type === 'workflowBlock')
        const selected = workflowNodes.filter((n) => n.selected)
        if (selected.length !== 1 || workflowNodes.length < 2) return

        const ordered = [...workflowNodes].sort((a, b) => {
          const pa = a.positionAbsolute ?? a.position
          const pb = b.positionAbsolute ?? b.position
          return pa.x - pb.x || pa.y - pb.y
        })
        const currentIndex = ordered.findIndex((n) => n.id === selected[0].id)
        if (currentIndex === -1) return

        event.preventDefault()
        event.stopPropagation()

        const nextNode = ordered[(currentIndex + direction + ordered.length) % ordered.length]

        setDisplayNodes((currentNodes) =>
          resolveSelectionConflicts(
            currentNodes.map((currentNode) => ({
              ...currentNode,
              selected: currentNode.id === nextNode.id,
            })),
            blocks
          )
        )
        usePanelEditorStore.getState().setCurrentBlockId(nextNode.id)
        focusBlockInView(nextNode)
      }

      window.addEventListener('keydown', handleArrowNavigation, true)
      return () => window.removeEventListener('keydown', handleArrowNavigation, true)
    }, [embedded, getNodes, blocks, focusBlockInView])

    /**
     * Brings a Note holding the current search match onto the canvas.
     *
     * Every other block answers a search through the editor panel, which scrolls
     * the matching field into view for free. A Note renders nothing there — the
     * card itself is the surface — so the camera has to do that job here, and
     * the card has to be selected before it will hold a scroll position deep in
     * its own body rather than snapping back to the top.
     *
     * Keyed on the match rather than the block, so cycling between two matches
     * in one Note re-asserts a camera that is already where it needs to be
     * (visually inert) instead of stranding the second match off-screen after
     * the user has panned away. Matches on every other kind of block are marked
     * handled and otherwise left alone — without that, walking away to a block
     * match and back to a Note one would read as the same match twice and skip
     * the camera the second time.
     *
     * Also covers a match on the Note's *name*, which the card cannot underline
     * but which at least lands the user on the right card.
     *
     * Subscribed as two ids and NEVER as the target object. The search panel
     * renders inside this component and re-publishes an equal target on most of
     * its own renders (its hydration hooks hand back fresh arrays), so holding
     * the object here re-renders the panel, whose effect re-publishes, which
     * re-renders it again — an unbounded update loop the moment a search opens.
     * Two string selectors are compared by value, so a re-publish of the same
     * match is inert.
     */
    const searchMatchId = usePanelEditorSearchStore(
      (state) => state.activeSearchTarget?.matchId ?? null
    )
    const searchMatchBlockId = usePanelEditorSearchStore(
      (state) => state.activeSearchTarget?.blockId ?? null
    )
    const focusedSearchMatchIdRef = useRef<string | null>(null)
    useEffect(() => {
      if (embedded) return
      if (!searchMatchId || !searchMatchBlockId) {
        focusedSearchMatchIdRef.current = null
        return
      }
      if (searchMatchId === focusedSearchMatchIdRef.current) return

      if (blocks[searchMatchBlockId]?.type !== 'note') {
        focusedSearchMatchIdRef.current = searchMatchId
        return
      }

      /* Read from `displayNodes` rather than `getNodes()` so a match that
         arrives before its node has mounted is retried on the commit that
         mounts it, instead of being dropped. */
      const node = displayNodes.find((candidate) => candidate.id === searchMatchBlockId)
      if (!node) return

      focusedSearchMatchIdRef.current = searchMatchId
      setDisplayNodes((currentNodes) =>
        resolveSelectionConflicts(
          currentNodes.map((currentNode) => ({
            ...currentNode,
            selected: currentNode.id === node.id,
          })),
          blocks
        )
      )
      focusBlockInView(node)
    }, [blocks, displayNodes, embedded, focusBlockInView, searchMatchBlockId, searchMatchId])

    /**
     * Inbound `?block=` target, held until the canvas can act on it. State rather than a ref
     * because the effect below has to re-run on the commit that finally mounts the node.
     */
    const [deepLinkBlockId, setDeepLinkBlockId] = useState<string | null>(null)

    useEffect(() => {
      if (embedded || !deepLinkBlockId) return

      /* Same reason as the note reveal above: read from `displayNodes` so a target that lands
         before its node mounts is retried on the mounting commit instead of dropped. */
      const node = displayNodes.find((candidate) => candidate.id === deepLinkBlockId)
      if (!node) {
        /* Absent is only conclusive once THIS workflow's graph is the one loaded. `isWorkflowReady`
           is that test — it pins `hydration.workflowId` and `activeWorkflowId` to the id in the
           URL — where a count of mounted nodes is not: arriving from another workflow, the store
           still holds that graph, so nodes are present while the linked workflow is still
           hydrating and a valid target would be thrown away.

           Releasing it matters because the param is already stripped: a target held forever would
           re-check on every canvas update and shadow a later link to the same block. Dropping it
           leaves the default framing, which is what the link did before it carried a target. */
        if (isWorkflowReady) setDeepLinkBlockId(null)
        return
      }

      setDeepLinkBlockId(null)

      /* Claim the framing before the canvas can re-init over it. `onInit` re-reads this ref
         inside its own `requestAnimationFrame`, so setting it here suppresses the initial
         `fitView` whenever this effect wins the race — and is harmless when it does not, since
         `focusBlockInView` animates from wherever the fit left the camera. */
      userFocusedWorkflowIdRef.current = activeWorkflowId ?? workflowIdParam

      setDisplayNodes((currentNodes) =>
        resolveSelectionConflicts(
          currentNodes.map((currentNode) => ({
            ...currentNode,
            selected: currentNode.id === node.id,
          })),
          blocks
        )
      )
      focusBlockInView(node)
    }, [
      activeWorkflowId,
      blocks,
      deepLinkBlockId,
      displayNodes,
      embedded,
      focusBlockInView,
      isWorkflowReady,
      workflowIdParam,
    ])

    const latestEdgesRef = useRef(edges)
    latestEdgesRef.current = edges
    const latestBlocksRef = useRef(blocks)
    latestBlocksRef.current = blocks
    /** Stable delete handler to avoid creating new function references per edge. */
    const handleEdgeDelete = useCallback(
      (edgeId: string) => {
        if (!effectivePermissions.canEdit) return

        // Prevent removing edges targeting protected blocks
        const edge = latestEdgesRef.current.find((candidate) => candidate.id === edgeId)
        if (edge && isEdgeProtected(edge, latestBlocksRef.current)) {
          toast({ message: 'Cannot remove connections to locked blocks' })
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
      [effectivePermissions.canEdit, removeEdge]
    )

    /*
     * Lifts a card off the baseline it was built with: +1 for the last
     * interacted card so it stays above its siblings until another is touched,
     * +10 while selected. A card inside a container takes the same steps from
     * its own higher baseline.
     *
     * Subflow containers are skipped: their depth-based zIndex is what orders
     * them against their own children, and bumping it would break that.
     */
    const nodesForRender = useMemo(() => {
      const elevatedNodes = displayNodes.map((node) => {
        if (node.type === 'subflowNode') return node
        const target = getBlockZIndex(node.zIndex ?? BLOCK_Z_BASE, {
          isSelected: node.selected,
          isLastInteracted: node.id === lastInteractedNodeId,
        })
        if (target === node.zIndex) return node
        return { ...node, zIndex: target }
      })

      if (!pendingConnect) return elevatedNodes

      return [
        ...elevatedNodes,
        {
          id: CONNECTION_BLOCK_SELECTOR_NODE_ID,
          type: 'connectionBlockSelector',
          position: {
            x: pendingConnect.position.x,
            y: pendingConnect.position.y - CONNECTION_BLOCK_SELECTOR_DIMENSIONS.height / 2,
          },
          data: {
            pendingConnect,
            onClose: closeConnectionBlockSelector,
          },
          width: CONNECTION_BLOCK_SELECTOR_DIMENSIONS.width,
          height: CONNECTION_BLOCK_SELECTOR_DIMENSIONS.height,
          zIndex: CONNECTION_PICKER_Z,
          dragHandle: '.workflow-drag-handle',
          draggable: true,
          selectable: false,
          connectable: false,
          deletable: false,
          focusable: false,
        } satisfies Node<ConnectionBlockSelectorData>,
      ]
    }, [closeConnectionBlockSelector, displayNodes, lastInteractedNodeId, pendingConnect])

    /** Transforms edges to include selection state and delete handlers. Memoized to prevent re-renders. */
    /* Subscribed rather than read from `getState()`: the edge z below depends on
       which block is open, so the memo has to re-run when that changes. */
    const editorOpenBlockId = usePanelEditorStore((state) => state.currentBlockId)
    const panelActiveTab = usePanelStore((state) => state.activeTab)

    const previousEdgesWithSelectionRef = useRef<Edge[]>([])
    const edgesWithSelection = useMemo(() => {
      const nodeMap = new Map(displayNodes.map((n) => [n.id, n]))
      /* Indexed once: this memo re-runs on every drag frame, and scanning the
         selection array twice per edge is O(edges x selection) per frame. */
      const selectedNodeIdSet = new Set(selectedNodeIds)

      const derivedEdges = edgesForDisplay.map((edge) => {
        const sourceNode = nodeMap.get(edge.source)
        const targetNode = nodeMap.get(edge.target)
        const parentLoopId = sourceNode?.parentId || targetNode?.parentId
        const edgeContextId = getEdgeSelectionMapKey(edge, displayNodes, blocks)

        // Ordered within the edge band by its container's depth, so an edge is
        // always above the container body it crosses (which is opaque, and takes
        // pointer events, so the edge has to be above it to stay clickable) and
        // still below that container's own children.
        //
        // A highlighted edge takes the top of that band instead, so no ordinary
        // edge can cross over the one the user has picked out. Depth only ever
        // ordered lines against each other, and an unselected edge one level
        // deeper was painting straight through the highlight.
        //
        // Edges are NEVER elevated above cards — not even when an endpoint is
        // selected. A line always passes behind cards, knobs, and the action
        // bar swell; elevating highlighted edges drew them across their own
        // endpoint's chrome. The highlighted tier stays inside the band for
        // exactly that reason.
        const containerNode = parentLoopId ? nodeMap.get(parentLoopId) : null
        const isConnectedToSelection =
          selectedNodeIdSet.has(edge.source) || selectedNodeIdSet.has(edge.target)
        const isSelected = selectedEdges.has(edgeContextId)
        const baseZIndex = getEdgeZIndex(containerNode ? (containerNode.zIndex ?? 0) : undefined, {
          isHighlighted: isEdgeHighlighted({
            isEndpointSelected: isConnectedToSelection,
            isConnectedToEditor: isEdgeConnectedToEditor(
              panelActiveTab === 'editor' ? editorOpenBlockId : null,
              edge.source,
              edge.target
            ),
            isEdgeSelected: isSelected,
          }),
        })
        const targetContainerZIndex =
          targetNode?.type === 'subflowNode' ? (targetNode.zIndex ?? 0) : undefined
        // The target node paints after an equal-z edge. A nested container is
        // one depth above its parent, so this hides only the segment beneath
        // the target while leaving the route visible over the parent body.
        const zIndex = getEdgeZIndexForTarget(baseZIndex, targetContainerZIndex)

        return {
          ...edge,
          selected: isSelected,
          zIndex,
          data: {
            ...edge.data,
            isSelected,
            isConnectedToSelection,
            isInsideLoop: Boolean(parentLoopId),
            parentLoopId,
            sourceHandle: edge.sourceHandle,
            ...(effectivePermissions.canEdit ? { onDelete: handleEdgeDelete } : {}),
            ...(targetContainerZIndex !== undefined ? { labelZIndex: zIndex } : {}),
          },
        }
      })
      /* Deliberately impure: referential stability across renders needs the
         previous result, and no state-shaped alternative exists. Safe because
         reconciliation is idempotent — re-running it on its own output returns
         that output by reference, so a discarded render cannot corrupt it. */
      const reconciledEdges = reconcileCanvasEdges(
        previousEdgesWithSelectionRef.current,
        derivedEdges
      )
      previousEdgesWithSelectionRef.current = reconciledEdges
      return reconciledEdges
    }, [
      edgesForDisplay,
      displayNodes,
      selectedNodeIds,
      selectedEdges,
      effectivePermissions.canEdit,
      handleEdgeDelete,
      editorOpenBlockId,
      panelActiveTab,
    ])

    const edgesForRender = useMemo(() => {
      if (!pendingConnect) return edgesWithSelection

      const sourceParentId = blocks[pendingConnect.source.nodeId]?.data?.parentId
      const sourceParentNode = sourceParentId
        ? displayNodes.find((node) => node.id === sourceParentId)
        : null

      return [
        ...edgesWithSelection,
        {
          id: `${CONNECTION_BLOCK_SELECTOR_NODE_ID}-edge`,
          source: pendingConnect.source.nodeId,
          sourceHandle: pendingConnect.source.handleId,
          target: CONNECTION_BLOCK_SELECTOR_NODE_ID,
          targetHandle: 'target',
          type: 'workflowEdge',
          /* Rendered highlighted (`isConnectedToSelection` below), so it is
             elevated like any other highlighted edge — the preview line is the
             one the user is currently drawing. */
          zIndex: getEdgeZIndex(sourceParentNode ? (sourceParentNode.zIndex ?? 0) : undefined, {
            isHighlighted: true,
          }),
          focusable: false,
          deletable: false,
          reconnectable: false,
          data: {
            isConnectedToSelection: true,
            sourceHandle: pendingConnect.source.handleId,
          },
        } satisfies Edge,
      ]
    }, [blocks, displayNodes, edgesWithSelection, pendingConnect])

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
          event.preventDefault()
          if (!effectivePermissions.canEdit) return

          // Get all selected edge IDs and filter out edges targeting protected blocks
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
            toast({
              message: 'Cannot delete locked blocks or blocks inside locked containers',
            })
            return
          }
          toast({ message: `Skipped ${protectedIds.length} protected block(s)` })
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
    ])

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
    }, [embedded, isWorkflowReady, scheduleEmbeddedFit])

    useEffect(() => {
      if (!embedded || !isWorkflowReady) {
        return
      }

      scheduleEmbeddedFit()
    }, [blocksStructureHash, embedded, isWorkflowReady, scheduleEmbeddedFit])

    return (
      <div className='flex h-full w-full overflow-hidden'>
        <div className='flex min-w-0 flex-1 flex-col'>
          <div
            ref={canvasContainerRef}
            onPointerDownCapture={handleCanvasPointerDownCapture}
            /* The in-flight line reads `--text-secondary`, not the `--workflow-edge`
               grey a resting edge uses: it has to stay legible over a subflow body
               as well as the canvas, and that grey is ~1.1:1 against one. */
            className='relative flex-1 overflow-hidden [--connection-line-stroke:var(--text-secondary)] data-[connection-line=error]:[--connection-line-stroke:var(--text-error)] data-[connection-active=true]:[&_.react-flow__handle.source]:pointer-events-none'
          >
            {!isWorkflowReady && (
              <div className='absolute inset-0 z-[5] flex items-center justify-center bg-[var(--bg)]'>
                <div
                  className='size-[18px] animate-spin rounded-full'
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
                  edges={edgesForRender}
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
                  onDrop={
                    effectivePermissions.canEdit
                      ? onDrop
                      : workflowReadOnly
                        ? onDropLocked
                        : undefined
                  }
                  onDragOver={
                    effectivePermissions.canEdit || workflowReadOnly ? onDragOver : undefined
                  }
                  onInit={(instance) => {
                    if (embedded) {
                      return
                    }

                    const viewportWorkflowId = activeWorkflowId ?? workflowIdParam
                    if (
                      initializedViewportWorkflowIdRef.current === viewportWorkflowId ||
                      userFocusedWorkflowIdRef.current === viewportWorkflowId
                    ) {
                      setIsCanvasReady(true)
                      return
                    }
                    initializedViewportWorkflowIdRef.current = viewportWorkflowId

                    requestAnimationFrame(() => {
                      if (userFocusedWorkflowIdRef.current === viewportWorkflowId) {
                        setIsCanvasReady(true)
                        return
                      }
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
                  connectionLineStyle={CONNECTION_LINE_STYLE}
                  connectionLineContainerStyle={CONNECTION_LINE_CONTAINER_STYLE}
                  connectionLineType={ConnectionLineType.SmoothStep}
                  onPaneClick={onPaneClick}
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
                  connectOnClick={false}
                  nodesDraggable={!embedded && effectivePermissions.canEdit}
                  draggable={false}
                  noWheelClassName='allow-scroll'
                  edgesFocusable={!embedded}
                  edgesUpdatable={!embedded && effectivePermissions.canEdit}
                  className={`workflow-container h-full bg-[var(--bg)] transition-opacity duration-150 ${reactFlowStyles} ${canvasOpacityClass} ${isHandMode ? 'canvas-mode-hand' : 'canvas-mode-cursor'}`}
                  onNodeDrag={effectivePermissions.canEdit ? onNodeDrag : undefined}
                  onNodeDragStop={
                    !embedded && effectivePermissions.canEdit ? onNodeDragStop : undefined
                  }
                  onSelectionDragStart={
                    effectivePermissions.canEdit ? onSelectionDragStart : undefined
                  }
                  onSelectionDrag={effectivePermissions.canEdit ? onSelectionDrag : undefined}
                  onSelectionDragStop={
                    effectivePermissions.canEdit ? onSelectionDragStop : undefined
                  }
                  onNodeDragStart={
                    !embedded && effectivePermissions.canEdit ? onNodeDragStart : undefined
                  }
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
                    {/* Renders nothing; the boundary is what `useSearchParams` needs. */}
                    <Suspense fallback={null}>
                      <FocusBlockDeepLink onTarget={setDeepLinkBlockId} />
                    </Suspense>
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
                      onCut={handleContextCut}
                      onPaste={handleContextPaste}
                      onDuplicate={handleContextDuplicate}
                      onDelete={handleContextDelete}
                      onToggleEnabled={handleContextToggleEnabled}
                      onRemoveFromSubflow={handleContextRemoveFromSubflow}
                      onOpenEditor={handleContextOpenEditor}
                      onRename={handleContextRename}
                      onAddImage={handleContextAddImage}
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
                        isPositionalTriggerBlock(contextMenuBlocks[0], edges)
                      }
                      onToggleLocked={handleContextToggleLocked}
                      canAdmin={effectivePermissions.canAdmin && !workflowReadOnly}
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
                      onOpenSearchReplace={handleContextOpenSearchReplace}
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
                      canAdmin={effectivePermissions.canAdmin && !workflowReadOnly}
                      hasBlocks={hasBlocks}
                    />
                  </>
                )}
              </>
            )}

            {!embedded && <WorkflowSearchReplace />}

            {!embedded && isWorkflowReady && isWorkflowEmpty && effectivePermissions.canEdit && (
              <CommandList />
            )}

            {!embedded && <DiffControls />}
          </div>

          <Terminal />
        </div>

        {!embedded && <Panel />}

        {!embedded && oauthModal && (
          <ConnectOAuthModal
            mode='reauthorize'
            open={true}
            onOpenChange={(open) => {
              if (!open) {
                consumeOAuthReturnContext()
                setOauthModal(null)
              }
            }}
            provider={oauthModal.provider}
            toolName={oauthModal.providerName}
            serviceId={oauthModal.serviceId}
            requiredScopes={oauthModal.requiredScopes}
            newScopes={oauthModal.newScopes}
          />
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
}

/** Workflow page with ReactFlowProvider and error boundary wrapper. */
const Workflow = React.memo(({ workspaceId, workflowId, embedded }: WorkflowProps = {}) => {
  return (
    <ReactFlowProvider>
      <ErrorBoundary>
        <WorkflowContent workspaceId={workspaceId} workflowId={workflowId} embedded={embedded} />
      </ErrorBoundary>
    </ReactFlowProvider>
  )
})

Workflow.displayName = 'Workflow'

export default Workflow
