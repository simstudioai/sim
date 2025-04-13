'use client'

import { useEffect } from 'react'
import ReactFlow, {
  ConnectionLineType,
  Edge,
  Node,
  NodeTypes,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { HeroBlock } from './hero-block'
import { useWindowSize } from './use-window-size'

const nodeTypes: NodeTypes = {
  heroBlock: HeroBlock,
}

// Initial nodes configuration
const initialNodes: Node[] = [
  {
    id: 'api',
    type: 'heroBlock',
    position: { x: -150, y: -100 },
    data: {
      type: 'api',
      name: 'API Block',
      color: '#2F55FF',
    },
    dragHandle: '.workflow-drag-handle',
  },
  {
    id: 'router',
    type: 'heroBlock',
    position: { x: 125, y: -50 },
    data: {
      type: 'router',
      name: 'Router',
      color: '#28C43F',
    },
    dragHandle: '.workflow-drag-handle',
  },
  {
    id: 'agent1',
    type: 'heroBlock',
    position: { x: 400, y: -100 },
    data: {
      type: 'agent',
      name: 'Agent 1',
      color: '#802FFF',
    },
    dragHandle: '.workflow-drag-handle',
  },
  {
    id: 'agent2',
    type: 'heroBlock',
    position: { x: 400, y: 0 },
    data: {
      type: 'agent',
      name: 'Agent 2',
      color: '#802FFF',
    },
    dragHandle: '.workflow-drag-handle',
  },
]

// Consolidated edges configuration
const baseEdges: Edge[] = [
  {
    id: 'api-router',
    source: 'api',
    target: 'router',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
    className: 'animated-edge',
  },
  {
    id: 'router-agent1',
    source: 'router',
    target: 'agent1',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
    className: 'animated-edge',
  },
  {
    id: 'router-agent2',
    source: 'router',
    target: 'agent2',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
    className: 'animated-edge',
  },
]

const initialEdges: Edge[] = [
  ...baseEdges,
  {
    id: 'router-agent3',
    source: 'router',
    target: 'agent3',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
    className: 'animated-edge',
  },
]

// Create mobile node positions
const getMobileNodes = (): Node[] => [
  {
    id: 'api',
    type: 'heroBlock',
    position: { x: -25, y: -150 },
    data: {
      type: 'api',
      name: 'API Block',
      color: '#2F55FF',
    },
    dragHandle: '.workflow-drag-handle',
  },
  {
    id: 'router',
    type: 'heroBlock',
    position: { x: 0, y: -30 },
    data: {
      type: 'router',
      name: 'Router',
      color: '#28C43F',
    },
    dragHandle: '.workflow-drag-handle',
  },
  {
    id: 'agent1',
    type: 'heroBlock',
    position: { x: 275, y: -100 },
    data: {
      type: 'agent',
      name: 'Agent 1',
      color: '#802FFF',
    },
    dragHandle: '.workflow-drag-handle',
  },
  {
    id: 'agent2',
    type: 'heroBlock',
    position: { x: 275, y: 0 },
    data: {
      type: 'agent',
      name: 'Agent 2',
      color: '#802FFF',
    },
    dragHandle: '.workflow-drag-handle',
  },
]

export function HeroWorkflow() {
  const { width } = useWindowSize()
  const isMobile = width ? width <= 768 : false

  const [nodes, setNodes, onNodesChange] = useNodesState(isMobile ? getMobileNodes() : initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(isMobile ? baseEdges : initialEdges)

  // Handle viewport changes with instant update
  useEffect(() => {
    const targetNodes = isMobile ? getMobileNodes() : initialNodes
    const targetEdges = isMobile ? baseEdges : initialEdges

    setNodes((nds) =>
      nds.map((node) => {
        const targetNode = targetNodes.find((n) => n.id === node.id)
        if (targetNode) {
          return {
            ...node,
            position: {
              x: targetNode.position.x,
              y: targetNode.position.y,
            },
          }
        }
        return node
      })
    )
    setEdges(targetEdges)
  }, [isMobile, setNodes, setEdges])

  return (
    <div className="w-full h-[240px] md:h-[320px]">
      <style jsx global>{`
        .animated-edge {
          animation: dashdraw 7s linear infinite;
        }
        @keyframes dashdraw {
          from {
            stroke-dashoffset: 100;
          }
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '8,8' },
          className: 'animated-edge',
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#94a3b8', strokeWidth: 2 }}
        fitView
        minZoom={0.6}
        maxZoom={1.35}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={false}
        selectionOnDrag={false}
        preventScrolling={true}
        autoPanOnNodeDrag={false}
        nodeExtent={
          isMobile
            ? [
                [-50, -175],
                [500, 75],
              ]
            : [
                [-190, -130],
                [644, 60],
              ]
        }
      />
    </div>
  )
}

export default function HeroWorkflowProvider() {
  return (
    <ReactFlowProvider>
      <HeroWorkflow />
    </ReactFlowProvider>
  )
}
