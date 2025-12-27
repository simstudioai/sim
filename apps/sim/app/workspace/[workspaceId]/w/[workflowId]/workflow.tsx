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
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { createLogger } from '@sim/logger'
import { useShallow } from 'zustand/react/shallow'
import type { OAuthConnectEventDetail } from '@/lib/copilot/tools/client/other/oauth-request-access'
import type { OAuthProvider } from '@/lib/oauth'
import { DEFAULT_HORIZONTAL_SPACING } from '@/lib/workflows/autolayout/constants'
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
import { Cursors } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/cursors/cursors'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error/index'
import { NoteBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block'
import type { SubflowNodeData } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { TrainingModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/training-modal/training-modal'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'
import {
  useAutoLayout,
  useCurrentWorkflow,
  useNodeUtilities,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  clampPositionToContainer,
  estimateBlockDimensions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-node-utilities'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { getBlock } from '@/blocks'
import { isAnnotationOnlyBlock } from '@/executor/constants'
import { useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useStreamCleanup } from '@/hooks/use-stream-cleanup'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { usePanelEditorStore } from '@/stores/panel/editor/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getUniqueBlockName } from '@/stores/workflows/utils'
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

/** Tailwind classes for ReactFlow internal element styling */
const reactFlowStyles = [
  // Z-index layering
  '[&_.react-flow__edges]:!z-0',
  '[&_.react-flow__node]:!z-[21]',
  '[&_.react-flow__handle]:!z-[30]',
  '[&_.react-flow__edge-labels]:!z-[60]',
  // Light mode: transparent pane to show dots
  '[&_.react-flow__pane]:!bg-transparent',
  '[&_.react-flow__renderer]:!bg-transparent',
  // Dark mode: solid background, hide dots
  'dark:[&_.react-flow__pane]:!bg-[var(--bg)]',
  'dark:[&_.react-flow__renderer]:!bg-[var(--bg)]',
  'dark:[&_.react-flow__background]:hidden',
].join(' ')
const reactFlowFitViewOptions = { padding: 0.6 } as const
const reactFlowProOptions = { hideAttribution: true } as const

interface SelectedEdgeInfo {
  id: string
  parentLoopId?: string
  contextId?: string
}

interface BlockData {
  id: string
  type: string
  position: { x: number; y: number }
  distance: number
}

/**
 * Main workflow canvas content component.
 * Renders the ReactFlow canvas with blocks, edges, and all interactive features.
 */
const WorkflowContent = React.memo(() => {
  const [isCanvasReady, setIsCanvasReady] = useState(false)
  const [potentialParentId, setPotentialParentId] = useState<string | null>(null)
  const [selectedEdgeInfo, setSelectedEdgeInfo] = useState<SelectedEdgeInfo | null>(null)
  const [isErrorConnectionDrag, setIsErrorConnectionDrag] = useState(false)
  const [oauthModal, setOauthModal] = useState<{
    provider: OAuthProvider
    serviceId: string
    providerName: string
    requiredScopes: string[]
    newScopes?: string[]
  } | null>(null)

  const params = useParams()
  const router = useRouter()
  const { screenToFlowPosition, getNodes, fitView, getIntersectingNodes } = useReactFlow()
  const { emitCursorUpdate } = useSocket()

  const workspaceId = params.workspaceId as string
  const workflowIdParam = params.workflowId as string

  const addNotification = useNotificationStore((state) => state.addNotification)

  const { workflows, activeWorkflowId, hydration, setActiveWorkflow } = useWorkflowRegistry(
    useShallow((state) => ({
      workflows: state.workflows,
      activeWorkflowId: state.activeWorkflowId,
      hydration: state.hydration,
      setActiveWorkflow: state.setActiveWorkflow,
    }))
  )

  const currentWorkflow = useCurrentWorkflow()

  const { updateNodeDimensions, setDragStartPosition, getDragStartPosition } = useWorkflowStore(
    useShallow((state) => ({
      updateNodeDimensions: state.updateNodeDimensions,
      setDragStartPosition: state.setDragStartPosition,
      getDragStartPosition: state.getDragStartPosition,
    }))
  )

  const copilotCleanup = useCopilotStore((state) => state.cleanup)

  // Training modal state
  const showTrainingModal = useCopilotTrainingStore((state) => state.showModal)

  // Snap to grid settings
  const snapToGridSize = useGeneralStore((state) => state.snapToGridSize)
  const snapToGrid = snapToGridSize > 0
  const snapGrid: [number, number] = useMemo(
    () => [snapToGridSize, snapToGridSize],
    [snapToGridSize]
  )

  // Handle copilot stream cleanup on page unload and component unmount
  useStreamCleanup(copilotCleanup)

  const { blocks, edges, isDiffMode, lastSaved } = currentWorkflow

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
    isPointInLoopNode,
    resizeLoopNodes,
    updateNodeParent: updateNodeParentUtil,
    getNodeAnchorPosition,
    getBlockDimensions,
  } = useNodeUtilities(blocks)

  /** Triggers immediate subflow resize without delays. */
  const resizeLoopNodesWrapper = useCallback(() => {
    return resizeLoopNodes(updateNodeDimensions)
  }, [resizeLoopNodes, updateNodeDimensions])

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
      if (!sourceBlock || !targetBlock) return false
      return !isAnnotationOnlyBlock(sourceBlock.type) && !isAnnotationOnlyBlock(targetBlock.type)
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
    collaborativeAddBlock: addBlock,
    collaborativeAddEdge: addEdge,
    collaborativeRemoveBlock: removeBlock,
    collaborativeRemoveEdge: removeEdge,
    collaborativeUpdateBlockPosition,
    collaborativeUpdateParentId: updateParentId,
    undo,
    redo,
  } = useCollaborativeWorkflow()

  const { activeBlockIds, pendingBlocks, isDebugging } = useExecutionStore(
    useShallow((state) => ({
      activeBlockIds: state.activeBlockIds,
      pendingBlocks: state.pendingBlocks,
      isDebugging: state.isDebugging,
    }))
  )

  const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

  /** Connection line style - red for error handles, default otherwise. */
  const connectionLineStyle = useMemo(
    () => ({
      stroke: isErrorConnectionDrag ? 'var(--text-error)' : 'var(--surface-7)',
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
        collaborativeUpdateBlockPosition,
        updateParentId,
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
      collaborativeUpdateBlockPosition,
      updateParentId,
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

  useEffect(() => {
    let cleanup: (() => void) | null = null

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement
      const isEditableElement =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.hasAttribute('contenteditable')

      if (isEditableElement) {
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
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (cleanup) cleanup()
    }
  }, [debouncedAutoLayout, undo, redo])

  /**
   * Removes all edges connected to a block, skipping individual edge recording for undo/redo.
   * Used when moving nodes between containers where edges would violate boundary constraints.
   */
  const removeEdgesForNode = useCallback(
    (blockId: string, edgesToRemove: Edge[]): void => {
      if (edgesToRemove.length === 0) return

      window.dispatchEvent(new CustomEvent('skip-edge-recording', { detail: { skip: true } }))

      try {
        edgesToRemove.forEach((edge) => {
          removeEdge(edge.id)
        })

        logger.debug('Removed edges for node', {
          blockId,
          edgeCount: edgesToRemove.length,
        })
      } finally {
        window.dispatchEvent(new CustomEvent('skip-edge-recording', { detail: { skip: false } }))
      }
    },
    [removeEdge]
  )

  /** Handles ActionBar remove-from-subflow events. */
  useEffect(() => {
    const handleRemoveFromSubflow = (event: Event) => {
      const customEvent = event as CustomEvent<{ blockId: string }>
      const blockId = customEvent.detail?.blockId
      if (!blockId) return

      try {
        const currentBlock = blocks[blockId]
        const parentId = currentBlock?.data?.parentId
        if (!parentId) return

        const edgesToRemove = edgesForDisplay.filter(
          (e) => e.source === blockId || e.target === blockId
        )
        removeEdgesForNode(blockId, edgesToRemove)
        updateNodeParent(blockId, null, edgesToRemove)
      } catch (err) {
        logger.error('Failed to remove from subflow', { err })
      }
    }

    window.addEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
    return () =>
      window.removeEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
  }, [blocks, edgesForDisplay, removeEdgesForNode, updateNodeParent])

  /** Finds the closest block to a position for auto-connect. */
  const findClosestOutput = useCallback(
    (newNodePosition: { x: number; y: number }): BlockData | null => {
      const containerAtPoint = isPointInLoopNode(newNodePosition)
      const nodeIndex = new Map(getNodes().map((n) => [n.id, n]))

      const candidates = Object.entries(blocks)
        .filter(([id, block]) => {
          if (!block.enabled) return false
          if (block.type === 'response') return false
          const node = nodeIndex.get(id)
          if (!node) return false

          const blockParentId = blocks[id]?.data?.parentId
          const dropParentId = containerAtPoint?.loopId
          if (dropParentId !== blockParentId) return false

          return true
        })
        .map(([id, block]) => {
          const anchor = getNodeAnchorPosition(id)
          const distance = Math.sqrt(
            (anchor.x - newNodePosition.x) ** 2 + (anchor.y - newNodePosition.y) ** 2
          )
          return {
            id,
            type: block.type,
            position: anchor,
            distance,
          }
        })
        .sort((a, b) => a.distance - b.distance)

      return candidates[0] || null
    },
    [blocks, getNodes, getNodeAnchorPosition, isPointInLoopNode]
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
    } else if (block.type === 'loop') {
      return 'loop-end-source'
    } else if (block.type === 'parallel') {
      return 'parallel-end-source'
    }
    return 'source'
  }, [])

  /** Creates a standardized edge object for workflow connections. */
  const createEdgeObject = useCallback(
    (sourceId: string, targetId: string, sourceHandle: string): Edge => ({
      id: crypto.randomUUID(),
      source: sourceId,
      target: targetId,
      sourceHandle,
      targetHandle: 'target',
      type: 'workflowEdge',
    }),
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
      return candidateBlocks
        .filter((b) => b.type !== 'response')
        .map((b) => ({
          block: b,
          distance: Math.sqrt(
            (b.position.x - targetPosition.x) ** 2 + (b.position.y - targetPosition.y) ** 2
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0]?.block
    },
    []
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
        blockType: string
        enableTriggerMode?: boolean
        targetParentId?: string | null
        existingChildBlocks?: { id: string; type: string; position: { x: number; y: number } }[]
        containerId?: string
      }
    ): Edge | undefined => {
      const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
      if (!isAutoConnectEnabled) return undefined

      // Don't auto-connect starter or annotation-only blocks
      if (options.blockType === 'starter' || isAnnotationOnlyBlock(options.blockType)) {
        return undefined
      }

      // Check if target is a trigger block
      const targetBlockConfig = getBlock(options.blockType)
      const isTargetTrigger =
        options.enableTriggerMode || targetBlockConfig?.category === 'triggers'
      if (isTargetTrigger) return undefined

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
   * Checks if adding a trigger block would violate constraints and shows notification if so.
   * @returns true if validation failed (caller should return early), false if ok to proceed
   */
  const checkTriggerConstraints = useCallback(
    (blockType: string): boolean => {
      const issue = TriggerUtils.getTriggerAdditionIssue(blocks, blockType)
      if (issue) {
        const message =
          issue.issue === 'legacy'
            ? 'Cannot add new trigger blocks when a legacy Start block exists. Available in newer workflows.'
            : `A workflow can only have one ${issue.triggerName} trigger block. Please remove the existing one before adding a new one.`
        addNotification({
          level: 'error',
          message,
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

        document
          .querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over')
          .forEach((el) => el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over'))
        document.body.style.cursor = ''
        document.body.classList.remove('sim-drag-subflow')

        if (data.type === 'loop' || data.type === 'parallel') {
          const id = crypto.randomUUID()
          const baseName = data.type === 'loop' ? 'Loop' : 'Parallel'
          const name = getUniqueBlockName(baseName, blocks)

          const autoConnectEdge = tryCreateAutoConnectEdge(position, id, {
            blockType: data.type,
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
            blockType: data.type,
            enableTriggerMode: data.enableTriggerMode,
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
            blockType: data.type,
            enableTriggerMode: data.enableTriggerMode,
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

      const { type, enableTriggerMode } = event.detail

      if (!type) return
      if (type === 'connectionBlock') return

      // Calculate smart position - to the right of existing root-level blocks
      const calculateSmartPosition = (): { x: number; y: number } => {
        // Get all root-level blocks (no parentId)
        const rootBlocks = Object.values(blocks).filter((b) => !b.data?.parentId)

        if (rootBlocks.length === 0) {
          // No blocks yet, use viewport center
          return screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          })
        }

        // Find the rightmost block
        let maxRight = Number.NEGATIVE_INFINITY
        let rightmostBlockY = 0
        for (const block of rootBlocks) {
          const blockWidth =
            block.type === 'loop' || block.type === 'parallel'
              ? block.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH
              : BLOCK_DIMENSIONS.FIXED_WIDTH
          const blockRight = block.position.x + blockWidth
          if (blockRight > maxRight) {
            maxRight = blockRight
            rightmostBlockY = block.position.y
          }
        }

        // Position to the right with autolayout spacing
        const position = {
          x: maxRight + DEFAULT_HORIZONTAL_SPACING,
          y: rightmostBlockY,
        }

        // Ensure position doesn't overlap any container
        let container = isPointInLoopNode(position)
        while (container) {
          position.x =
            container.loopPosition.x + container.dimensions.width + DEFAULT_HORIZONTAL_SPACING
          container = isPointInLoopNode(position)
        }

        return position
      }

      const basePosition = calculateSmartPosition()

      // Special handling for container nodes (loop or parallel)
      if (type === 'loop' || type === 'parallel') {
        const id = crypto.randomUUID()
        const baseName = type === 'loop' ? 'Loop' : 'Parallel'
        const name = getUniqueBlockName(baseName, blocks)

        const autoConnectEdge = tryCreateAutoConnectEdge(basePosition, id, {
          blockType: type,
          targetParentId: null,
        })

        // Add the container node with default dimensions and auto-connect edge
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

      // Check trigger constraints first
      if (checkTriggerConstraints(type)) return

      // Create a new block with a unique ID
      const id = crypto.randomUUID()
      // Prefer semantic default names for triggers; then ensure unique numbering centrally
      const defaultTriggerName = TriggerUtils.getDefaultTriggerName(type)
      const baseName = defaultTriggerName || blockConfig.name
      const name = getUniqueBlockName(baseName, blocks)

      const autoConnectEdge = tryCreateAutoConnectEdge(basePosition, id, {
        blockType: type,
        enableTriggerMode,
        targetParentId: null,
      })

      // Add the block to the workflow with auto-connect edge
      // Enable trigger mode if this is a trigger-capable block from the triggers tab
      addBlock(
        id,
        type,
        name,
        basePosition,
        undefined,
        undefined,
        undefined,
        autoConnectEdge,
        enableTriggerMode
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
    screenToFlowPosition,
    blocks,
    addBlock,
    tryCreateAutoConnectEdge,
    isPointInLoopNode,
    effectivePermissions.canEdit,
    addNotification,
    activeWorkflowId,
    checkTriggerConstraints,
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

  /**
   * Focus canvas on changed blocks when diff appears
   * Focuses on new/edited blocks rather than fitting the entire workflow
   */
  const prevDiffReadyRef = useRef(false)
  useEffect(() => {
    // Only focus when diff transitions from not ready to ready
    if (isDiffReady && !prevDiffReadyRef.current && diffAnalysis) {
      const changedBlockIds = [
        ...(diffAnalysis.new_blocks || []),
        ...(diffAnalysis.edited_blocks || []),
      ]

      if (changedBlockIds.length > 0) {
        const allNodes = getNodes()
        const changedNodes = allNodes.filter((node) => changedBlockIds.includes(node.id))

        if (changedNodes.length > 0) {
          logger.info('Diff ready - focusing on changed blocks', {
            changedBlockIds,
            foundNodes: changedNodes.length,
          })
          requestAnimationFrame(() => {
            fitView({
              nodes: changedNodes,
              duration: 600,
              padding: 0.3,
              minZoom: 0.5,
              maxZoom: 1.0,
            })
          })
        } else {
          logger.info('Diff ready - no changed nodes found, fitting all')
          requestAnimationFrame(() => {
            fitView({ padding: 0.3, duration: 600 })
          })
        }
      } else {
        logger.info('Diff ready - no changed blocks, fitting all')
        requestAnimationFrame(() => {
          fitView({ padding: 0.3, duration: 600 })
        })
      }
    }
    prevDiffReadyRef.current = isDiffReady
  }, [isDiffReady, diffAnalysis, fitView, getNodes])

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

        // Clear any previous highlighting
        document
          .querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over')
          .forEach((el) => {
            el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
          })

        // Highlight container if hovering over it and not dragging a subflow
        // Subflow drag is marked by body class flag set by toolbar
        const isSubflowDrag = document.body.classList.contains('sim-drag-subflow')

        if (containerInfo && !isSubflowDrag) {
          const containerElement = document.querySelector(`[data-id="${containerInfo.loopId}"]`)
          if (containerElement) {
            // Determine the type of container node for appropriate styling
            const containerNode = getNodes().find((n) => n.id === containerInfo.loopId)
            if (
              containerNode?.type === 'subflowNode' &&
              (containerNode.data as SubflowNodeData)?.kind === 'loop'
            ) {
              containerElement.classList.add('loop-node-drag-over')
            } else if (
              containerNode?.type === 'subflowNode' &&
              (containerNode.data as SubflowNodeData)?.kind === 'parallel'
            ) {
              containerElement.classList.add('parallel-node-drag-over')
            }
            document.body.style.cursor = 'copy'
          }
        } else {
          document.body.style.cursor = ''
        }
      } catch (err) {
        logger.error('Error in onDragOver', { err })
      }
    },
    [screenToFlowPosition, isPointInLoopNode, getNodes]
  )

  const loadingWorkflowRef = useRef<string | null>(null)
  const currentWorkflowExists = Boolean(workflows[workflowIdParam])

  /** Initializes workflow when it exists in registry and needs hydration. */
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
    Object.entries(blocks).forEach(([blockId, block]) => {
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
        width: BLOCK_DIMENSIONS.FIXED_WIDTH,
        height: Math.max(block.height || BLOCK_DIMENSIONS.MIN_HEIGHT, BLOCK_DIMENSIONS.MIN_HEIGHT),
      })
    })

    return nodeArray
  }, [blocksStructureHash, blocks, activeBlockIds, pendingBlocks, isDebugging, getBlockConfig])

  // Local state for nodes - allows smooth drag without store updates on every frame
  const [displayNodes, setDisplayNodes] = useState<Node[]>([])

  // Sync derived nodes to display nodes when structure changes
  useEffect(() => {
    setDisplayNodes(derivedNodes)
  }, [derivedNodes])

  /** Handles node position changes - updates local state for smooth drag, syncs to store only on drag end. */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Apply position changes to local state for smooth rendering
    setDisplayNodes((nds) => applyNodeChanges(changes, nds))

    // Don't sync to store during drag - that's handled in onNodeDragStop
    // Only sync non-position changes (like selection) to store if needed
  }, [])

  /**
   * Updates container dimensions in displayNodes during drag.
   * This allows live resizing of containers as their children are dragged.
   */
  const updateContainerDimensionsDuringDrag = useCallback(
    (draggedNodeId: string, draggedNodePosition: { x: number; y: number }) => {
      const parentId = blocks[draggedNodeId]?.data?.parentId
      if (!parentId) return

      setDisplayNodes((currentNodes) => {
        const childNodes = currentNodes.filter((n) => n.parentId === parentId)
        if (childNodes.length === 0) return currentNodes

        let maxRight = 0
        let maxBottom = 0

        childNodes.forEach((node) => {
          const nodePosition = node.id === draggedNodeId ? draggedNodePosition : node.position
          const { width: nodeWidth, height: nodeHeight } = getBlockDimensions(node.id)

          maxRight = Math.max(maxRight, nodePosition.x + nodeWidth)
          maxBottom = Math.max(maxBottom, nodePosition.y + nodeHeight)
        })

        const newWidth = Math.max(
          CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
          CONTAINER_DIMENSIONS.LEFT_PADDING + maxRight + CONTAINER_DIMENSIONS.RIGHT_PADDING
        )
        const newHeight = Math.max(
          CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
          CONTAINER_DIMENSIONS.HEADER_HEIGHT +
            CONTAINER_DIMENSIONS.TOP_PADDING +
            maxBottom +
            CONTAINER_DIMENSIONS.BOTTOM_PADDING
        )

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

    // Check for nodes with invalid parent references
    Object.entries(blocks).forEach(([id, block]) => {
      const parentId = block.data?.parentId

      // If block has a parent reference but parent no longer exists
      if (parentId && !nodeIds.has(parentId)) {
        logger.warn('Found orphaned node with invalid parent reference', {
          nodeId: id,
          missingParentId: parentId,
        })

        // Fix the node by removing its parent reference and calculating absolute position
        const absolutePosition = getNodeAbsolutePosition(id)

        // Update the node to remove parent reference and use absolute position
        collaborativeUpdateBlockPosition(id, absolutePosition)
        updateParentId(id, '', 'parent')
      }
    })
  }, [
    blocks,
    collaborativeUpdateBlockPosition,
    updateParentId,
    getNodeAbsolutePosition,
    isWorkflowReady,
  ])

  /** Handles edge removal changes. */
  const onEdgesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'remove') {
          removeEdge(change.id)
        }
      })
    },
    [removeEdge]
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
   * Captures the source handle when a connection drag starts
   */
  const onConnectStart = useCallback((_event: any, params: any) => {
    const handleId: string | undefined = params?.handleId
    setIsErrorConnectionDrag(handleId === 'error')
    connectionSourceRef.current = {
      nodeId: params?.nodeId,
      handleId: params?.handleId,
    }
  }, [])

  /** Handles new edge connections with container boundary validation. */
  const onConnect = useCallback(
    (connection: any) => {
      if (connection.source && connection.target) {
        // Check if connecting nodes across container boundaries
        const sourceNode = getNodes().find((n) => n.id === connection.source)
        const targetNode = getNodes().find((n) => n.id === connection.target)

        if (!sourceNode || !targetNode) return

        // Prevent connections to/from annotation-only blocks (non-executable)
        if (
          isAnnotationOnlyBlock(sourceNode.data?.type) ||
          isAnnotationOnlyBlock(targetNode.data?.type)
        ) {
          return
        }

        // Prevent incoming connections to trigger blocks (webhook, schedule, etc.)
        if (targetNode.data?.config?.category === 'triggers') {
          return
        }

        // Prevent incoming connections to starter blocks (still keep separate for backward compatibility)
        if (targetNode.data?.type === 'starter') {
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
      }
    },
    [addEdge, getNodes, blocks]
  )

  /**
   * Handles connection drag end. Detects if the edge was dropped over a block
   * and automatically creates a connection to that block's target handle.
   */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      setIsErrorConnectionDrag(false)

      const source = connectionSourceRef.current
      if (!source?.nodeId) {
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

      // Create connection if valid target found
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
        updateContainerDimensionsDuringDrag(node.id, node.position)
      }

      // Check if this is a starter block - starter blocks should never be in containers
      const isStarterBlock = node.data?.type === 'starter'
      if (isStarterBlock) {
        // If it's a starter block, remove any highlighting and don't allow it to be dragged into containers
        if (potentialParentId) {
          const prevElement = document.querySelector(`[data-id="${potentialParentId}"]`)
          if (prevElement) {
            prevElement.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
          }
          setPotentialParentId(null)
          document.body.style.cursor = ''
        }
        return // Exit early - don't process any container intersections for starter blocks
      }

      // Get the node's absolute position to properly calculate intersections
      const nodeAbsolutePos = getNodeAbsolutePosition(node.id)

      // Prevent subflows from being dragged into other subflows
      if (node.type === 'subflowNode') {
        // Clear any highlighting for subflow nodes
        if (potentialParentId) {
          const prevElement = document.querySelector(`[data-id="${potentialParentId}"]`)
          if (prevElement) {
            prevElement.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
          }
          setPotentialParentId(null)
          document.body.style.cursor = ''
        }
        return // Exit early - subflows cannot be placed inside other subflows
      }

      // Find intersections with container nodes using absolute coordinates
      const intersectingNodes = getNodes()
        .filter((n) => {
          // Only consider container nodes that aren't the dragged node
          if (n.type !== 'subflowNode' || n.id === node.id) return false

          // Skip if this container is already the parent of the node being dragged
          if (n.id === currentParentId) return false

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
        const containerElement = document.querySelector(
          `[data-id="${bestContainerMatch.container.id}"]`
        )
        if (containerElement) {
          // Apply appropriate class based on container type
          if (
            bestContainerMatch.container.type === 'subflowNode' &&
            (bestContainerMatch.container.data as SubflowNodeData)?.kind === 'loop'
          ) {
            containerElement.classList.add('loop-node-drag-over')
          } else if (
            bestContainerMatch.container.type === 'subflowNode' &&
            (bestContainerMatch.container.data as SubflowNodeData)?.kind === 'parallel'
          ) {
            containerElement.classList.add('parallel-node-drag-over')
          }
          document.body.style.cursor = 'copy'
        }
      } else {
        // Remove highlighting if no longer over a container
        if (potentialParentId) {
          const prevElement = document.querySelector(`[data-id="${potentialParentId}"]`)
          if (prevElement) {
            prevElement.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
          }
          setPotentialParentId(null)
          document.body.style.cursor = ''
        }
      }
    },
    [
      getNodes,
      potentialParentId,
      blocks,
      getNodeAbsolutePosition,
      getNodeDepth,
      updateContainerDimensionsDuringDrag,
    ]
  )

  /** Captures initial parent ID and position when drag starts. */
  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: any) => {
      // Store the original parent ID when starting to drag
      const currentParentId = blocks[node.id]?.data?.parentId || null
      setDragStartParentId(currentParentId)
      // Store starting position for undo/redo move entry
      setDragStartPosition({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        parentId: currentParentId,
      })
    },
    [blocks, setDragStartPosition]
  )

  /** Handles node drag stop to establish parent-child relationships. */
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: any) => {
      // Clear UI effects
      document.querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over').forEach((el) => {
        el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
      })
      document.body.style.cursor = ''

      // Get the block's current parent (if any)
      const currentBlock = blocks[node.id]
      const currentParentId = currentBlock?.data?.parentId

      // Calculate position - clamp if inside a container
      let finalPosition = node.position
      if (currentParentId) {
        // Block is inside a container - clamp position to keep it fully inside
        const parentNode = getNodes().find((n) => n.id === currentParentId)
        if (parentNode) {
          const containerDimensions = {
            width: parentNode.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
            height: parentNode.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
          }
          const blockDimensions = {
            width: BLOCK_DIMENSIONS.FIXED_WIDTH,
            height: Math.max(
              currentBlock?.height || BLOCK_DIMENSIONS.MIN_HEIGHT,
              BLOCK_DIMENSIONS.MIN_HEIGHT
            ),
          }

          finalPosition = clampPositionToContainer(
            node.position,
            containerDimensions,
            blockDimensions
          )
        }
      }

      // Emit collaborative position update for the final position
      // This ensures other users see the smooth final position
      collaborativeUpdateBlockPosition(node.id, finalPosition, true)

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
          blockType: node.data?.type || '',
          targetParentId: potentialParentId,
          existingChildBlocks,
          containerId: potentialParentId,
        })

        const edgesToAdd: Edge[] = autoConnectEdge ? [autoConnectEdge] : []

        // Skip recording these edges separately since they're part of the parent update
        window.dispatchEvent(new CustomEvent('skip-edge-recording', { detail: { skip: true } }))

        // Moving to a new parent container - pass both removed and added edges for undo/redo
        const affectedEdges = [...edgesToRemove, ...edgesToAdd]
        updateNodeParent(node.id, potentialParentId, affectedEdges)

        // Now add the edges after parent update
        edgesToAdd.forEach((edge) => addEdge(edge))

        window.dispatchEvent(new CustomEvent('skip-edge-recording', { detail: { skip: false } }))
      }

      // Reset state
      setPotentialParentId(null)
    },
    [
      getNodes,
      dragStartParentId,
      potentialParentId,
      updateNodeParent,
      collaborativeUpdateBlockPosition,
      addEdge,
      tryCreateAutoConnectEdge,
      blocks,
      edgesForDisplay,
      removeEdgesForNode,
      getNodeAbsolutePosition,
      getDragStartPosition,
      setDragStartPosition,
      addNotification,
      activeWorkflowId,
    ]
  )

  /** Clears edge selection and panel state when clicking empty canvas. */
  const onPaneClick = useCallback(() => {
    setSelectedEdgeInfo(null)
    usePanelEditorStore.getState().clearCurrentBlock()
  }, [])

  /** Handles edge selection with container context tracking. */
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

      setSelectedEdgeInfo({
        id: edge.id,
        parentLoopId,
        contextId,
      })
    },
    [getNodes]
  )

  /** Stable delete handler to avoid creating new function references per edge. */
  const handleEdgeDelete = useCallback(
    (edgeId: string) => {
      removeEdge(edgeId)
      setSelectedEdgeInfo((current) => (current?.id === edgeId ? null : current))
    },
    [removeEdge]
  )

  /** Transforms edges to include selection state and delete handlers. Memoized to prevent re-renders. */
  const edgesWithSelection = useMemo(() => {
    // Build node lookup map once - O(n) instead of O(n) per edge
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
          isSelected: selectedEdgeInfo?.contextId === edgeContextId,
          isInsideLoop: Boolean(parentLoopId),
          parentLoopId,
          sourceHandle: edge.sourceHandle,
          onDelete: handleEdgeDelete,
        },
      }
    })
  }, [edgesForDisplay, displayNodes, selectedEdgeInfo?.contextId, handleEdgeDelete])

  /** Handles Delete/Backspace to remove selected edges or blocks. */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return
      }

      // Ignore when typing/navigating inside editable inputs or editors
      const activeElement = document.activeElement
      const isEditableElement =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.hasAttribute('contenteditable')

      if (isEditableElement) {
        return
      }

      // Handle edge deletion first (edges take priority if selected)
      if (selectedEdgeInfo) {
        removeEdge(selectedEdgeInfo.id)
        setSelectedEdgeInfo(null)
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
      const primaryNode = selectedNodes[0]
      removeBlock(primaryNode.id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEdgeInfo, removeEdge, getNodes, removeBlock, effectivePermissions.canEdit])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='relative h-full w-full flex-1 bg-[var(--bg)]'>
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
              onNodeClick={(e, _node) => {
                e.stopPropagation()
              }}
              onPaneClick={onPaneClick}
              onEdgeClick={onEdgeClick}
              onPointerMove={handleCanvasPointerMove}
              onPointerLeave={handleCanvasPointerLeave}
              elementsSelectable={true}
              selectNodesOnDrag={false}
              nodesConnectable={effectivePermissions.canEdit}
              nodesDraggable={effectivePermissions.canEdit}
              draggable={false}
              noWheelClassName='allow-scroll'
              edgesFocusable={true}
              edgesUpdatable={effectivePermissions.canEdit}
              className={`workflow-container h-full bg-[var(--bg)] transition-opacity duration-150 ${reactFlowStyles} ${isCanvasReady ? 'opacity-100' : 'opacity-0'}`}
              onNodeDrag={effectivePermissions.canEdit ? onNodeDrag : undefined}
              onNodeDragStop={effectivePermissions.canEdit ? onNodeDragStop : undefined}
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

            <Suspense fallback={null}>
              <LazyChat />
            </Suspense>

            <DiffControls />
          </>
        )}

        <Notifications />

        {isWorkflowReady && isWorkflowEmpty && effectivePermissions.canEdit && <CommandList />}

        <Panel />
      </div>

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
