'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  ConnectionLineType,
  type EdgeTypes,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'

import { LoadingAgent } from '@/components/ui/loading-agent'
import { createLogger } from '@/lib/logs/console-logger'
import { LoopNodeComponent } from '@/app/w/[id]/components/loop-node/loop-node'
import { NotificationList } from '@/app/w/[id]/components/notifications/notifications'
import { ParallelNodeComponent } from '@/app/w/[id]/components/parallel-node/parallel-node'
import { getBlock } from '@/blocks'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSidebarStore } from '@/stores/sidebar/store'
import { initializeSyncManagers, isSyncInitialized } from '@/stores/sync-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { ControlBar } from './components/control-bar/control-bar'
import { ErrorBoundary } from './components/error/index'
import { Panel } from './components/panel/panel'
import { Toolbar } from './components/toolbar/toolbar'
import { WorkflowBlock } from './components/workflow-block/workflow-block'
import { WorkflowEdge } from './components/workflow-edge/workflow-edge'
import {
  applyAutoLayoutSmooth,
  detectHandleOrientation,
  getNodeAbsolutePosition,
  getNodeDepth,
  getNodeHierarchy,
  isPointInLoopNode,
  resizeLoopNodes,
  updateNodeParent as updateNodeParentUtil,
} from './utils'

const logger = createLogger('Workflow')

// Define custom node and edge types
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  loopNode: LoopNodeComponent,
  parallelNode: ParallelNodeComponent,
}
const edgeTypes: EdgeTypes = { workflowEdge: WorkflowEdge }

function WorkflowContent() {
  // State
  const [isInitialized, setIsInitialized] = useState(false)
  const { mode, isExpanded } = useSidebarStore()
  // In hover mode, act as if sidebar is always collapsed for layout purposes
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'
  // State for tracking node dragging
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [potentialParentId, setPotentialParentId] = useState<string | null>(null)
  // Enhanced edge selection with parent context and unique identifier
  const [selectedEdgeInfo, setSelectedEdgeInfo] = useState<{
    id: string
    parentLoopId?: string
    contextId?: string // Unique identifier combining edge ID and context
  } | null>(null)
  // Hooks
  const params = useParams()
  const router = useRouter()
  const { project, getNodes, fitView } = useReactFlow()

  // Store access
  const { workflows, setActiveWorkflow, createWorkflow } = useWorkflowRegistry()
  const {
    blocks,
    edges,
    addBlock,
    updateNodeDimensions,
    updateBlockPosition,
    addEdge,
    removeEdge,
    updateParentId,
    removeBlock,
  } = useWorkflowStore()
  const { setValue: setSubBlockValue } = useSubBlockStore()
  const { markAllAsRead } = useNotificationStore()
  const { resetLoaded: resetVariablesLoaded } = useVariablesStore()

  // Execution and debug mode state
  const { activeBlockIds, pendingBlocks } = useExecutionStore()
  const { isDebugModeEnabled } = useGeneralStore()
  const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

  // Helper function to update a node's parent with proper position calculation
  const updateNodeParent = useCallback(
    (nodeId: string, newParentId: string | null) => {
      return updateNodeParentUtil(
        nodeId,
        newParentId,
        getNodes,
        updateBlockPosition,
        updateParentId,
        () => resizeLoopNodes(getNodes, updateNodeDimensions, blocks)
      )
    },
    [getNodes, updateBlockPosition, updateParentId, updateNodeDimensions, blocks]
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

  // Auto-layout handler
  const handleAutoLayout = useCallback(() => {
    if (Object.keys(blocks).length === 0) return

    // Detect the predominant handle orientation in the workflow
    const detectedOrientation = detectHandleOrientation(blocks)

    // Optimize spacing based on handle orientation
    const orientationConfig =
      detectedOrientation === 'vertical'
        ? {
            // Vertical handles: optimize for top-to-bottom flow
            horizontalSpacing: 400,
            verticalSpacing: 300,
            startX: 200,
            startY: 200,
          }
        : {
            // Horizontal handles: optimize for left-to-right flow
            horizontalSpacing: 600,
            verticalSpacing: 200,
            startX: 150,
            startY: 300,
          }

    applyAutoLayoutSmooth(blocks, edges, updateBlockPosition, fitView, resizeLoopNodesWrapper, {
      ...orientationConfig,
      alignByLayer: true,
      animationDuration: 500, // Smooth 500ms animation
      isSidebarCollapsed,
      handleOrientation: detectedOrientation, // Explicitly set the detected orientation
    })

    const orientationMessage =
      detectedOrientation === 'vertical'
        ? 'Auto-layout applied with vertical flow (top-to-bottom)'
        : 'Auto-layout applied with horizontal flow (left-to-right)'

    logger.info(orientationMessage, {
      orientation: detectedOrientation,
      blockCount: Object.keys(blocks).length,
    })
  }, [blocks, edges, updateBlockPosition, fitView, isSidebarCollapsed, resizeLoopNodesWrapper])

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

  useEffect(() => {
    let cleanup: (() => void) | null = null

    const handleAutoLayoutEvent = () => {
      if (cleanup) cleanup()

      cleanup = debouncedAutoLayout()
    }

    window.addEventListener('trigger-auto-layout', handleAutoLayoutEvent)

    return () => {
      window.removeEventListener('trigger-auto-layout', handleAutoLayoutEvent)
      if (cleanup) cleanup()
    }
  }, [debouncedAutoLayout])

  // Initialize workflow
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Ensure sync system is initialized before proceeding
      const initSync = async () => {
        // Initialize sync system if not already initialized
        await initializeSyncManagers()
        setIsInitialized(true)
      }

      // Check if already initialized
      if (isSyncInitialized()) {
        setIsInitialized(true)
      } else {
        initSync()
      }
    }
  }, [])

  // Handle drops
  const findClosestOutput = useCallback(
    (newNodePosition: { x: number; y: number }) => {
      const existingBlocks = Object.entries(blocks)
        .filter(([_, block]) => block.enabled)
        .map(([id, block]) => ({
          id,
          type: block.type,
          position: block.position,
          distance: Math.sqrt(
            (block.position.x - newNodePosition.x) ** 2 +
              (block.position.y - newNodePosition.y) ** 2
          ),
        }))
        .sort((a, b) => a.distance - b.distance)

      return existingBlocks[0] ? existingBlocks[0] : null
    },
    [blocks]
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

        // Add the container node directly to canvas with default dimensions
        addBlock(id, type, name, centerPosition, {
          width: 500,
          height: 300,
          type: type === 'loop' ? 'loopNode' : 'parallelNode',
        })

        // Auto-connect logic for container nodes
        const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
        if (isAutoConnectEnabled) {
          const closestBlock = findClosestOutput(centerPosition)
          if (closestBlock) {
            // Get appropriate source handle
            const sourceHandle = determineSourceHandle(closestBlock)

            addEdge({
              id: crypto.randomUUID(),
              source: closestBlock.id,
              target: id,
              sourceHandle,
              targetHandle: 'target',
              type: 'workflowEdge',
            })
          }
        }

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
      const name = `${blockConfig.name} ${
        Object.values(blocks).filter((b) => b.type === type).length + 1
      }`

      // Add the block to the workflow
      addBlock(id, type, name, centerPosition)

      // Auto-connect logic
      const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
      if (isAutoConnectEnabled && type !== 'starter') {
        const closestBlock = findClosestOutput(centerPosition)
        if (closestBlock) {
          // Get appropriate source handle
          const sourceHandle = determineSourceHandle(closestBlock)

          addEdge({
            id: crypto.randomUUID(),
            source: closestBlock.id,
            target: id,
            sourceHandle,
            targetHandle: 'target',
            type: 'workflowEdge',
          })
        }
      }
    }

    window.addEventListener('add-block-from-toolbar', handleAddBlockFromToolbar as EventListener)

    return () => {
      window.removeEventListener(
        'add-block-from-toolbar',
        handleAddBlockFromToolbar as EventListener
      )
    }
  }, [project, blocks, addBlock, addEdge, findClosestOutput, determineSourceHandle])

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

            // Add the container as a child of the parent container
            addBlock(id, data.type, name, relativePosition, {
              width: 500,
              height: 300,
              type: data.type === 'loop' ? 'loopNode' : 'parallelNode',
              parentId: containerInfo.loopId,
              extent: 'parent',
            })

            // Auto-connect the nested container to nodes inside the parent container
            const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
            if (isAutoConnectEnabled) {
              // Try to find other nodes in the parent container to connect to
              const containerNodes = getNodes().filter((n) => n.parentId === containerInfo.loopId)

              if (containerNodes.length > 0) {
                // Connect to the closest node in the container
                const closestNode = containerNodes
                  .map((n) => ({
                    id: n.id,
                    distance: Math.sqrt(
                      (n.position.x - relativePosition.x) ** 2 +
                        (n.position.y - relativePosition.y) ** 2
                    ),
                  }))
                  .sort((a, b) => a.distance - b.distance)[0]

                if (closestNode) {
                  // Get appropriate source handle
                  const sourceNode = getNodes().find((n) => n.id === closestNode.id)
                  const sourceType = sourceNode?.data?.type

                  // Default source handle
                  let sourceHandle = 'source'

                  // For condition blocks, use the condition-true handle
                  if (sourceType === 'condition') {
                    sourceHandle = 'condition-true'
                  }

                  addEdge({
                    id: crypto.randomUUID(),
                    source: closestNode.id,
                    target: id,
                    sourceHandle,
                    targetHandle: 'target',
                    type: 'workflowEdge',
                  })
                }
              }
            }

            // Resize the parent container to fit the new child container
            resizeLoopNodesWrapper()
          } else {
            // Add the container node directly to canvas with default dimensions
            addBlock(id, data.type, name, position, {
              width: 500,
              height: 300,
              type: data.type === 'loop' ? 'loopNode' : 'parallelNode',
            })

            // Auto-connect the container to the closest node on the canvas
            const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
            if (isAutoConnectEnabled) {
              const closestBlock = findClosestOutput(position)
              if (closestBlock) {
                const sourceHandle = determineSourceHandle(closestBlock)

                addEdge({
                  id: crypto.randomUUID(),
                  source: closestBlock.id,
                  target: id,
                  sourceHandle,
                  targetHandle: 'target',
                  type: 'workflowEdge',
                })
              }
            }
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
            // First priority: Connect to the container's start node
            const containerNode = getNodes().find((n) => n.id === containerInfo.loopId)
            const containerType = containerNode?.type

            if (containerType === 'loopNode' || containerType === 'parallelNode') {
              // Connect from the container's start node to the new block
              const startSourceHandle =
                containerType === 'loopNode' ? 'loop-start-source' : 'parallel-start-source'

              addEdge({
                id: crypto.randomUUID(),
                source: containerInfo.loopId,
                target: id,
                sourceHandle: startSourceHandle,
                targetHandle: 'target',
                type: 'workflowEdge',
              })
            } else {
              // Fallback: Try to find other nodes in the container to connect to
              const containerNodes = getNodes().filter((n) => n.parentId === containerInfo.loopId)

              if (containerNodes.length > 0) {
                // Connect to the closest node in the container
                const closestNode = containerNodes
                  .map((n) => ({
                    id: n.id,
                    distance: Math.sqrt(
                      (n.position.x - relativePosition.x) ** 2 +
                        (n.position.y - relativePosition.y) ** 2
                    ),
                  }))
                  .sort((a, b) => a.distance - b.distance)[0]

                if (closestNode) {
                  // Get appropriate source handle
                  const sourceNode = getNodes().find((n) => n.id === closestNode.id)
                  const sourceType = sourceNode?.data?.type

                  // Default source handle
                  let sourceHandle = 'source'

                  // For condition blocks, use the condition-true handle
                  if (sourceType === 'condition') {
                    sourceHandle = 'condition-true'
                  }

                  addEdge({
                    id: crypto.randomUUID(),
                    source: closestNode.id,
                    target: id,
                    sourceHandle,
                    targetHandle: 'target',
                    type: 'workflowEdge',
                  })
                }
              }
            }
          }
        } else {
          // Regular canvas drop
          addBlock(id, data.type, name, position)

          // Regular auto-connect logic
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
          if (isAutoConnectEnabled && data.type !== 'starter') {
            const closestBlock = findClosestOutput(position)
            if (closestBlock) {
              const sourceHandle = determineSourceHandle(closestBlock)

              addEdge({
                id: crypto.randomUUID(),
                source: closestBlock.id,
                target: id,
                sourceHandle,
                targetHandle: 'target',
                type: 'workflowEdge',
              })
            }
          }
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
            if (containerNode?.type === 'loopNode') {
              containerElement.classList.add('loop-node-drag-over')
            } else if (containerNode?.type === 'parallelNode') {
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

  // Init workflow
  useEffect(() => {
    if (!isInitialized) return

    const validateAndNavigate = async () => {
      const workflowIds = Object.keys(workflows)
      const currentId = params.id as string

      if (workflowIds.length === 0) {
        // Create initial workflow using the centralized function
        const newId = createWorkflow({ isInitial: true })
        router.replace(`/w/${newId}`)
        return
      }

      if (!workflows[currentId]) {
        router.replace(`/w/${workflowIds[0]}`)
        return
      }

      // Import the isActivelyLoadingFromDB function to check sync status
      const { isActivelyLoadingFromDB } = await import('@/stores/workflows/sync')

      // Wait for any active DB loading to complete before switching workflows
      if (isActivelyLoadingFromDB()) {
        const checkInterval = setInterval(() => {
          if (!isActivelyLoadingFromDB()) {
            clearInterval(checkInterval)
            // Reset variables loaded state before setting active workflow
            resetVariablesLoaded()
            setActiveWorkflow(currentId)
            markAllAsRead(currentId)
          }
        }, 100)
        return
      }

      // Reset variables loaded state before setting active workflow
      resetVariablesLoaded()
      setActiveWorkflow(currentId)
      markAllAsRead(currentId)
    }

    validateAndNavigate()
  }, [
    params.id,
    workflows,
    setActiveWorkflow,
    createWorkflow,
    router,
    isInitialized,
    markAllAsRead,
    resetVariablesLoaded,
  ])

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
      if (block.type === 'loop') {
        nodeArray.push({
          id: block.id,
          type: 'loopNode',
          position: block.position,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          dragHandle: '.workflow-drag-handle',
          data: {
            ...block.data,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
          },
        })
        return
      }

      // Handle parallel nodes
      if (block.type === 'parallel') {
        nodeArray.push({
          id: block.id,
          type: 'parallelNode',
          position: block.position,
          parentId: block.data?.parentId,
          extent: block.data?.extent || undefined,
          dragHandle: '.workflow-drag-handle',
          data: {
            ...block.data,
            width: block.data?.width || 500,
            height: block.data?.height || 300,
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
  }, [blocks, activeBlockIds, pendingBlocks, isDebugModeEnabled])

  // Update nodes
  const onNodesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const node = nodes.find((n) => n.id === change.id)
          if (!node) return
          updateBlockPosition(change.id, change.position)
        }
      })
    },
    [nodes, updateBlockPosition]
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
        updateBlockPosition(id, absolutePosition)
        updateParentId(id, '', 'parent')
      }
    })
  }, [blocks, updateBlockPosition, updateParentId, getNodeAbsolutePositionWrapper])

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
    (event: React.MouseEvent, node: any) => {
      // Store currently dragged node ID
      setDraggedNodeId(node.id)

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
          if ((n.type !== 'loopNode' && n.type !== 'parallelNode') || n.id === node.id) return false

          // Skip if this container is already the parent of the node being dragged
          if (n.id === currentParentId) return false

          // Skip self-nesting: prevent a container from becoming its own descendant
          if (node.type === 'loopNode' || node.type === 'parallelNode') {
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
            node.type === 'loopNode' || node.type === 'parallelNode'
              ? node.data?.width || 500
              : node.type === 'condition'
                ? 250
                : 350

          const nodeHeight =
            node.type === 'loopNode' || node.type === 'parallelNode'
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
          if (bestContainerMatch.container.type === 'loopNode') {
            containerElement.classList.add('loop-node-drag-over')
          } else if (bestContainerMatch.container.type === 'parallelNode') {
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
    ]
  )

  // Add in a nodeDrag start event to set the dragStartParentId
  const onNodeDragStart = useCallback(
    (event: React.MouseEvent, node: any) => {
      // Store the original parent ID when starting to drag
      const currentParentId = node.parentId || blocks[node.id]?.data?.parentId || null
      setDragStartParentId(currentParentId)
    },
    [blocks]
  )

  // Handle node drag stop to establish parent-child relationships
  const onNodeDragStop = useCallback(
    (event: React.MouseEvent, node: any) => {
      // Clear UI effects
      document.querySelectorAll('.loop-node-drag-over, .parallel-node-drag-over').forEach((el) => {
        el.classList.remove('loop-node-drag-over', 'parallel-node-drag-over')
      })
      document.body.style.cursor = ''

      // Don't process if the node hasn't actually changed parent or is being moved within same parent
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
      if ((node.type === 'loopNode' || node.type === 'parallelNode') && potentialParentId) {
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
        // Moving to a new parent container
        updateNodeParent(node.id, potentialParentId)
      }

      // Reset state
      setDraggedNodeId(null)
      setPotentialParentId(null)
    },
    [getNodes, dragStartParentId, potentialParentId, updateNodeParent, getNodeHierarchyWrapper]
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
  const edgesWithSelection = edges.map((edge) => {
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
        setSubBlockValue(blockId, subBlockId, value)
      }
    }

    window.addEventListener('update-subblock-value', handleSubBlockValueUpdate as EventListener)

    return () => {
      window.removeEventListener(
        'update-subblock-value',
        handleSubBlockValueUpdate as EventListener
      )
    }
  }, [setSubBlockValue])

  if (!isInitialized) {
    return (
      <div className='flex h-[calc(100vh-4rem)] w-full items-center justify-center'>
        <LoadingAgent size='lg' />
      </div>
    )
  }

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden'>
      <div className={`transition-all duration-200 ${isSidebarCollapsed ? 'ml-14' : 'ml-60'}`}>
        <ControlBar />
      </div>
      <Toolbar />
      <div
        className={`relative h-full w-full flex-1 transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
      >
        <Panel />
        <NotificationList />
        <ReactFlow
          nodes={nodes}
          edges={edgesWithSelection}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onDrop={onDrop}
          onDragOver={onDragOver}
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
          onNodeClick={(e, node) => {
            // Allow selecting nodes, but stop propagation to prevent triggering other events
            e.stopPropagation()
          }}
          onPaneClick={onPaneClick}
          onEdgeClick={onEdgeClick}
          elementsSelectable={true}
          selectNodesOnDrag={false}
          nodesConnectable={true}
          nodesDraggable={true}
          draggable={false}
          noWheelClassName='allow-scroll'
          edgesFocusable={true}
          edgesUpdatable={true}
          className='workflow-container h-full'
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeDragStart={onNodeDragStart}
          snapToGrid={false}
          snapGrid={[20, 20]}
          elevateEdgesOnSelect={true}
          elevateNodesOnSelect={true}
          autoPanOnConnect={true}
          autoPanOnNodeDrag={true}
        >
          <Background />
        </ReactFlow>
      </div>
    </div>
  )
}

// Workflow wrapper
export default function Workflow() {
  return (
    <ReactFlowProvider>
      <ErrorBoundary>
        <WorkflowContent />
      </ErrorBoundary>
    </ReactFlowProvider>
  )
}
