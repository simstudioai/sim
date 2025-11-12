'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerUtils } from '@/lib/workflows/triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  CommandList,
  DiffControls,
  Panel,
  SubflowNodeComponent,
  Terminal,
  TrainingControls,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { Chat } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/chat'
import { Cursors } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/cursors/cursors'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error/index'
import { NoteBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block'
import {
  TriggerWarningDialog,
  TriggerWarningType,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/trigger-warning-dialog/trigger-warning-dialog'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'
import {
  useAutoLayout,
  useCurrentWorkflow,
  useNodeUtilities,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { getBlock } from '@/blocks'
import { useSocket } from '@/contexts/socket-context'
import { isAnnotationOnlyBlock } from '@/executor/consts'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useStreamCleanup } from '@/hooks/use-stream-cleanup'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { useExecutionStore } from '@/stores/execution/store'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import { usePanelEditorStore } from '@/stores/panel-new/editor/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { hasWorkflowsInitiallyLoaded, useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getUniqueBlockName } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('Workflow')

// Define custom node and edge types - memoized outside component to prevent re-creation
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  noteBlock: NoteBlock,
  subflowNode: SubflowNodeComponent,
}
const edgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge, // Keep for backward compatibility
}

// Memoized ReactFlow props to prevent unnecessary re-renders
const defaultEdgeOptions = { type: 'custom' }
const snapGrid: [number, number] = [20, 20]

interface SelectedEdgeInfo {
  id: string
  parentLoopId?: string
  contextId?: string // Unique identifier combining edge ID and context
}

interface BlockData {
  id: string
  type: string
  position: { x: number; y: number }
  distance: number
}

const WorkflowContent = React.memo(() => {
  // State
  const [isWorkflowReady, setIsWorkflowReady] = useState(false)

  // State for tracking node dragging
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [potentialParentId, setPotentialParentId] = useState<string | null>(null)
  // Enhanced edge selection with parent context and unique identifier
  const [selectedEdgeInfo, setSelectedEdgeInfo] = useState<SelectedEdgeInfo | null>(null)

  // State for trigger warning dialog
  const [triggerWarning, setTriggerWarning] = useState<{
    open: boolean
    triggerName: string
    type: TriggerWarningType
  }>({
    open: false,
    triggerName: '',
    type: TriggerWarningType.DUPLICATE_TRIGGER,
  })

  // Track whether the active connection drag started from an error handle
  const [isErrorConnectionDrag, setIsErrorConnectionDrag] = useState(false)

  // Hooks
  const params = useParams()
  const router = useRouter()
  const { project, getNodes, fitView } = useReactFlow()
  const { emitCursorUpdate } = useSocket()

  // Get workspace ID from the params
  const workspaceId = params.workspaceId as string

  const { workflows, activeWorkflowId, isLoading, setActiveWorkflow, createWorkflow } =
    useWorkflowRegistry()

  // Use the clean abstraction for current workflow state
  const currentWorkflow = useCurrentWorkflow()

  const {
    updateNodeDimensions,
    updateBlockPosition: storeUpdateBlockPosition,
    setDragStartPosition,
    getDragStartPosition,
  } = useWorkflowStore()

  // (moved) resizeLoopNodesWrapper defined after hooks that provide resizeLoopNodes

  // Get copilot cleanup function
  const copilotCleanup = useCopilotStore((state) => state.cleanup)

  // Handle copilot stream cleanup on page unload and component unmount
  useStreamCleanup(copilotCleanup)

  // Extract workflow data from the abstraction
  const { blocks, edges, isDiffMode, lastSaved } = currentWorkflow

  // Node utilities hook for position/hierarchy calculations (requires blocks)
  const {
    getNodeDepth,
    getNodeHierarchy,
    getNodeAbsolutePosition,
    isPointInLoopNode,
    resizeLoopNodes,
    updateNodeParent: updateNodeParentUtil,
    getNodeAnchorPosition,
  } = useNodeUtilities(blocks)

  /**
   * Wrapper to call resizeLoopNodes with immediate execution.
   * No delays for responsive subflow resizing.
   */
  const resizeLoopNodesWrapper = useCallback(() => {
    return resizeLoopNodes(updateNodeDimensions)
  }, [resizeLoopNodes, updateNodeDimensions])

  // Auto-layout hook
  const { applyAutoLayoutAndUpdateStore } = useAutoLayout(activeWorkflowId || null)

  // Check if workflow is empty (no blocks)
  const isWorkflowEmpty = useMemo(() => {
    return Object.keys(blocks).length === 0
  }, [blocks])

  // Get diff analysis for edge reconstruction
  const { diffAnalysis, isShowingDiff, isDiffReady } = useWorkflowDiffStore()

  // Reconstruct deleted edges when viewing original workflow and filter trigger edges
  const edgesForDisplay = useMemo(() => {
    let edgesToFilter = edges

    // If we're not in diff mode and we have diff analysis with deleted edges,
    // we need to reconstruct those deleted edges and add them to the display
    // Only do this if diff is ready to prevent race conditions
    if (!isShowingDiff && isDiffReady && diffAnalysis?.edge_diff?.deleted_edges) {
      const reconstructedEdges: Edge[] = []

      // Parse deleted edge identifiers to reconstruct edges
      diffAnalysis.edge_diff.deleted_edges.forEach((edgeIdentifier) => {
        // Edge identifier format: "sourceId-sourceHandle-targetId-targetHandle"
        // Split by '-' and extract components
        const parts = edgeIdentifier.split('-')
        if (parts.length >= 4) {
          // Find the index where targetId starts (after the source handle)
          // We need to handle cases where IDs contain hyphens
          let sourceEndIndex = -1
          let targetStartIndex = -1

          // Look for valid handle names to identify boundaries
          const validHandles = ['source', 'target', 'success', 'error', 'default', 'condition']

          for (let i = 1; i < parts.length - 1; i++) {
            if (validHandles.includes(parts[i])) {
              sourceEndIndex = i
              // Find the next part that could be the start of targetId
              for (let j = i + 1; j < parts.length - 1; j++) {
                // Check if this could be a valid target ID start
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

            // Only reconstruct if both blocks still exist
            if (blocks[sourceId] && blocks[targetId]) {
              // Generate a unique edge ID
              const edgeId = `deleted-${sourceId}-${sourceHandle}-${targetId}-${targetHandle}`

              reconstructedEdges.push({
                id: edgeId,
                source: sourceId,
                target: targetId,
                sourceHandle,
                targetHandle,
                type: 'workflowEdge',
                data: { isDeleted: true }, // Mark as deleted for styling
              })
            }
          }
        }
      })

      // Combine existing edges with reconstructed deleted edges
      edgesToFilter = [...edges, ...reconstructedEdges]
    }
    return edgesToFilter
  }, [edges, isShowingDiff, isDiffReady, diffAnalysis, blocks])

  // User permissions - get current user's specific permissions from context
  const userPermissions = useUserPermissionsContext()

  // Create diff-aware permissions that disable editing when in diff mode
  const effectivePermissions = useMemo(() => {
    if (isDiffMode) {
      // In diff mode, disable all editing regardless of user permissions
      return {
        ...userPermissions,
        canEdit: false,
        canAdmin: false,
        // Keep canRead true so users can still view content
        canRead: userPermissions.canRead,
      }
    }
    return userPermissions
  }, [userPermissions, isDiffMode])

  // Workspace permissions - get all users and their permissions for this workspace
  const { permissions: workspacePermissions, error: permissionsError } = useWorkspacePermissions(
    workspaceId || null
  )

  // Store access
  const {
    collaborativeAddBlock: addBlock,
    collaborativeAddEdge: addEdge,
    collaborativeRemoveEdge: removeEdge,
    collaborativeUpdateBlockPosition,
    collaborativeUpdateParentId: updateParentId,
    collaborativeSetSubblockValue,
    undo,
    redo,
  } = useCollaborativeWorkflow()

  // Execution and debug mode state
  const { activeBlockIds, pendingBlocks, isDebugging } = useExecutionStore()
  const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

  /**
   * Dynamic connection line style that changes color based on the source handle
   * Error handles render red connection lines to match error edges
   */
  const connectionLineStyle = useMemo(() => {
    return {
      stroke: isErrorConnectionDrag ? '#EF4444' : '#434343',
      strokeWidth: 2,
    }
  }, [isErrorConnectionDrag])

  // Log permissions when they load
  useEffect(() => {
    if (workspacePermissions) {
      logger.info('Workspace permissions loaded in workflow', {
        workspaceId,
        userCount: workspacePermissions.total,
        permissions: workspacePermissions.users.map((u) => ({
          email: u.email,
          permissions: u.permissionType,
        })),
      })
    }
  }, [workspacePermissions, workspaceId])

  // Log permissions errors
  useEffect(() => {
    if (permissionsError) {
      logger.error('Failed to load workspace permissions', {
        workspaceId,
        error: permissionsError,
      })
    }
  }, [permissionsError, workspaceId])

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
        // Account for header (50px), left padding (16px), and top padding (16px)
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
      updateNodeDimensions,
      blocks,
      edgesForDisplay,
      getNodeAbsolutePosition,
      updateNodeParentUtil,
      resizeLoopNodesWrapper,
    ]
  )

  // Auto-layout handler - uses the hook for immediate frontend updates
  const handleAutoLayout = useCallback(async () => {
    if (Object.keys(blocks).length === 0) return

    try {
      const result = await applyAutoLayoutAndUpdateStore()

      if (result.success) {
        logger.info('Auto layout completed successfully')
      } else {
        logger.error('Auto layout failed:', result.error)
      }
    } catch (error) {
      logger.error('Auto layout error:', error)
    }
  }, [blocks, applyAutoLayoutAndUpdateStore])

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

  // Listen for explicit remove-from-subflow actions from ActionBar
  useEffect(() => {
    const handleRemoveFromSubflow = (event: Event) => {
      const customEvent = event as CustomEvent<{ blockId: string }>
      const { blockId } = customEvent.detail || ({} as any)
      if (!blockId) return

      try {
        const currentBlock = blocks[blockId]
        const parentId = currentBlock?.data?.parentId

        if (!parentId) return

        // Find ALL edges connected to this block
        const edgesToRemove = edgesForDisplay.filter(
          (e) => e.source === blockId || e.target === blockId
        )

        // Set flag to skip individual edge recording for undo/redo
        window.dispatchEvent(new CustomEvent('skip-edge-recording', { detail: { skip: true } }))

        // Remove edges first
        edgesToRemove.forEach((edge) => {
          removeEdge(edge.id)
        })

        // Then update parent relationship
        updateNodeParent(blockId, null, edgesToRemove)

        window.dispatchEvent(new CustomEvent('skip-edge-recording', { detail: { skip: false } }))
      } catch (err) {
        logger.error('Failed to remove from subflow', { err })
      }
    }

    window.addEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
    return () =>
      window.removeEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
  }, [getNodes, updateNodeParent, removeEdge, edgesForDisplay])

  // Handle drops
  const findClosestOutput = useCallback(
    (newNodePosition: { x: number; y: number }): BlockData | null => {
      // Determine if drop is inside a container; if not, exclude child nodes from candidates
      const containerAtPoint = isPointInLoopNode(newNodePosition)
      const nodeIndex = new Map(getNodes().map((n) => [n.id, n]))

      const candidates = Object.entries(blocks)
        .filter(([id, block]) => {
          if (!block.enabled) return false
          const node = nodeIndex.get(id)
          if (!node) return false

          // If dropping outside containers, ignore blocks that are inside a container
          if (!containerAtPoint && blocks[id]?.data?.parentId) return false
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

  // Determine the appropriate source handle based on block type
  const determineSourceHandle = useCallback((block: { id: string; type: string }) => {
    // Default source handle
    let sourceHandle = 'source'

    // For condition blocks, use the first condition handle
    if (block.type === 'condition') {
      // Get just the first condition handle from the DOM
      const conditionHandles = document.querySelectorAll(
        `[data-nodeid^="${block.id}"][data-handleid^="condition-"]`
      )
      if (conditionHandles.length > 0) {
        // Extract the full handle ID from the first condition handle
        const handleId = conditionHandles[0].getAttribute('data-handleid')
        if (handleId) {
          sourceHandle = handleId
        }
      }
    }
    // For loop and parallel nodes, use their end source handle
    else if (block.type === 'loop') {
      sourceHandle = 'loop-end-source'
    } else if (block.type === 'parallel') {
      sourceHandle = 'parallel-end-source'
    }

    return sourceHandle
  }, [])

  // Listen for toolbar block click events
  useEffect(() => {
    const handleAddBlockFromToolbar = (event: CustomEvent) => {
      // Check if user has permission to interact with blocks
      if (!effectivePermissions.canEdit) {
        return
      }

      const { type, enableTriggerMode } = event.detail

      if (!type) return
      if (type === 'connectionBlock') return

      // Special handling for container nodes (loop or parallel)
      if (type === 'loop' || type === 'parallel') {
        const id = crypto.randomUUID()
        const baseName = type === 'loop' ? 'Loop' : 'Parallel'
        const name = getUniqueBlockName(baseName, blocks)

        const centerPosition = project({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })

        // Auto-connect logic for container nodes
        const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
        let autoConnectEdge
        if (isAutoConnectEnabled) {
          const closestBlock = findClosestOutput(centerPosition)
          if (closestBlock) {
            const sourceHandle = determineSourceHandle(closestBlock)
            autoConnectEdge = {
              id: crypto.randomUUID(),
              source: closestBlock.id,
              target: id,
              sourceHandle,
              targetHandle: 'target',
              type: 'workflowEdge',
            }
          }
        }

        // Add the container node with default dimensions and auto-connect edge
        addBlock(
          id,
          type,
          name,
          centerPosition,
          {
            width: 500,
            height: 300,
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

      // Calculate the center position of the viewport
      const centerPosition = project({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })

      // Create a new block with a unique ID
      const id = crypto.randomUUID()
      // Prefer semantic default names for triggers; then ensure unique numbering centrally
      const defaultTriggerName = TriggerUtils.getDefaultTriggerName(type)
      const baseName = defaultTriggerName || blockConfig.name
      const name = getUniqueBlockName(baseName, blocks)

      // Auto-connect logic
      const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
      let autoConnectEdge
      if (isAutoConnectEnabled && type !== 'starter') {
        const closestBlock = findClosestOutput(centerPosition)
        logger.info('Closest block found:', closestBlock)
        if (closestBlock) {
          // Don't create edges into trigger blocks
          const targetBlockConfig = blockConfig
          const isTargetTrigger = enableTriggerMode || targetBlockConfig?.category === 'triggers'

          if (!isTargetTrigger) {
            const sourceHandle = determineSourceHandle(closestBlock)

            autoConnectEdge = {
              id: crypto.randomUUID(),
              source: closestBlock.id,
              target: id,
              sourceHandle,
              targetHandle: 'target',
              type: 'workflowEdge',
            }
            logger.info('Auto-connect edge created:', autoConnectEdge)
          } else {
            logger.info('Skipping auto-connect into trigger block', {
              target: type,
            })
          }
        }
      }

      // Centralized trigger constraints
      const additionIssue = TriggerUtils.getTriggerAdditionIssue(blocks, type)
      if (additionIssue) {
        if (additionIssue.issue === 'legacy') {
          setTriggerWarning({
            open: true,
            triggerName: additionIssue.triggerName,
            type: TriggerWarningType.LEGACY_INCOMPATIBILITY,
          })
        } else {
          setTriggerWarning({
            open: true,
            triggerName: additionIssue.triggerName,
            type: TriggerWarningType.DUPLICATE_TRIGGER,
          })
        }
        return
      }

      // Add the block to the workflow with auto-connect edge
      // Enable trigger mode if this is a trigger-capable block from the triggers tab
      addBlock(
        id,
        type,
        name,
        centerPosition,
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
    project,
    blocks,
    addBlock,
    addEdge,
    findClosestOutput,
    determineSourceHandle,
    effectivePermissions.canEdit,
    setTriggerWarning,
  ])

  /**
   * Recenter canvas when diff appears
   * Tracks when diff becomes ready to automatically fit the view with smooth animation
   */
  const prevDiffReadyRef = useRef(false)
  useEffect(() => {
    // Only recenter when diff transitions from not ready to ready
    if (isDiffReady && !prevDiffReadyRef.current && diffAnalysis) {
      logger.info('Diff ready - recentering canvas to show changes')
      // Use a small delay to ensure the diff has fully rendered
      setTimeout(() => {
        fitView({ padding: 0.3, duration: 600 })
      }, 100)
    }
    prevDiffReadyRef.current = isDiffReady
  }, [isDiffReady, diffAnalysis, fitView])

  // Listen for trigger warning events
  useEffect(() => {
    const handleShowTriggerWarning = (event: CustomEvent) => {
      const { type, triggerName } = event.detail
      setTriggerWarning({
        open: true,
        triggerName: triggerName || 'trigger',
        type: type === 'trigger_in_subflow' ? TriggerWarningType.TRIGGER_IN_SUBFLOW : type,
      })
    }

    window.addEventListener('show-trigger-warning', handleShowTriggerWarning as EventListener)

    return () => {
      window.removeEventListener('show-trigger-warning', handleShowTriggerWarning as EventListener)
    }
  }, [setTriggerWarning])

  // Handler for trigger selection from list
  const handleTriggerSelect = useCallback(
    (triggerId: string, enableTriggerMode?: boolean) => {
      // Get the trigger name
      const triggerName = TriggerUtils.getDefaultTriggerName(triggerId) || triggerId

      // Create the trigger block at the center of the viewport
      const centerPosition = project({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const id = crypto.randomUUID()

      // Add the trigger block with trigger mode if specified
      addBlock(
        id,
        triggerId,
        triggerName,
        centerPosition,
        undefined,
        undefined,
        undefined,
        undefined,
        enableTriggerMode || false
      )
    },
    [project, addBlock]
  )

  // Update the onDrop handler
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      try {
        const data = JSON.parse(event.dataTransfer.getData('application/json'))
        if (data.type === 'connectionBlock') return

        const reactFlowBounds = event.currentTarget.getBoundingClientRect()
        const position = project({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })

        // Check if dropping inside a container node (loop or parallel)
        const containerInfo = isPointInLoopNode(position)

        // Clear any drag-over styling
        document
          .querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over')
          .forEach((el) => {
            el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
          })
        document.body.style.cursor = ''
        // Ensure any toolbar drag flags are cleared on drop
        document.body.classList.remove('sim-drag-subflow')

        // Special handling for container nodes (loop or parallel)
        if (data.type === 'loop' || data.type === 'parallel') {
          // Create a unique ID and name for the container
          const id = crypto.randomUUID()
          const baseName = data.type === 'loop' ? 'Loop' : 'Parallel'
          const name = getUniqueBlockName(baseName, blocks)

          // Subflows cannot be dropped inside other subflows - always add to main canvas
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
          let autoConnectEdge
          if (isAutoConnectEnabled) {
            const closestBlock = findClosestOutput(position)
            if (closestBlock) {
              const sourceHandle = determineSourceHandle(closestBlock)
              autoConnectEdge = {
                id: crypto.randomUUID(),
                source: closestBlock.id,
                target: id,
                sourceHandle,
                targetHandle: 'target',
                type: 'workflowEdge',
              }
            }
          }

          // Add the container node with default dimensions and auto-connect edge
          addBlock(
            id,
            data.type,
            name,
            position,
            {
              width: 500,
              height: 300,
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
        const baseName =
          data.type === 'loop'
            ? 'Loop'
            : data.type === 'parallel'
              ? 'Parallel'
              : defaultTriggerNameDrop || blockConfig!.name
        const name = getUniqueBlockName(baseName, blocks)

        if (containerInfo) {
          // Check if this is a trigger block or has trigger mode enabled
          const isTriggerBlock =
            blockConfig.category === 'triggers' ||
            blockConfig.triggers?.enabled ||
            data.enableTriggerMode === true

          if (isTriggerBlock) {
            const triggerName = TriggerUtils.getDefaultTriggerName(data.type) || 'trigger'
            setTriggerWarning({
              open: true,
              triggerName,
              type: TriggerWarningType.TRIGGER_IN_SUBFLOW,
            })
            return
          }

          // Calculate position relative to the container's content area
          // Account for header (50px), left padding (16px), and top padding (16px)
          const headerHeight = 50
          const leftPadding = 16
          const topPadding = 16

          const relativePosition = {
            x: position.x - containerInfo.loopPosition.x - leftPadding,
            y: position.y - containerInfo.loopPosition.y - headerHeight - topPadding,
          }

          // Capture existing child blocks before adding the new one
          const existingChildBlocks = Object.values(blocks).filter(
            (b) => b.data?.parentId === containerInfo.loopId
          )

          // Auto-connect logic for blocks inside containers
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
          let autoConnectEdge
          if (isAutoConnectEnabled && data.type !== 'starter') {
            if (existingChildBlocks.length > 0) {
              // Connect to the nearest existing child block within the container
              const closestBlock = existingChildBlocks
                .map((b) => ({
                  block: b,
                  distance: Math.sqrt(
                    (b.position.x - relativePosition.x) ** 2 +
                      (b.position.y - relativePosition.y) ** 2
                  ),
                }))
                .sort((a, b) => a.distance - b.distance)[0]?.block

              if (closestBlock) {
                // Don't create edges into trigger blocks
                const targetBlockConfig = getBlock(data.type)
                const isTargetTrigger =
                  data.enableTriggerMode === true || targetBlockConfig?.category === 'triggers'

                if (!isTargetTrigger) {
                  const sourceHandle = determineSourceHandle({
                    id: closestBlock.id,
                    type: closestBlock.type,
                  })
                  autoConnectEdge = {
                    id: crypto.randomUUID(),
                    source: closestBlock.id,
                    target: id,
                    sourceHandle,
                    targetHandle: 'target',
                    type: 'workflowEdge',
                  }
                }
              }
            } else {
              // No existing children: connect from the container's start handle to the moved node
              const containerNode = getNodes().find((n) => n.id === containerInfo.loopId)
              const startSourceHandle =
                (containerNode?.data as any)?.kind === 'loop'
                  ? 'loop-start-source'
                  : 'parallel-start-source'

              autoConnectEdge = {
                id: crypto.randomUUID(),
                source: containerInfo.loopId,
                target: id,
                sourceHandle: startSourceHandle,
                targetHandle: 'target',
                type: 'workflowEdge',
              }
            }
          }

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
          const dropIssue = TriggerUtils.getTriggerAdditionIssue(blocks, data.type)
          if (dropIssue) {
            setTriggerWarning({
              open: true,
              triggerName: dropIssue.triggerName,
              type:
                dropIssue.issue === 'legacy'
                  ? TriggerWarningType.LEGACY_INCOMPATIBILITY
                  : TriggerWarningType.DUPLICATE_TRIGGER,
            })
            return
          }

          // Regular auto-connect logic
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
          let autoConnectEdge
          if (isAutoConnectEnabled && data.type !== 'starter') {
            const closestBlock = findClosestOutput(position)
            if (closestBlock) {
              // Don't create edges into trigger blocks
              const targetBlockConfig = getBlock(data.type)
              const isTargetTrigger =
                data.enableTriggerMode === true || targetBlockConfig?.category === 'triggers'

              if (!isTargetTrigger) {
                const sourceHandle = determineSourceHandle(closestBlock)

                autoConnectEdge = {
                  id: crypto.randomUUID(),
                  source: closestBlock.id,
                  target: id,
                  sourceHandle,
                  targetHandle: 'target',
                  type: 'workflowEdge',
                }
              }
            }
          }

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
        logger.error('Error dropping block:', { err })
      }
    },
    [
      project,
      blocks,
      addBlock,
      addEdge,
      findClosestOutput,
      determineSourceHandle,
      isPointInLoopNode,
      getNodes,
      setTriggerWarning,
    ]
  )

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<Element>) => {
      const target = event.currentTarget as HTMLElement
      const bounds = target.getBoundingClientRect()

      const position = project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })

      emitCursorUpdate(position)
    },
    [project, emitCursorUpdate]
  )

  const handleCanvasPointerLeave = useCallback(() => {
    emitCursorUpdate(null)
  }, [emitCursorUpdate])

  useEffect(() => {
    return () => {
      emitCursorUpdate(null)
    }
  }, [emitCursorUpdate])

  // Handle drag over for ReactFlow canvas
  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      // Only handle toolbar items
      if (!event.dataTransfer?.types.includes('application/json')) return

      try {
        const reactFlowBounds = event.currentTarget.getBoundingClientRect()
        const position = project({
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
              (containerNode.data as any)?.kind === 'loop'
            ) {
              containerElement.classList.add('loop-node-drag-over')
            } else if (
              containerNode?.type === 'subflowNode' &&
              (containerNode.data as any)?.kind === 'parallel'
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
    [project, isPointInLoopNode, getNodes]
  )

  // Initialize workflow when it exists in registry and isn't active
  useEffect(() => {
    const currentId = params.workflowId as string
    if (!currentId || !workflows[currentId]) return

    if (activeWorkflowId !== currentId) {
      // Clear diff and set as active
      const { clearDiff } = useWorkflowDiffStore.getState()
      clearDiff()
      setActiveWorkflow(currentId)
    }
  }, [params.workflowId, workflows, activeWorkflowId, setActiveWorkflow])

  // Track when workflow is ready for rendering
  useEffect(() => {
    const currentId = params.workflowId as string

    // Workflow is ready when:
    // 1. We have an active workflow that matches the URL
    // 2. The workflow exists in the registry
    // 3. Workflows are not currently loading
    const shouldBeReady =
      activeWorkflowId === currentId && Boolean(workflows[currentId]) && !isLoading

    setIsWorkflowReady(shouldBeReady)
  }, [activeWorkflowId, params.workflowId, workflows, isLoading])

  const loadWorkspaceEnvironment = useEnvironmentStore((state) => state.loadWorkspaceEnvironment)
  const clearWorkspaceEnvCache = useEnvironmentStore((state) => state.clearWorkspaceEnvCache)
  const prevWorkspaceIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    if (prevWorkspaceIdRef.current && prevWorkspaceIdRef.current !== workspaceId) {
      clearWorkspaceEnvCache(prevWorkspaceIdRef.current)
    }
    void loadWorkspaceEnvironment(workspaceId)

    prevWorkspaceIdRef.current = workspaceId
  }, [workspaceId, loadWorkspaceEnvironment, clearWorkspaceEnvCache])

  // Handle navigation and validation
  useEffect(() => {
    const validateAndNavigate = async () => {
      const workflowIds = Object.keys(workflows)
      const currentId = params.workflowId as string

      // Wait for initial load to complete before making navigation decisions
      if (!hasWorkflowsInitiallyLoaded() || isLoading) {
        return
      }

      // If no workflows exist after loading, redirect to workspace root
      if (workflowIds.length === 0) {
        logger.info('No workflows found, redirecting to workspace root')
        router.replace(`/workspace/${workspaceId}/w`)
        return
      }

      // Navigate to existing workflow or first available
      if (!workflows[currentId]) {
        logger.info(`Workflow ${currentId} not found, redirecting to first available workflow`)

        // Validate that workflows belong to the current workspace before redirecting
        const workspaceWorkflows = workflowIds.filter((id) => {
          const workflow = workflows[id]
          return workflow.workspaceId === workspaceId
        })

        if (workspaceWorkflows.length > 0) {
          router.replace(`/workspace/${workspaceId}/w/${workspaceWorkflows[0]}`)
        } else {
          // No valid workflows for this workspace, redirect to workspace root
          router.replace(`/workspace/${workspaceId}/w`)
        }
        return
      }

      // Validate that the current workflow belongs to the current workspace
      const currentWorkflow = workflows[currentId]
      if (currentWorkflow && currentWorkflow.workspaceId !== workspaceId) {
        logger.warn(
          `Workflow ${currentId} belongs to workspace ${currentWorkflow.workspaceId}, not ${workspaceId}`
        )
        // Redirect to the correct workspace for this workflow
        router.replace(`/workspace/${currentWorkflow.workspaceId}/w/${currentId}`)
        return
      }
    }

    validateAndNavigate()
  }, [params.workflowId, workflows, isLoading, workspaceId, router])

  // Cache block configs to prevent unnecessary re-fetches
  const blockConfigCache = useRef<Map<string, any>>(new Map())
  const getBlockConfig = useCallback((type: string) => {
    if (!blockConfigCache.current.has(type)) {
      blockConfigCache.current.set(type, getBlock(type))
    }
    return blockConfigCache.current.get(type)
  }, [])

  // Track previous blocks hash to prevent unnecessary recalculations
  const prevBlocksHashRef = useRef<string>('')
  const prevBlocksRef = useRef(blocks)

  // Create a stable hash of block properties that affect node rendering
  // This prevents nodes from recreating when only subblock values change
  const blocksHash = useMemo(() => {
    // Only recalculate hash if blocks reference actually changed
    if (prevBlocksRef.current === blocks) {
      return prevBlocksHashRef.current
    }

    prevBlocksRef.current = blocks
    const hash = Object.values(blocks)
      .map((b) => {
        const width = typeof b.data?.width === 'number' ? b.data.width : ''
        const height = typeof b.data?.height === 'number' ? b.data.height : ''
        return `${b.id}:${b.type}:${b.name}:${b.position.x.toFixed(0)}:${b.position.y.toFixed(0)}:${b.height}:${b.data?.parentId || ''}:${width}:${height}`
      })
      .join('|')

    prevBlocksHashRef.current = hash
    return hash
  }, [blocks])

  // Transform blocks and loops into ReactFlow nodes
  const nodes = useMemo(() => {
    const nodeArray: any[] = []

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
            width: block.data?.width || 500,
            height: block.data?.height || 300,
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
        width: 250, // Standard width for both block types
        height: Math.max(block.height || 100, 100), // Use calculated height with minimum
      })
    })

    return nodeArray
  }, [blocksHash, blocks, activeBlockIds, pendingBlocks, isDebugging, getBlockConfig])

  // Update nodes - use store version to avoid collaborative feedback loops
  const onNodesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const node = nodes.find((n) => n.id === change.id)
          if (!node) return
          // Use store version to avoid collaborative feedback loop
          // React Flow position changes can be triggered by collaborative updates
          storeUpdateBlockPosition(change.id, change.position)
        }
      })
    },
    [nodes, storeUpdateBlockPosition]
  )

  /**
   * Effect to resize loops when nodes change (add/remove/position change).
   * Runs on every node change for immediate responsiveness.
   */
  useEffect(() => {
    // Skip during initial render when nodes aren't loaded yet
    if (nodes.length === 0) return

    // Resize all loops to fit their children
    resizeLoopNodesWrapper()

    // No need for cleanup with direct function
    return () => {}
  }, [nodes, resizeLoopNodesWrapper])

  // Special effect to handle cleanup after node deletion
  useEffect(() => {
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
  }, [blocks, collaborativeUpdateBlockPosition, updateParentId, getNodeAbsolutePosition])

  // Update edges
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
   * Captures the source handle when a connection drag starts
   */
  const onConnectStart = useCallback((_event: any, params: any) => {
    const handleId: string | undefined = params?.handleId
    // Treat explicit error handle (id === 'error') as error connection
    setIsErrorConnectionDrag(handleId === 'error')
  }, [])

  /**
   * Resets the source handle when connection drag ends
   */
  const onConnectEnd = useCallback(() => {
    setIsErrorConnectionDrag(false)
  }, [])

  // Handle connections with improved parent tracking
  const onConnect = useCallback(
    (connection: any) => {
      if (connection.source && connection.target) {
        // Prevent self-connections
        if (connection.source === connection.target) {
          return
        }

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
    [addEdge, getNodes]
  )

  // Handle node drag to detect intersections with container nodes
  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: any) => {
      // Store currently dragged node ID
      setDraggedNodeId(node.id)

      // Emit collaborative position update during drag for smooth real-time movement
      collaborativeUpdateBlockPosition(node.id, node.position, false)

      // Get the current parent ID of the node being dragged
      const currentParentId = blocks[node.id]?.data?.parentId || null

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
          const nodeWidth = node.type === 'subflowNode' ? node.data?.width || 500 : 250 // All workflow blocks use w-[250px] in workflow-block.tsx

          const nodeHeight =
            node.type === 'subflowNode'
              ? node.data?.height || 300
              : Math.max(node.height || 100, 100) // Use actual node height with minimum 100

          // Check intersection using absolute coordinates
          const nodeRect = {
            left: nodeAbsolutePos.x,
            right: nodeAbsolutePos.x + nodeWidth,
            top: nodeAbsolutePos.y,
            bottom: nodeAbsolutePos.y + nodeHeight,
          }

          const containerRect = {
            left: containerAbsolutePos.x,
            right: containerAbsolutePos.x + (n.data?.width || 500),
            top: containerAbsolutePos.y,
            bottom: containerAbsolutePos.y + (n.data?.height || 300),
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
          size: (n.data?.width || 500) * (n.data?.height || 300),
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
            (bestContainerMatch.container.data as any)?.kind === 'loop'
          ) {
            containerElement.classList.add('loop-node-drag-over')
          } else if (
            bestContainerMatch.container.type === 'subflowNode' &&
            (bestContainerMatch.container.data as any)?.kind === 'parallel'
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
      collaborativeUpdateBlockPosition,
    ]
  )

  // Add in a nodeDrag start event to set the dragStartParentId
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

  // Handle node drag stop to establish parent-child relationships
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: any) => {
      // Clear UI effects
      document.querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over').forEach((el) => {
        el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
      })
      document.body.style.cursor = ''

      // Emit collaborative position update for the final position
      // This ensures other users see the smooth final position
      collaborativeUpdateBlockPosition(node.id, node.position, true)

      // Record single move entry on drag end to avoid micro-moves
      try {
        const start = getDragStartPosition()
        if (start && start.id === node.id) {
          const before = { x: start.x, y: start.y, parentId: start.parentId }
          const after = {
            x: node.position.x,
            y: node.position.y,
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
      } catch {}

      // Don't process parent changes if the node hasn't actually changed parent or is being moved within same parent
      if (potentialParentId === dragStartParentId) return

      // Check if this is a starter block - starter blocks should never be in containers
      const isStarterBlock = node.data?.type === 'starter'
      if (isStarterBlock) {
        logger.warn('Prevented starter block from being placed inside a container', {
          blockId: node.id,
          attemptedParentId: potentialParentId,
        })
        // Reset state without updating parent
        setDraggedNodeId(null)
        setPotentialParentId(null)
        return // Exit early - don't allow starter blocks to have parents
      }

      // Subflow nodes cannot be placed inside other subflows
      // This check is redundant with onNodeDrag but serves as a safety guard
      if (node.type === 'subflowNode' && potentialParentId) {
        logger.warn('Prevented subflow node from being placed inside a container', {
          blockId: node.id,
          attemptedParentId: potentialParentId,
        })
        // Reset state without updating parent
        setDraggedNodeId(null)
        setPotentialParentId(null)
        return
      }

      // Trigger blocks cannot be placed inside loop or parallel subflows
      if (potentialParentId) {
        const block = blocks[node.id]
        if (block && TriggerUtils.isTriggerBlock(block)) {
          const triggerName = TriggerUtils.getDefaultTriggerName(block.type) || 'trigger'
          setTriggerWarning({
            open: true,
            triggerName,
            type: TriggerWarningType.TRIGGER_IN_SUBFLOW,
          })
          logger.warn('Prevented trigger block from being placed inside a container', {
            blockId: node.id,
            blockType: block.type,
            attemptedParentId: potentialParentId,
          })
          // Reset state without updating parent
          setDraggedNodeId(null)
          setPotentialParentId(null)
          return
        }
      }

      // Update the node's parent relationship
      if (potentialParentId) {
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

        // Prepare edges that will be added when moving into the container
        const edgesToAdd: any[] = []

        // Auto-connect when moving an existing block into a container
        const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
        if (isAutoConnectEnabled) {
          // Existing children in the target container (excluding the moved node)
          const existingChildBlocks = Object.values(blocks).filter(
            (b) => b.data?.parentId === potentialParentId && b.id !== node.id
          )

          if (existingChildBlocks.length > 0) {
            // Connect from nearest existing child inside the container
            const closestBlock = existingChildBlocks
              .map((b) => ({
                block: b,
                distance: Math.sqrt(
                  (b.position.x - relativePositionBefore.x) ** 2 +
                    (b.position.y - relativePositionBefore.y) ** 2
                ),
              }))
              .sort((a, b) => a.distance - b.distance)[0]?.block

            if (closestBlock) {
              const sourceHandle = determineSourceHandle({
                id: closestBlock.id,
                type: closestBlock.type,
              })
              edgesToAdd.push({
                id: crypto.randomUUID(),
                source: closestBlock.id,
                target: node.id,
                sourceHandle,
                targetHandle: 'target',
                type: 'workflowEdge',
              })
            }
          } else {
            // No children: connect from the container's start handle to the moved node
            const containerNode = getNodes().find((n) => n.id === potentialParentId)
            const startSourceHandle =
              (containerNode?.data as any)?.kind === 'loop'
                ? 'loop-start-source'
                : 'parallel-start-source'

            edgesToAdd.push({
              id: crypto.randomUUID(),
              source: potentialParentId,
              target: node.id,
              sourceHandle: startSourceHandle,
              targetHandle: 'target',
              type: 'workflowEdge',
            })
          }
        }

        // Skip recording these edges separately since they're part of the parent update
        window.dispatchEvent(new CustomEvent('skip-edge-recording', { detail: { skip: true } }))

        // Moving to a new parent container - pass the edges that will be added
        updateNodeParent(node.id, potentialParentId, edgesToAdd)

        // Now add the edges after parent update
        edgesToAdd.forEach((edge) => addEdge(edge))

        window.dispatchEvent(new CustomEvent('skip-edge-recording', { detail: { skip: false } }))
      }

      // Reset state
      setDraggedNodeId(null)
      setPotentialParentId(null)
    },
    [
      getNodes,
      dragStartParentId,
      potentialParentId,
      updateNodeParent,
      collaborativeUpdateBlockPosition,
      addEdge,
      determineSourceHandle,
      blocks,
      getNodeAbsolutePosition,
      getDragStartPosition,
      setDragStartPosition,
    ]
  )

  // Update onPaneClick to only handle edge selection
  const onPaneClick = useCallback(() => {
    setSelectedEdgeInfo(null)
    try {
      // Clear current design selection when clicking on empty canvas
      usePanelEditorStore.getState().clearCurrentBlock()
    } catch {}
  }, [])

  // Edge selection
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

  // Transform edges to include improved selection state
  const edgesWithSelection = edgesForDisplay.map((edge) => {
    // Check if this edge connects nodes inside a loop
    const sourceNode = getNodes().find((n) => n.id === edge.source)
    const targetNode = getNodes().find((n) => n.id === edge.target)
    const parentLoopId = sourceNode?.parentId || targetNode?.parentId
    const isInsideLoop = Boolean(parentLoopId)

    // Create a unique context ID for this edge
    const edgeContextId = `${edge.id}${parentLoopId ? `-${parentLoopId}` : ''}`

    // Determine if this edge is selected using context-aware matching
    const isSelected = selectedEdgeInfo?.contextId === edgeContextId

    return {
      ...edge,
      data: {
        // Preserve original edge data
        ...edge.data,
        // Send only necessary data to the edge component
        isSelected,
        isInsideLoop,
        parentLoopId,
        sourceHandle: edge.sourceHandle,
        onDelete: (edgeId: string) => {
          // Log deletion for debugging

          // Only delete this specific edge
          removeEdge(edgeId)

          // Only clear selection if this was the selected edge
          if (selectedEdgeInfo?.id === edgeId) {
            setSelectedEdgeInfo(null)
          }
        },
      },
    }
  })

  // Handle keyboard shortcuts with better edge tracking
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeInfo) {
        // Only delete the specific selected edge
        removeEdge(selectedEdgeInfo.id)
        setSelectedEdgeInfo(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEdgeInfo, removeEdge])

  // Handle sub-block value updates from custom events
  useEffect(() => {
    const handleSubBlockValueUpdate = (event: CustomEvent) => {
      const { blockId, subBlockId, value } = event.detail
      if (blockId && subBlockId) {
        // Use collaborative function to go through queue system
        // This ensures 5-second timeout and error detection work
        collaborativeSetSubblockValue(blockId, subBlockId, value)
      }
    }

    window.addEventListener('update-subblock-value', handleSubBlockValueUpdate as EventListener)

    return () => {
      window.removeEventListener(
        'update-subblock-value',
        handleSubBlockValueUpdate as EventListener
      )
    }
  }, [collaborativeSetSubblockValue])

  // Show skeleton UI while loading until the workflow store is hydrated
  const showSkeletonUI = !isWorkflowReady

  if (showSkeletonUI) {
    return (
      <div className='flex h-screen w-full flex-col overflow-hidden'>
        <div className='relative h-full w-full flex-1 transition-all duration-200'>
          <div className='workflow-container h-full' />
        </div>
        <Panel />
        <Terminal />
      </div>
    )
  }

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden'>
      <div className='relative h-full w-full flex-1 transition-all duration-200'>
        {/* Training Controls - for recording workflow edits */}
        <TrainingControls />

        <ReactFlow
          nodes={nodes}
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
          fitView
          fitViewOptions={{ padding: 0.6 }}
          onInit={(instance) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                instance.fitView({ padding: 0.3 })
              })
            })
          }}
          minZoom={0.1}
          maxZoom={1.3}
          panOnScroll
          defaultEdgeOptions={defaultEdgeOptions}
          proOptions={{ hideAttribution: true }}
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
          className='workflow-container h-full'
          onNodeDrag={effectivePermissions.canEdit ? onNodeDrag : undefined}
          onNodeDragStop={effectivePermissions.canEdit ? onNodeDragStop : undefined}
          onNodeDragStart={effectivePermissions.canEdit ? onNodeDragStart : undefined}
          snapToGrid={false}
          snapGrid={snapGrid}
          elevateEdgesOnSelect={true}
          // Performance optimizations
          onlyRenderVisibleElements={true}
          deleteKeyCode={null}
          elevateNodesOnSelect={true}
          autoPanOnConnect={effectivePermissions.canEdit}
          autoPanOnNodeDrag={effectivePermissions.canEdit}
        />

        <Cursors />

        {/* Floating chat modal */}
        <Chat />

        {/* Show DiffControls if diff is available (regardless of current view mode) */}
        <DiffControls />

        {/* Trigger warning dialog */}
        <TriggerWarningDialog
          open={triggerWarning.open}
          onOpenChange={(open) => setTriggerWarning({ ...triggerWarning, open })}
          triggerName={triggerWarning.triggerName}
          type={triggerWarning.type}
        />

        {/* Trigger list for empty workflows - only show after workflow has loaded and hydrated */}
        {isWorkflowReady && isWorkflowEmpty && effectivePermissions.canEdit && <CommandList />}

        <Panel />
      </div>

      <Terminal />
    </div>
  )
})

WorkflowContent.displayName = 'WorkflowContent'

// Workflow wrapper
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
