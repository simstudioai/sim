'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  ConnectionLineType,
  EdgeTypes,
  NodeTypes,
  ReactFlowProvider,
  useOnViewportChange,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useNotificationStore } from '@/stores/notifications/store'
import { initializeStateLogger } from '@/stores/workflow/logger'
import { useWorkflowRegistry } from '@/stores/workflow/registry/store'
import { useWorkflowStore } from '@/stores/workflow/store'
import { NotificationList } from '@/app/w/components/notifications/notifications'
import { getBlock } from '../../../blocks'
import { CustomEdge } from './components/custom-edge/custom-edge'
import { WorkflowBlock } from './components/workflow-block/workflow-block'
import { LoopInput } from './components/workflow-loop/components/loop-input/loop-input'
import { LoopLabel } from './components/workflow-loop/components/loop-label/loop-label'
import { createLoopNode, getRelativeLoopPosition } from './components/workflow-loop/workflow-loop'

// Define custom node and edge types
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  loopLabel: LoopLabel,
  loopInput: LoopInput,
}
const edgeTypes: EdgeTypes = { custom: CustomEdge }

function WorkflowContent() {
  // State
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Hooks
  const params = useParams()
  const router = useRouter()
  const { project, setViewport } = useReactFlow()

  // Store access
  const { addNotification } = useNotificationStore()
  const { workflows, setActiveWorkflow, addWorkflow } = useWorkflowRegistry()
  const { blocks, edges, loops, addBlock, updateBlockPosition, addEdge, removeEdge } =
    useWorkflowStore()

  // Initialize workflow
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedRegistry = localStorage.getItem('workflow-registry')
      if (savedRegistry) {
        useWorkflowRegistry.setState({ workflows: JSON.parse(savedRegistry) })
      }
      setIsInitialized(true)
    }
  }, [])

  // Init workflow
  useEffect(() => {
    if (!isInitialized) return

    const createInitialWorkflow = () => {
      const id = crypto.randomUUID()
      const newWorkflow = {
        id,
        name: 'Workflow 1',
        lastModified: new Date(),
        description: 'New workflow',
        color: '#3972F6',
      }
      addWorkflow(newWorkflow)
      return id
    }

    const validateAndNavigate = () => {
      const workflowIds = Object.keys(workflows)
      const currentId = params.id as string

      if (workflowIds.length === 0) {
        const newId = createInitialWorkflow()
        router.replace(`/w/${newId}`)
        return
      }

      if (!workflows[currentId]) {
        router.replace(`/w/${workflowIds[0]}`)
        return
      }

      setActiveWorkflow(currentId)
    }

    validateAndNavigate()
  }, [params.id, workflows, setActiveWorkflow, addWorkflow, router, isInitialized])

  // Transform blocks and loops into ReactFlow nodes
  const nodes = useMemo(() => {
    const nodeArray: any[] = []

    // Add loop group nodes and their labels
    Object.entries(loops).forEach(([loopId, loop]) => {
      const loopNodes = createLoopNode({ loopId, loop, blocks })
      if (loopNodes) {
        // Add both the loop node and its label node
        nodeArray.push(...loopNodes)
      }
    })

    // Add block nodes
    Object.entries(blocks).forEach(([blockId, block]) => {
      if (!block.type || !block.name) {
        console.log('Skipping invalid block:', blockId, block)
        return
      }

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        console.error(`No configuration found for block type: ${block.type}`)
        return
      }

      const parentLoop = Object.entries(loops).find(([_, loop]) => loop.nodes.includes(block.id))
      let position = block.position

      if (parentLoop) {
        const [loopId] = parentLoop
        const loopNode = nodeArray.find((node) => node.id === `loop-${loopId}`)
        if (loopNode) {
          position = getRelativeLoopPosition(block.position, loopNode.position)
        }
      }

      nodeArray.push({
        id: block.id,
        type: 'workflowBlock',
        position,
        parentId: parentLoop ? `loop-${parentLoop[0]}` : undefined,
        dragHandle: '.workflow-drag-handle',
        selected: block.id === selectedBlockId,
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
        },
      })
    })

    return nodeArray
  }, [blocks, loops, selectedBlockId])

  // Update nodes
  const onNodesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const node = nodes.find((n) => n.id === change.id)
          if (!node) return

          if (node.parentId) {
            const loopNode = nodes.find((n) => n.id === node.parentId)
            if (loopNode) {
              const absolutePosition = {
                x: change.position.x + loopNode.position.x,
                y: change.position.y + loopNode.position.y,
              }
              updateBlockPosition(change.id, absolutePosition)
            }
          } else {
            updateBlockPosition(change.id, change.position)
          }
        }
      })
    },
    [nodes, updateBlockPosition]
  )

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

  // Handle connections
  const onConnect = useCallback(
    (connection: any) => {
      if (connection.source && connection.target) {
        addEdge({
          ...connection,
          id: crypto.randomUUID(),
          type: 'custom',
        })
      }
    },
    [addEdge]
  )

  // Handle drops
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

        const blockConfig = getBlock(data.type)
        if (!blockConfig) {
          console.error('Invalid block type:', data.type)
          return
        }

        const id = crypto.randomUUID()
        const name = `${blockConfig.name} ${
          Object.values(blocks).filter((b) => b.type === data.type).length + 1
        }`

        addBlock(id, data.type, name, position)
      } catch (err) {
        console.error('Error dropping block:', err)
      }
    },
    [project, blocks, addBlock]
  )

  // Node selection
  const onNodeClick = useCallback((event: React.MouseEvent, node: any) => {
    event.stopPropagation()
    setSelectedBlockId(node.id)
    setSelectedEdgeId(null)
  }, [])

  // Clear selection
  const onPaneClick = useCallback(() => {
    setSelectedBlockId(null)
    setSelectedEdgeId(null)
  }, [])

  // Edge selection
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: any) => {
    setSelectedEdgeId(edge.id)
    setSelectedBlockId(null)
  }, [])

  // Transform edges to include selection state
  const edgesWithSelection = edges.map((edge) => ({
    ...edge,
    type: edge.type || 'custom',
    data: {
      selectedEdgeId,
      onDelete: (edgeId: string) => {
        removeEdge(edgeId)
        setSelectedEdgeId(null)
      },
    },
  }))

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
        removeEdge(selectedEdgeId)
        setSelectedEdgeId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEdgeId, removeEdge])

  // Initialize state logging
  useEffect(() => {
    initializeStateLogger()
  }, [])

  if (!isInitialized) return null

  return (
    <div className="relative w-full h-[calc(100vh-4rem)]">
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
        onDragOver={(e) => e.preventDefault()}
        fitView
        minZoom={0.4}
        maxZoom={1}
        panOnScroll
        defaultEdgeOptions={{ type: 'custom' }}
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{
          stroke: '#94a3b8',
          strokeWidth: 2,
          strokeDasharray: '5,5',
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        onNodeClick={onNodeClick}
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
      >
        <Background />
      </ReactFlow>
    </div>
  )
}

// Workflow wrapper
export default function Workflow() {
  return (
    <ReactFlowProvider>
      <WorkflowContent />
    </ReactFlowProvider>
  )
}
