'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ControlBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/control-bar'
import { DiffControls } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/diff-controls'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error/index'
import { Panel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  getNodeAbsolutePosition,
  getNodeDepth,
  getNodeHierarchy,
  isPointInLoopNode,
  resizeLoopNodes,
  updateNodeParent as updateNodeParentUtil,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { getBlock } from '@/blocks'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useStreamCleanup } from '@/hooks/use-stream-cleanup'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { useCopilotStore } from '@/stores/copilot/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { hasWorkflowsInitiallyLoaded, useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('Workflow')

// Define custom node and edge types
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  subflowNode: SubflowNodeComponent,
}
const edgeTypes: EdgeTypes = { workflowEdge: WorkflowEdge }

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
  // State for tracking validation errors
  const [nestedSubflowErrors, setNestedSubflowErrors] = useState<Set<string>>(new Set())
  // Enhanced edge selection with parent context and unique identifier
  const [selectedEdgeInfo, setSelectedEdgeInfo] = useState<SelectedEdgeInfo | null>(null)

  // Hooks
  const params = useParams()
  const router = useRouter()
  const { project, getNodes, fitView } = useReactFlow()

  // Get workspace ID from the params
  const workspaceId = params.workspaceId as string

  const { workflows, activeWorkflowId, isLoading, setActiveWorkflow, createWorkflow } =
    useWorkflowRegistry()

  // Use the clean abstraction for current workflow state
  const currentWorkflow = useCurrentWorkflow()

  const { updateNodeDimensions, updateBlockPosition: storeUpdateBlockPosition } = useWorkflowStore()

  // Get copilot cleanup function
  const copilotCleanup = useCopilotStore((state) => state.cleanup)

  // Handle copilot stream cleanup on page unload and component unmount
  useStreamCleanup(copilotCleanup)

  // Extract workflow data from the abstraction
  const { blocks, edges, loops, parallels, isDiffMode } = currentWorkflow

  // Get diff analysis for edge reconstruction
  const { diffAnalysis, isShowingDiff, isDiffReady } = useWorkflowDiffStore()

  // Reconstruct deleted edges when viewing original workflow
  const edgesForDisplay = useMemo(() => {
    // If we're not in diff mode and we have diff analysis with deleted edges,
    // we need to reconstruct those deleted edges and add them to the display
    // Only do this if diff is ready to prevent race conditions
    if (!isShowingDiff && isDiffReady && diffAnalysis?.edge_diff?.deleted_edges) {
      const reconstructedEdges: Edge[] = []

      // Parse deleted edge identifiers to reconstruct edges
      diffAnalysis.edge_diff.deleted_edges.forEach((edgeIdentifier) => {
        // Edge identifier format: "sourceId-source-targetId-target"
        // Parse this to extract the components
        const match = edgeIdentifier.match(/^([^-]+)-source-([^-]+)-target$/)
        if (match) {
          const [, sourceId, targetId] = match

          // Only reconstruct if both blocks still exist
          if (blocks[sourceId] && blocks[targetId]) {
            // Generate a unique edge ID
            const edgeId = `deleted-edge-${sourceId}-${targetId}`

            reconstructedEdges.push({
              id: edgeId,
              source: sourceId,
              target: targetId,
              sourceHandle: null, // Default handle
              targetHandle: null, // Default handle
              type: 'workflowEdge',
            })
          }
        }
      })

      // Combine existing edges with reconstructed deleted edges
      return [...edges, ...reconstructedEdges]
    }

    // Otherwise, just use the edges as-is
    return edges
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
  } = useCollaborativeWorkflow()

  // Execution and debug mode state
  const { activeBlockIds, pendingBlocks } = useExecutionStore()
  const { isDebugModeEnabled } = useGeneralStore()
  const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

  // Helper function to validate workflow for nested subflows
  const validateNestedSubflows = useCallback(() => {
    const errors = new Set<string>()

    Object.entries(blocks).forEach(([blockId, block]) => {
      // Check if this is a subflow block (loop or parallel)
      if (block.type === 'loop' || block.type === 'parallel') {
        // Check if it has a parent that is also a subflow block
        const parentId = block.data?.parentId
        if (parentId) {
          const parentBlock = blocks[parentId]
          if (parentBlock && (parentBlock.type === 'loop' || parentBlock.type === 'parallel')) {
            // This is a nested subflow - mark as error
            errors.add(blockId)
          }
        }
      }
    })

    setNestedSubflowErrors(errors)
    return errors.size === 0
  }, [blocks])

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

  // Helper function to update a node's parent with proper position calculation
  const updateNodeParent = useCallback(
    (nodeId: string, newParentId: string | null) => {
      return updateNodeParentUtil(
        nodeId,
        newParentId,
        getNodes,
        collaborativeUpdateBlockPosition,
        updateParentId,
        () => resizeLoopNodes(getNodes, updateNodeDimensions, blocks)
      )
    },
    [getNodes, collaborativeUpdateBlockPosition, updateParentId, updateNodeDimensions, blocks]
  )

  // Function to resize all loop nodes with improved hierarchy handling
  const resizeLoopNodesWrapper = useCallback(() => {
    return resizeLoopNodes(getNodes, updateNodeDimensions, blocks)
  }, [getNodes, updateNodeDimensions, blocks])

  // Wrapper functions that use the utilities but provide the getNodes function
  const getNodeDepthWrapper = useCallback(
    (nodeId: string): number => {
      return getNodeDepth(nodeId, getNodes)
    },
    [getNodes]
  )

  const getNodeHierarchyWrapper = useCallback(
    (nodeId: string): string[] => {
      return getNodeHierarchy(nodeId, getNodes)
    },
    [getNodes]
  )

  const getNodeAbsolutePositionWrapper = useCallback(
    (nodeId: string): { x: number; y: number } => {
      return getNodeAbsolutePosition(nodeId, getNodes)
    },
    [getNodes]
  )

  const isPointInLoopNodeWrapper = useCallback(
    (position: { x: number; y: number }) => {
      return isPointInLoopNode(position, getNodes)
    },
    [getNodes]
  )

  // Compute the absolute position of a node's source anchor (right-middle)
  const getNodeAnchorPosition = useCallback(
    (nodeId: string): { x: number; y: number } => {
      const node = getNodes().find((n) => n.id === nodeId)
      const absPos = getNodeAbsolutePositionWrapper(nodeId)

      if (!node) {
        return absPos
      }

      // Use known defaults per node type without type casting
      const isSubflow = node.type === 'subflowNode'
      const width = isSubflow
        ? typeof node.data?.width === 'number'
          ? node.data.width
          : 500
        : typeof node.width === 'number'
          ? node.width
          : 350
      const height = isSubflow
        ? typeof node.data?.height === 'number'
          ? node.data.height
          : 300
        : typeof node.height === 'number'
          ? node.height
          : 100

      return {
        x: absPos.x + width,
        y: absPos.y + height / 2,
      }
    },
    [getNodes, getNodeAbsolutePositionWrapper]
  )

  // Auto-layout handler - now uses frontend auto layout for immediate updates
  const handleAutoLayout = useCallback(async () => {
    if (Object.keys(blocks).length === 0) return

    try {
      // Use the shared auto layout utility for immediate frontend updates
      const { applyAutoLayoutAndUpdateStore } = await import('./utils/auto-layout')

      const result = await applyAutoLayoutAndUpdateStore(activeWorkflowId!)

      if (result.success) {
        logger.info('Auto layout completed successfully')
      } else {
        logger.error('Auto layout failed:', result.error)
      }
    } catch (error) {
      logger.error('Auto layout error:', error)
    }
  }, [activeWorkflowId, blocks])

  const debouncedAutoLayout = useCallback(() => {
    const debounceTimer = setTimeout(() => {
      handleAutoLayout()
    }, 250)

    return () => clearTimeout(debounceTimer)
  }, [handleAutoLayout])

  useEffect(() => {
    let cleanup: (() => void) | null = null

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key === 'L' && !event.ctrlKey && !event.metaKey) {
        // Don't trigger if user is typing in an input, textarea, or contenteditable element
        const activeElement = document.activeElement
        const isEditableElement =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.hasAttribute('contenteditable')

        if (isEditableElement) {
          return // Allow normal typing behavior
        }

        event.preventDefault()

        if (cleanup) cleanup()

        cleanup = debouncedAutoLayout()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (cleanup) cleanup()
    }
  }, [debouncedAutoLayout])

  // Listen for explicit remove-from-subflow actions from ActionBar
  useEffect(() => {
    const handleRemoveFromSubflow = (event: Event) => {
      const customEvent = event as CustomEvent<{ blockId: string }>
      const { blockId } = customEvent.detail || ({} as any)
      if (!blockId) return

      try {
        // Remove parent-child relationship while preserving absolute position
        updateNodeParent(blockId, null)

        // Remove all edges connected to this block
        const connectedEdges = edgesForDisplay.filter(
          (e) => e.source === blockId || e.target === blockId
        )

        connectedEdges.forEach((edge) => {
          removeEdge(edge.id)
        })
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
      const containerAtPoint = isPointInLoopNodeWrapper(newNodePosition)
      const nodeIndex = new Map(getNodes().map((n) => [n.id, n]))

      const candidates = Object.entries(blocks)
        .filter(([id, block]) => {
          if (!block.enabled) return false
          const node = nodeIndex.get(id)
          if (!node) return false

          // If dropping outside containers, ignore blocks that are inside a container
          if (!containerAtPoint && node.parentId) return false
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
    [blocks, getNodes, getNodeAnchorPosition, isPointInLoopNodeWrapper]
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

      const { type } = event.detail

      if (!type) return
      if (type === 'connectionBlock') return

      // Special handling for container nodes (loop or parallel)
      if (type === 'loop' || type === 'parallel') {
        // Create a unique ID and name for the container
        const id = crypto.randomUUID()

        // Auto-number the blocks based on existing blocks of the same type
        const existingBlocksOfType = Object.values(blocks).filter((b) => b.type === type)
        const blockNumber = existingBlocksOfType.length + 1
        const name = type === 'loop' ? `Loop ${blockNumber}` : `Parallel ${blockNumber}`

        // Calculate the center position of the viewport
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
            // Get appropriate source handle
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

        // Add the container node directly to canvas with default dimensions and auto-connect edge
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
      const name = `${blockConfig.name} ${Object.values(blocks).filter((b) => b.type === type).length + 1}`

      // Auto-connect logic
      const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
      let autoConnectEdge
      if (isAutoConnectEnabled && type !== 'starter') {
        const closestBlock = findClosestOutput(centerPosition)
        logger.info('Closest block found:', closestBlock)
        if (closestBlock) {
          // Get appropriate source handle
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
        }
      }

      // Add the block to the workflow with auto-connect edge
      addBlock(id, type, name, centerPosition, undefined, undefined, undefined, autoConnectEdge)
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
  ])

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
        const containerInfo = isPointInLoopNodeWrapper(position)

        // Clear any drag-over styling
        document
          .querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over')
          .forEach((el) => {
            el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
          })
        document.body.style.cursor = ''

        // Special handling for container nodes (loop or parallel)
        if (data.type === 'loop' || data.type === 'parallel') {
          // Create a unique ID and name for the container
          const id = crypto.randomUUID()

          // Auto-number the blocks based on existing blocks of the same type
          const existingBlocksOfType = Object.values(blocks).filter((b) => b.type === data.type)
          const blockNumber = existingBlocksOfType.length + 1
          const name = data.type === 'loop' ? `Loop ${blockNumber}` : `Parallel ${blockNumber}`

          // Check if we're dropping inside another container
          if (containerInfo) {
            // Calculate position relative to the parent container
            const relativePosition = {
              x: position.x - containerInfo.loopPosition.x,
              y: position.y - containerInfo.loopPosition.y,
            }

            // Add the container as a child of the parent container (will be marked as error)
            addBlock(id, data.type, name, relativePosition, {
              width: 500,
              height: 300,
              type: 'subflowNode',
              parentId: containerInfo.loopId,
              extent: 'parent',
            })

            // Resize the parent container to fit the new child container
            resizeLoopNodesWrapper()
          } else {
            // Auto-connect the container to the closest node on the canvas
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

            // Add the container node directly to canvas with default dimensions and auto-connect edge
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
          }

          return
        }

        const blockConfig = getBlock(data.type)
        if (!blockConfig && data.type !== 'loop' && data.type !== 'parallel') {
          logger.error('Invalid block type:', { data })
          return
        }

        // Generate id and name here so they're available in all code paths
        const id = crypto.randomUUID()
        const name =
          data.type === 'loop'
            ? `Loop ${Object.values(blocks).filter((b) => b.type === 'loop').length + 1}`
            : data.type === 'parallel'
              ? `Parallel ${Object.values(blocks).filter((b) => b.type === 'parallel').length + 1}`
              : `${blockConfig!.name} ${Object.values(blocks).filter((b) => b.type === data.type).length + 1}`

        if (containerInfo) {
          // Calculate position relative to the container node
          const relativePosition = {
            x: position.x - containerInfo.loopPosition.x,
            y: position.y - containerInfo.loopPosition.y,
          }

          // Capture existing child blocks before adding the new one
          const existingChildBlocks = Object.values(blocks).filter(
            (b) => b.data?.parentId === containerInfo.loopId
          )

          // Add block with parent info
          addBlock(id, data.type, name, relativePosition, {
            parentId: containerInfo.loopId,
            extent: 'parent',
          })

          // Resize the container node to fit the new block
          // Immediate resize without delay
          resizeLoopNodesWrapper()

          // Auto-connect logic for blocks inside containers
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
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
                const sourceHandle = determineSourceHandle({
                  id: closestBlock.id,
                  type: closestBlock.type,
                })
                addEdge({
                  id: crypto.randomUUID(),
                  source: closestBlock.id,
                  target: id,
                  sourceHandle,
                  targetHandle: 'target',
                  type: 'workflowEdge',
                })
              }
            } else {
              // No existing children: connect from the container's start handle
              const containerNode = getNodes().find((n) => n.id === containerInfo.loopId)
              const startSourceHandle =
                (containerNode?.data as any)?.kind === 'loop'
                  ? 'loop-start-source'
                  : 'parallel-start-source'

              addEdge({
                id: crypto.randomUUID(),
                source: containerInfo.loopId,
                target: id,
                sourceHandle: startSourceHandle,
                targetHandle: 'target',
                type: 'workflowEdge',
              })
            }
          }
        } else {
          // Regular auto-connect logic
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
          let autoConnectEdge
          if (isAutoConnectEnabled && data.type !== 'starter') {
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

          // Regular canvas drop with auto-connect edge
          addBlock(id, data.type, name, position, undefined, undefined, undefined, autoConnectEdge)
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
      isPointInLoopNodeWrapper,
      getNodes,
    ]
  )

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
        const containerInfo = isPointInLoopNodeWrapper(position)

        // Clear any previous highlighting
        document
          .querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over')
          .forEach((el) => {
            el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
          })

        // If hovering over a container node, highlight it
        if (containerInfo) {
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
    [project, isPointInLoopNodeWrapper, getNodes]
  )

  // Track when workflow is fully ready for rendering
  useEffect(() => {
    const currentId = params.workflowId as string

    // Reset workflow ready state when workflow changes
    if (activeWorkflowId !== currentId) {
      setIsWorkflowReady(false)
      return
    }

    // Check if we have the necessary data to render the workflow
    const hasActiveWorkflow = activeWorkflowId === currentId
    const hasWorkflowInRegistry = Boolean(workflows[currentId])
    const isNotLoading = !isLoading

    // Workflow is ready when:
    // 1. We have an active workflow that matches the URL
    // 2. The workflow exists in the registry
    // 3. Workflows are not currently loading
    if (hasActiveWorkflow && hasWorkflowInRegistry && isNotLoading) {
      // Add a small delay to ensure blocks state has settled
      const timeoutId = setTimeout(() => {
        setIsWorkflowReady(true)
      }, 100)

      return () => clearTimeout(timeoutId)
    }
    setIsWorkflowReady(false)
  }, [activeWorkflowId, params.workflowId, workflows, isLoading])

  // Init workflow
  useEffect(() => {
    const validateAndNavigate = async () => {
      const workflowIds = Object.keys(workflows)
      const currentId = params.workflowId as string

      // Check if workflows have been initially loaded at least once
      // This prevents premature navigation decisions on page refresh
      if (!hasWorkflowsInitiallyLoaded()) {
        logger.info('Waiting for initial workflow load...')
        return
      }

      // Wait for both initialization and workflow loading to complete
      if (isLoading) {
        logger.info('Workflows still loading, waiting...')
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

      // Get current active workflow state
      const { activeWorkflowId } = useWorkflowRegistry.getState()

      if (activeWorkflowId !== currentId) {
        // Clear workflow diff store when switching workflows
        const { clearDiff } = useWorkflowDiffStore.getState()
        clearDiff()

        setActiveWorkflow(currentId)
      } else {
        // Don't reset variables cache if we're not actually switching workflows
        setActiveWorkflow(currentId)
      }
    }

    validateAndNavigate()
  }, [params.workflowId, workflows, isLoading, setActiveWorkflow, createWorkflow, router])

  // Transform blocks and loops into ReactFlow nodes
  const nodes = useMemo(() => {
    const nodeArray: any[] = []

    // Add block nodes
    Object.entries(blocks).forEach(([blockId, block]) => {
      if (!block.type || !block.name) {
        logger.warn(`Skipping invalid block: ${blockId}`, { block })
        return
      }

      // Handle container nodes differently
      if (block.type === 'loop' || block.type === 'parallel') {
        const hasNestedError = nestedSubflowErrors.has(block.id)
        nodeArray.push({
          id: block.id,
          type: 'subflowNode',
          position: block.position,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          dragHandle: '.workflow-drag-handle',
          data: {
            ...block.data,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
            hasNestedError,
            kind: block.type === 'loop' ? 'loop' : 'parallel',
          },
        })
        return
      }

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        logger.error(`No configuration found for block type: ${block.type}`, {
          block,
        })
        return
      }

      const position = block.position

      const isActive = activeBlockIds.has(block.id)
      const isPending = isDebugModeEnabled && pendingBlocks.includes(block.id)

      nodeArray.push({
        id: block.id,
        type: 'workflowBlock',
        position,
        parentId: block.data?.parentId,
        dragHandle: '.workflow-drag-handle',
        extent: block.data?.extent || undefined,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          isActive,
          isPending,
        },
        // Include dynamic dimensions for container resizing calculations
        width: block.isWide ? 450 : 350, // Standard width based on isWide state
        height: Math.max(block.height || 100, 100), // Use actual height with minimum
      })
    })

    return nodeArray
  }, [blocks, activeBlockIds, pendingBlocks, isDebugModeEnabled, nestedSubflowErrors])

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

  // Effect to resize loops when nodes change (add/remove/position change)
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
        const absolutePosition = getNodeAbsolutePositionWrapper(id)

        // Update the node to remove parent reference and use absolute position
        collaborativeUpdateBlockPosition(id, absolutePosition)
        updateParentId(id, '', 'parent')
      }
    })
  }, [blocks, collaborativeUpdateBlockPosition, updateParentId, getNodeAbsolutePositionWrapper])

  // Validate nested subflows whenever blocks change
  useEffect(() => {
    validateNestedSubflows()
  }, [blocks, validateNestedSubflows])

  // Validate nested subflows whenever blocks change
  useEffect(() => {
    validateNestedSubflows()
  }, [blocks, validateNestedSubflows])

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
          sourceNode.parentId ||
          (connection.sourceHandle === 'loop-start-source' ||
          connection.sourceHandle === 'parallel-start-source'
            ? connection.source
            : undefined)
        const targetParentId = targetNode.parentId

        // Generate a unique edge ID
        const edgeId = crypto.randomUUID()

        // Special case for container start source: Always allow connections to nodes within the same container
        if (
          (connection.sourceHandle === 'loop-start-source' ||
            connection.sourceHandle === 'parallel-start-source') &&
          targetNode.parentId === sourceNode.id
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
      collaborativeUpdateBlockPosition(node.id, node.position)

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
      const nodeAbsolutePos = getNodeAbsolutePositionWrapper(node.id)

      // Find intersections with container nodes using absolute coordinates
      const intersectingNodes = getNodes()
        .filter((n) => {
          // Only consider container nodes that aren't the dragged node
          if (n.type !== 'subflowNode' || n.id === node.id) return false

          // Skip if this container is already the parent of the node being dragged
          if (n.id === currentParentId) return false

          // Skip self-nesting: prevent a container from becoming its own descendant
          if (node.type === 'subflowNode') {
            // Get the full hierarchy of the potential parent
            const hierarchy = getNodeHierarchyWrapper(n.id)

            // If the dragged node is in the hierarchy, this would create a circular reference
            if (hierarchy.includes(node.id)) {
              return false // Avoid circular nesting
            }
          }

          // Get the container's absolute position
          const containerAbsolutePos = getNodeAbsolutePositionWrapper(n.id)

          // Get dimensions based on node type
          const nodeWidth =
            node.type === 'subflowNode'
              ? node.data?.width || 500
              : node.type === 'condition'
                ? 250
                : 350

          const nodeHeight =
            node.type === 'subflowNode'
              ? node.data?.height || 300
              : node.type === 'condition'
                ? 150
                : 100

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
          depth: getNodeDepthWrapper(n.id),
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

        // Add a check to see if the bestContainerMatch is a part of the hierarchy of the node being dragged
        const hierarchy = getNodeHierarchyWrapper(node.id)
        if (hierarchy.includes(bestContainerMatch.container.id)) {
          setPotentialParentId(null)
          return
        }

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
      getNodeHierarchyWrapper,
      getNodeAbsolutePositionWrapper,
      getNodeDepthWrapper,
      collaborativeUpdateBlockPosition,
    ]
  )

  // Add in a nodeDrag start event to set the dragStartParentId
  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: any) => {
      // Store the original parent ID when starting to drag
      const currentParentId = node.parentId || blocks[node.id]?.data?.parentId || null
      setDragStartParentId(currentParentId)
    },
    [blocks]
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
      collaborativeUpdateBlockPosition(node.id, node.position)

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

      // If we're dragging a container node, do additional checks to prevent circular references
      if (node.type === 'subflowNode' && potentialParentId) {
        // Get the hierarchy of the potential parent container
        const parentHierarchy = getNodeHierarchyWrapper(potentialParentId)

        // If the dragged node is in the parent's hierarchy, it would create a circular reference
        if (parentHierarchy.includes(node.id)) {
          logger.warn('Prevented circular container nesting', {
            draggedNodeId: node.id,
            draggedNodeType: node.type,
            potentialParentId,
            parentHierarchy,
          })
          return
        }
      }

      // Update the node's parent relationship
      if (potentialParentId) {
        // Compute relative position BEFORE updating parent to avoid stale state
        const containerAbsPosBefore = getNodeAbsolutePositionWrapper(potentialParentId)
        const nodeAbsPosBefore = getNodeAbsolutePositionWrapper(node.id)
        const relativePositionBefore = {
          x: nodeAbsPosBefore.x - containerAbsPosBefore.x,
          y: nodeAbsPosBefore.y - containerAbsPosBefore.y,
        }

        // Moving to a new parent container
        updateNodeParent(node.id, potentialParentId)

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
              addEdge({
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

            addEdge({
              id: crypto.randomUUID(),
              source: potentialParentId,
              target: node.id,
              sourceHandle: startSourceHandle,
              targetHandle: 'target',
              type: 'workflowEdge',
            })
          }
        }
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
      getNodeHierarchyWrapper,
      collaborativeUpdateBlockPosition,
      addEdge,
      determineSourceHandle,
      blocks,
      getNodeAbsolutePositionWrapper,
    ]
  )

  // Update onPaneClick to only handle edge selection
  const onPaneClick = useCallback(() => {
    setSelectedEdgeInfo(null)
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
      type: edge.type || 'workflowEdge',
      data: {
        // Send only necessary data to the edge component
        isSelected,
        isInsideLoop,
        parentLoopId,
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

  // Show skeleton UI while loading, then smoothly transition to real content
  const showSkeletonUI = !isWorkflowReady

  if (showSkeletonUI) {
    return (
      <div className='flex h-screen w-full flex-col overflow-hidden'>
        <div className='relative h-full w-full flex-1 transition-all duration-200'>
          <div className='fixed top-0 right-0 z-10'>
            <Panel />
          </div>
          <ControlBar hasValidationErrors={nestedSubflowErrors.size > 0} />
          <div className='workflow-container h-full'>
            <Background
              color='hsl(var(--workflow-dots))'
              size={4}
              gap={40}
              style={{ backgroundColor: 'hsl(var(--workflow-background))' }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden'>
      <div className='relative h-full w-full flex-1 transition-all duration-200'>
        <div className='fixed top-0 right-0 z-10'>
          <Panel />
        </div>

        {/* Floating Control Bar */}
        <ControlBar hasValidationErrors={nestedSubflowErrors.size > 0} />

        <ReactFlow
          nodes={nodes}
          edges={edgesWithSelection}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={effectivePermissions.canEdit ? onConnect : undefined}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onDrop={effectivePermissions.canEdit ? onDrop : undefined}
          onDragOver={effectivePermissions.canEdit ? onDragOver : undefined}
          fitView
          minZoom={0.1}
          maxZoom={1.3}
          panOnScroll
          defaultEdgeOptions={{ type: 'custom' }}
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{
            stroke: '#94a3b8',
            strokeWidth: 2,
            strokeDasharray: '5,5',
          }}
          connectionLineType={ConnectionLineType.SmoothStep}
          onNodeClick={(e, _node) => {
            e.stopPropagation()
          }}
          onPaneClick={onPaneClick}
          onEdgeClick={onEdgeClick}
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
          snapGrid={[20, 20]}
          elevateEdgesOnSelect={true}
          elevateNodesOnSelect={true}
          autoPanOnConnect={effectivePermissions.canEdit}
          autoPanOnNodeDrag={effectivePermissions.canEdit}
        >
          <Background
            color='hsl(var(--workflow-dots))'
            size={4}
            gap={40}
            style={{ backgroundColor: 'hsl(var(--workflow-background))' }}
          />
        </ReactFlow>

        {/* Show DiffControls if diff is available (regardless of current view mode) */}
        <DiffControls />
      </div>
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
