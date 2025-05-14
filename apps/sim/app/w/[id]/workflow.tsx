'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  ConnectionLineType,
  EdgeTypes,
  NodeTypes,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { createLogger } from '@/lib/logs/console-logger'
import { useExecutionStore } from '@/stores/execution/store'
import { useNotificationStore } from '@/stores/notifications/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSidebarStore } from '@/stores/sidebar/store'
import { initializeSyncManagers, isSyncInitialized } from '@/stores/sync-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { NotificationList } from '@/app/w/[id]/components/notifications/notifications'
import { getBlock } from '@/blocks'
import { ControlBar } from './components/control-bar/control-bar'
import { ErrorBoundary } from './components/error/index'
import { Panel } from './components/panel/panel'
import { Toolbar } from './components/toolbar/toolbar'
import { WorkflowBlock } from './components/workflow-block/workflow-block'
import { WorkflowEdge } from './components/workflow-edge/workflow-edge'
import { LoopNodeComponent } from '@/app/w/[id]/components/loop-node/loop-node'

const logger = createLogger('Workflow')

// Define custom node and edge types
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  loopNode: LoopNodeComponent,
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
    id: string;
    parentLoopId?: string;
    contextId?: string; // Unique identifier combining edge ID and context
  } | null>(null)
  // Hooks
  const params = useParams()
  const router = useRouter()
  const { project, getNodes } = useReactFlow()

  // Store access
  const { workflows, setActiveWorkflow, createWorkflow } = useWorkflowRegistry()
  //Removed loops from the store
  const { blocks, edges, addBlock, updateBlockPosition, addEdge, removeEdge, updateParentId } =
    useWorkflowStore()
  const { setValue: setSubBlockValue } = useSubBlockStore()
  const { markAllAsRead } = useNotificationStore()
  const { resetLoaded: resetVariablesLoaded } = useVariablesStore()

  // Execution and debug mode state
  const { activeBlockIds, pendingBlocks } = useExecutionStore()
  const { isDebugModeEnabled } = useGeneralStore()
  const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

  // Helper function to check if a point is inside a loop node
  const isPointInLoopNode = useCallback((position: { x: number, y: number }): { 
    loopId: string, 
    loopPosition: { x: number, y: number },
    dimensions: { width: number, height: number } 
  } | null => {
    // Find loops that contain this position point
    const containingLoops = getNodes()
      .filter(n => n.type === 'loopNode')
      .filter(n => {
        const loopRect = {
          left: n.position.x,
          right: n.position.x + (n.data?.width || 800),
          top: n.position.y,
          bottom: n.position.y + (n.data?.height || 1000)
        };

        return (
          position.x >= loopRect.left &&
          position.x <= loopRect.right &&
          position.y >= loopRect.top &&
          position.y <= loopRect.bottom
        );
      })
      .map(n => ({
        loopId: n.id,
        loopPosition: n.position,
        dimensions: {
          width: n.data?.width || 800,
          height: n.data?.height || 1000
        }
      }));

    // Sort by area (smallest first) in case of nested loops
    if (containingLoops.length > 0) {
      return containingLoops.sort((a, b) => {
        const aArea = a.dimensions.width * a.dimensions.height;
        const bArea = b.dimensions.width * b.dimensions.height;
        return aArea - bArea;
      })[0];
    }

    return null;
  }, [getNodes]);

  // Helper function to calculate proper dimensions for a loop node based on its children
  const calculateLoopDimensions = useCallback((loopId: string): { width: number, height: number } => {
    // Default minimum dimensions
    const minWidth = 800;
    const minHeight = 1000;

    // Get all child nodes of this loop
    const childNodes = getNodes().filter(node => node.parentId === loopId);

    if (childNodes.length === 0) {
      return { width: minWidth, height: minHeight };
    }

    // Calculate the bounding box that contains all children
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    childNodes.forEach(node => {
      // Get accurate node dimensions based on node type
      let nodeWidth;
      let nodeHeight;
      
      if (node.type === 'loopNode') {
        // For nested loops, use their actual dimensions plus extra padding
        nodeWidth = node.data?.width || 800;
        nodeHeight = node.data?.height || 1000;
      } else if (node.type === 'workflowBlock' && node.data?.type === 'condition') {
        nodeWidth = 250;
        nodeHeight = 350;
      } else {
        // Default dimensions for regular nodes
        nodeWidth = 200;
        nodeHeight = 200;
      }

      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    });

    // Add buffer padding to all sides (20px buffer before edges)
    // Add extra padding for nested loops to prevent tight boundaries
    const hasNestedLoops = childNodes.some(node => node.type === 'loopNode');
    const sidePadding = hasNestedLoops ? 300 : 220; // Extra padding for loops containing other loops
    const bottomPadding = hasNestedLoops ? 200 : 120; // More bottom padding for loops

    // Ensure the width and height are never less than the minimums
    // Apply padding to all sides (left/right and top/bottom)
    const width = Math.max(minWidth, maxX + sidePadding);
    const height = Math.max(minHeight, maxY + sidePadding + bottomPadding);

    return { width, height };
  }, [getNodes]);

  // Function to resize all loop nodes 
  const resizeLoopNodes = useCallback(() => {
    // Find all loop nodes
    const loopNodes = getNodes().filter(node => node.type === 'loopNode');

    // Resize each loop node based on its children
    loopNodes.forEach(loopNode => {
      const dimensions = calculateLoopDimensions(loopNode.id);

      // Only update if dimensions have changed (to avoid unnecessary updates)
      if (dimensions.width !== loopNode.data?.width || 
          dimensions.height !== loopNode.data?.height) {
        // Use the updateNodeDimensions from the workflow store
        useWorkflowStore.getState().updateNodeDimensions(loopNode.id, dimensions);
      }
    });
  }, [getNodes, calculateLoopDimensions]);

  // Use direct resizing function instead of debounced version for immediate updates
  const debouncedResizeLoopNodes = resizeLoopNodes;

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
            Math.pow(block.position.x - newNodePosition.x, 2) +
              Math.pow(block.position.y - newNodePosition.y, 2)
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

    return sourceHandle
  }, [])

  // Listen for toolbar block click events
  useEffect(() => {
    const handleAddBlockFromToolbar = (event: CustomEvent) => {
      const { type } = event.detail

      if (!type) return
      if (type === 'connectionBlock') return

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
            type: 'custom',
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

        // Check if dropping inside a loop node
        const loopInfo = isPointInLoopNode(position);

        // Clear any drag-over styling
        document.querySelectorAll('.loop-node-drag-over').forEach(el => {
          el.classList.remove('loop-node-drag-over');
        });
        document.body.style.cursor = '';

        // Special handling for loop nodes
        if (data.type === 'loop') {
          // Create a unique ID and name for the loop
          const id = crypto.randomUUID()
          const name = 'Loop'

          // Check if we're dropping inside another loop
          if (loopInfo) {
            // Calculate position relative to the parent loop
            const relativePosition = {
              x: position.x - loopInfo.loopPosition.x,
              y: position.y - loopInfo.loopPosition.y
            };

            // Add the loop as a child of the parent loop
            addBlock(id, data.type, name, relativePosition, {
              width: 800,
              height: 1000,
              type: 'loopNode',
              parentId: loopInfo.loopId,
              extent: 'parent'
            });
            
            logger.info('Added nested loop inside parent loop', {
              loopId: id,
              parentLoopId: loopInfo.loopId,
              relativePosition
            });
            
            // Resize the parent loop to fit the new child loop
            debouncedResizeLoopNodes();
          } else {
            // Add the loop node directly to canvas with default dimensions
            addBlock(id, data.type, name, position, {
              width: 800,
              height: 1000,
              type: 'loopNode'
            });
          }

          return
        }

        const blockConfig = getBlock(data.type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { data })
          return
        }
        
        // Generate id and name here so they're available in all code paths
        const id = crypto.randomUUID()
        const name = `${blockConfig.name} ${
          Object.values(blocks).filter((b) => b.type === data.type).length + 1
        }`

        if (loopInfo) {
          // Calculate position relative to the loop node
          const relativePosition = {
            x: position.x - loopInfo.loopPosition.x,
            y: position.y - loopInfo.loopPosition.y
          };

          // Add block with parent info
          addBlock(id, data.type, name, relativePosition, {
            parentId: loopInfo.loopId,
            extent: 'parent'
          });

          logger.info('Added block inside loop', {
            blockId: id,
            blockType: data.type,
            loopId: loopInfo.loopId,
            relativePosition
          });

          // Resize the loop node to fit the new block
          // Immediate resize without delay
          debouncedResizeLoopNodes();

          // Auto-connect logic for blocks inside loops
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled;
          if (isAutoConnectEnabled && data.type !== 'starter') {
            // Try to find other nodes in the loop to connect to
            const loopNodes = getNodes().filter(n => n.parentId === loopInfo.loopId);

            if (loopNodes.length > 0) {
              // Connect to the closest node in the loop
              const closestNode = loopNodes
                .map(n => ({
                  id: n.id,
                  distance: Math.sqrt(
                    Math.pow(n.position.x - relativePosition.x, 2) +
                    Math.pow(n.position.y - relativePosition.y, 2)
                  )
                }))
                .sort((a, b) => a.distance - b.distance)[0];

              if (closestNode) {
                // Get appropriate source handle
                const sourceNode = getNodes().find(n => n.id === closestNode.id);
                const sourceType = sourceNode?.data?.type;

                // Default source handle
                let sourceHandle = 'source';

                // For condition blocks, use the condition-true handle
                if (sourceType === 'condition') {
                  sourceHandle = 'condition-true';
                }

                addEdge({
                  id: crypto.randomUUID(),
                  source: closestNode.id,
                  target: id,
                  sourceHandle,
                  targetHandle: 'target',
                  type: 'workflowEdge',
                });
              }
            }
          }
        } else {
          // Regular canvas drop
          addBlock(id, data.type, name, position);

          // Regular auto-connect logic
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled;
          if (isAutoConnectEnabled && data.type !== 'starter') {
            const closestBlock = findClosestOutput(position);
            if (closestBlock) {
              const sourceHandle = determineSourceHandle(closestBlock);

              addEdge({
                id: crypto.randomUUID(),
                source: closestBlock.id,
                target: id,
                sourceHandle,
                targetHandle: 'target',
                type: 'workflowEdge',
              });
            }
          }
        }
      } catch (err) {
        logger.error('Error dropping block:', { err })
      }
    },
    [project, blocks, addBlock, addEdge, findClosestOutput, determineSourceHandle, isPointInLoopNode, getNodes]
  )

  // Handle drag over for ReactFlow canvas
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    // Only handle toolbar items
    if (!event.dataTransfer?.types.includes('application/json')) return;

    try {
      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      // Check if hovering over a loop node
      const loopInfo = isPointInLoopNode(position);

      // Clear any previous highlighting
      document.querySelectorAll('.loop-node-drag-over').forEach(el => {
        el.classList.remove('loop-node-drag-over');
      });

      // If hovering over a loop node, highlight it
      if (loopInfo) {
        const loopElement = document.querySelector(`[data-id="${loopInfo.loopId}"]`);
        if (loopElement) {
          loopElement.classList.add('loop-node-drag-over');
          document.body.style.cursor = 'copy';
        }
      } else {
        document.body.style.cursor = '';
      }
    } catch (err) {
      logger.error('Error in onDragOver', { err });
    }
  }, [project, isPointInLoopNode]);

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

      // Handle loop nodes differently
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
            width: block.data?.width || 800,
            height: block.data?.height || 1000,
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

      let position = block.position

      const isActive = activeBlockIds.has(block.id)
      const isPending = isDebugModeEnabled && pendingBlocks.includes(block.id)

      nodeArray.push({
        id: block.id,
        type: 'workflowBlock',
        position,
        parentId: block.data?.parentId,
        extent: block.data?.extent || undefined,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
          isActive,
          isPending,
        },
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
    if (nodes.length === 0) return;

    // Resize all loops to fit their children
    debouncedResizeLoopNodes();

    // No need for cleanup with direct function
    return () => {};
  }, [nodes, debouncedResizeLoopNodes]);


  // Update edges
  const onEdgesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'remove') {
          logger.info('Edge removal requested via ReactFlow:', { edgeId: change.id });
          removeEdge(change.id);
        }
      });
    },
    [removeEdge]
  )

  // Handle connections with improved parent tracking
  const onConnect = useCallback(
    (connection: any) => {
      if (connection.source && connection.target) {
        // Check if connecting nodes across loop boundaries
        const sourceNode = getNodes().find(n => n.id === connection.source);
        const targetNode = getNodes().find(n => n.id === connection.target);
        
        if (!sourceNode || !targetNode) return;
        
        // Get parent information (handle loop start node case)
        const sourceParentId = sourceNode.parentId || 
                              (connection.sourceHandle === 'loop-start-source' ? 
                                connection.source : undefined);
        const targetParentId = targetNode.parentId;
        
        // Generate a unique edge ID
        const edgeId = crypto.randomUUID();
        
        // Special case for loop-start-source: Always allow connections to nodes within the same loop
        if (connection.sourceHandle === 'loop-start-source' && targetNode.parentId === sourceNode.id) {
          // This is a connection from loop start to a node inside the loop - always allow
          logger.info('Creating loop start connection:', {
            edgeId,
            sourceId: connection.source,
            targetId: connection.target,
            parentLoopId: sourceNode.id
          });
          
          addEdge({
            ...connection,
            id: edgeId,
            type: 'workflowEdge',
            // Add metadata about the loop context
            data: {
              parentLoopId: sourceNode.id,
              isInsideLoop: true
            }
          });
          return;
        }
        
        // Prevent connections across loop boundaries
        if ((sourceParentId && !targetParentId) || (!sourceParentId && targetParentId) || 
            (sourceParentId && targetParentId && sourceParentId !== targetParentId)) {
          logger.info('Rejected cross-boundary connection:', {
            sourceId: connection.source,
            targetId: connection.target,
            sourceParentId,
            targetParentId
          });
          return;
        }
        
        // Track if this connection is inside a loop
        const isInsideLoop = Boolean(sourceParentId) || Boolean(targetParentId);
        const parentLoopId = sourceParentId || targetParentId;
        
        logger.info('Creating connection:', {
          edgeId,
          sourceId: connection.source,
          targetId: connection.target,
          isInsideLoop,
          parentLoopId
        });
        
        // Add appropriate metadata for loop context
        addEdge({
          ...connection,
          id: edgeId,
          type: 'workflowEdge',
          data: isInsideLoop ? {
            parentLoopId,
            isInsideLoop
          } : undefined
        });
      }
    },
    [addEdge, getNodes]
  );

  // Handle node drag to detect intersections with loop nodes
  const onNodeDrag = useCallback(
    (event: React.MouseEvent, node: any) => {
      // Store currently dragged node ID
      setDraggedNodeId(node.id)

      // Skip if dragging a loop node that already has a parent to avoid nested loop issues
      if (node.type === 'loopNode' && node.parentId) return;

      // Get the current parent ID of the node being dragged
      const currentParentId = blocks[node.id]?.data?.parentId || null;

      // Find intersections with loop nodes
      const intersectingNodes = getNodes().filter(n => {
        // Only consider loop nodes that aren't the dragged node
        if (n.type !== 'loopNode' || n.id === node.id) return false

        // Skip if this loop is already the parent of the node being dragged
        if (n.id === currentParentId) return false

        // Skip self-nesting: prevent a loop from becoming its own descendant
        if (node.type === 'loopNode') {
          // Check if the target loop is already a descendant of the dragged loop
          // This prevents circular parent-child relationships
          let currentNode = n;
          while (currentNode && currentNode.parentId) {
            if (currentNode.parentId === node.id) {
              return false; // Avoid circular nesting
            }
            const parentNode = getNodes().find(pn => pn.id === currentNode.parentId);
            if (!parentNode) break;
            currentNode = parentNode;
          }
        }

        // Get dimensions based on node type
        const nodeWidth = node.type === 'loopNode' 
          ? (node.data?.width || 800) 
          : (node.type === 'condition' ? 250 : 200);
          
        const nodeHeight = node.type === 'loopNode' 
          ? (node.data?.height || 1000) 
          : (node.type === 'condition' ? 150 : 100);

        // Check if node is within the bounds of the loop node
        const nodeRect = { 
          left: node.position.x, 
          right: node.position.x + nodeWidth,
          top: node.position.y, 
          bottom: node.position.y + nodeHeight
        }

        const loopRect = {
          left: n.position.x,
          right: n.position.x + (n.data?.width || 800),
          top: n.position.y,
          bottom: n.position.y + (n.data?.height || 1000)
        }

        return (
          nodeRect.left < loopRect.right &&
          nodeRect.right > loopRect.left &&
          nodeRect.top < loopRect.bottom &&
          nodeRect.bottom > loopRect.top
        )
      })

      // Update potential parent if there's at least one intersecting loop node
      if (intersectingNodes.length > 0) {
        // Find smallest loop (for handling nested loops)
        const smallestLoop = intersectingNodes.sort((a, b) => {
          const aSize = (a.data?.width || 800) * (a.data?.height || 1000)
          const bSize = (b.data?.width || 800) * (b.data?.height || 1000)
          return aSize - bSize
        })[0]

        // Set potential parent and add visual indicator
        setPotentialParentId(smallestLoop.id)

        // Add highlight class and change cursor
        const loopElement = document.querySelector(`[data-id="${smallestLoop.id}"]`)
        if (loopElement) {
          loopElement.classList.add('loop-node-drag-over')

          // Change cursor to indicate item can be dropped
          document.body.style.cursor = 'copy'
        }
      } else {
        // Remove highlighting if no longer over a loop
        if (potentialParentId) {
          const prevElement = document.querySelector(`[data-id="${potentialParentId}"]`)
          if (prevElement) {
            prevElement.classList.remove('loop-node-drag-over')
          }
          setPotentialParentId(null)

          // Reset cursor
          document.body.style.cursor = ''
        }
      }
    },
    [getNodes, potentialParentId, blocks]
  )

  // Add in a nodeDrag start event to set the dragStartParentId
  const onNodeDragStart = useCallback((event: React.MouseEvent, node: any) => {
    setDragStartParentId(node.parentId || blocks[node.id]?.data?.parentId || null)
  }, [blocks])

  // Handle node drag stop to establish parent-child relationships
  const onNodeDragStop = useCallback(
    (event: React.MouseEvent, node: any) => {

      //if the currnt parent ID is the same as the dragStartParentId, then we don't need to do anything

      console.log('potentialParentId', potentialParentId)
      console.log('dragStartParentId', dragStartParentId)

      // This is the case where the node is being moved inside of it's original parent loop
      if (potentialParentId === dragStartParentId || (dragStartParentId && !potentialParentId)) return;

      //Else, we want to perform the logic below 

      logger.info('Node drag stopped', { 
        nodeId: node.id, 
        dragStartParentId,
        potentialParentId,
        nodeType: node.type 
      });

      // Clear UI effects
      document.querySelectorAll('.loop-node-drag-over').forEach(el => {
        el.classList.remove('loop-node-drag-over');
      });
      document.body.style.cursor = '';

      // Find potential new parent loop based on intersections
      const intersectingNodes = getNodes().filter(n => {
        // Only consider loop nodes that aren't the dragged node
        if (n.type !== 'loopNode' || n.id === node.id) return false;
        
        // Skip self-nesting and circular parent checks (keep existing logic)
        if (node.type === 'loopNode') {
          let currentNode = n;
          while (currentNode && currentNode.parentId) {
            if (currentNode.parentId === node.id) return false;
            const parentNode = getNodes().find(pn => pn.id === currentNode.parentId);
            if (!parentNode) break;
            currentNode = parentNode;
          }
        }

        // Calculate node dimensions and check intersection (keep existing logic)
        const nodeWidth = node.type === 'loopNode' 
          ? (node.data?.width || 800) 
          : (node.type === 'condition' ? 250 : 200);
          
        const nodeHeight = node.type === 'loopNode' 
          ? (node.data?.height || 1000) 
          : (node.type === 'condition' ? 150 : 100);

        // Check intersection with loop nodes
        const nodeRect = { 
          left: node.position.x, 
          right: node.position.x + nodeWidth,
          top: node.position.y, 
          bottom: node.position.y + nodeHeight
        };

        const loopRect = {
          left: n.position.x,
          right: n.position.x + (n.data?.width || 800),
          top: n.position.y,
          bottom: n.position.y + (n.data?.height || 1000)
        };

        return (
          nodeRect.left < loopRect.right &&
          nodeRect.right > loopRect.left &&
          nodeRect.top < loopRect.bottom &&
          nodeRect.bottom > loopRect.top
        );
      });

      // Get the new potential parent loop (smallest intersecting loop)
      const newParentId = intersectingNodes.length > 0 
        ? intersectingNodes.sort((a, b) => {
            const aSize = (a.data?.width || 800) * (a.data?.height || 1000);
            const bSize = (b.data?.width || 800) * (b.data?.height || 1000);
            return aSize - bSize;
          })[0].id
        : null;

      // KEY LOGIC: Only update parent relationship if it's different from starting parent
      if (newParentId !== dragStartParentId) {
        if (newParentId) {
          // Node is being moved to a new parent loop
          const newParentNode = getNodes().find(n => n.id === newParentId);
          if (newParentNode) {
            // Calculate position relative to new parent
            const relativePosition = {
              x: node.position.x - newParentNode.position.x,
              y: node.position.y - newParentNode.position.y
            };
            
            logger.info('Moving node to new parent loop', {
              nodeId: node.id,
              oldParentId: dragStartParentId,
              newParentId,
              relativePosition
            });
            
            // Update both position and parent ID
            updateBlockPosition(node.id, relativePosition);
            updateParentId(node.id, newParentId, 'parent');
            
            // Resize loop to fit new content
            debouncedResizeLoopNodes();
          }
        } else if (dragStartParentId) {
          // Node is being moved out of a loop entirely
          logger.info('Removing node from parent loop', {
            nodeId: node.id,
            oldParentId: dragStartParentId
          });
          
          // Keep current absolute position but remove parent relationship
          updateParentId(node.id, '', 'parent');
          
          // After removing from parent, resize the old parent loop
          debouncedResizeLoopNodes();
        }
      } else if (newParentId && dragStartParentId === newParentId) {
        // Node remains in the same parent, just update its position
        const parentNode = getNodes().find(n => n.id === newParentId);
        if (parentNode) {
          // Calculate position relative to same parent
          const relativePosition = {
            x: node.position.x - parentNode.position.x,
            y: node.position.y - parentNode.position.y
          };
          
          logger.info('Repositioning node within same parent loop', {
            nodeId: node.id,
            parentId: newParentId,
            relativePosition
          });
          
          // Only update position, not parent relationship
          updateBlockPosition(node.id, relativePosition);
        }
      }

      // Reset state
      setDraggedNodeId(null);
      setPotentialParentId(null);
    },
    [getNodes, dragStartParentId, potentialParentId, updateBlockPosition, updateParentId, debouncedResizeLoopNodes]
  )


  // Update onPaneClick to only handle edge selection
  const onPaneClick = useCallback(() => {
    setSelectedEdgeInfo(null)
  }, [])

  // Edge selection
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: any) => {
    event.stopPropagation(); // Prevent bubbling
    
    // Determine if edge is inside a loop by checking its source/target nodes
    const sourceNode = getNodes().find(n => n.id === edge.source);
    const targetNode = getNodes().find(n => n.id === edge.target);
    
    // An edge is inside a loop if either source or target has a parent
    // If source and target have different parents, prioritize source's parent
    const parentLoopId = sourceNode?.parentId || targetNode?.parentId;
    
    // Create a unique identifier that combines edge ID and parent context
    const contextId = `${edge.id}${parentLoopId ? `-${parentLoopId}` : ''}`;
    
    logger.info('Edge selected:', { 
      edgeId: edge.id, 
      sourceId: edge.source,
      targetId: edge.target,
      sourceNodeParent: sourceNode?.parentId,
      targetNodeParent: targetNode?.parentId,
      parentLoopId,
      contextId
    });
    
    setSelectedEdgeInfo({
      id: edge.id,
      parentLoopId,
      contextId
    });
  }, [getNodes]);

  // Transform edges to include improved selection state
  const edgesWithSelection = edges.map((edge) => {
    // Check if this edge connects nodes inside a loop
    const sourceNode = getNodes().find(n => n.id === edge.source);
    const targetNode = getNodes().find(n => n.id === edge.target);
    const parentLoopId = sourceNode?.parentId || targetNode?.parentId;
    const isInsideLoop = Boolean(parentLoopId);
    
    // Create a unique context ID for this edge
    const edgeContextId = `${edge.id}${parentLoopId ? `-${parentLoopId}` : ''}`;
    
    // Determine if this edge is selected using context-aware matching
    const isSelected = selectedEdgeInfo?.contextId === edgeContextId;
    
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
          logger.info('Deleting edge:', { 
            edgeId, 
            fromSelection: selectedEdgeInfo?.id === edgeId,
            contextId: edgeContextId 
          });
          
          // Only delete this specific edge
          removeEdge(edgeId);
          
          // Only clear selection if this was the selected edge
          if (selectedEdgeInfo?.id === edgeId) {
            setSelectedEdgeInfo(null);
          }
        },
      },
    }
  });

  // Handle keyboard shortcuts with better edge tracking
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeInfo) {
        logger.info('Keyboard shortcut edge deletion:', { 
          edgeId: selectedEdgeInfo.id,
          parentLoopId: selectedEdgeInfo.parentLoopId,
          contextId: selectedEdgeInfo.contextId
        });
        
        // Only delete the specific selected edge
        removeEdge(selectedEdgeInfo.id);
        setSelectedEdgeInfo(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEdgeInfo, removeEdge]);

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
      <div className="flex h-[calc(100vh-4rem)] w-full items-center justify-center">
        <LoadingAgent size="lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <div className={`transition-all duration-200 ${isSidebarCollapsed ? 'ml-14' : 'ml-60'}`}>
        <ControlBar />
      </div>
      <Toolbar />
      <div
        className={`flex-1 relative w-full h-full transition-all duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
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
          onNodeClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
          onPaneClick={onPaneClick}
          onEdgeClick={onEdgeClick}
          elementsSelectable={true}
          selectNodesOnDrag={false}
          nodesConnectable={true}
          nodesDraggable={true}
          draggable={false}
          noWheelClassName="allow-scroll"
          edgesFocusable={true}
          edgesUpdatable={true}
          className="workflow-container h-full"
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
