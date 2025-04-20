'use client'

import React, { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import ReactFlow, {
  ConnectionLineType,
  Edge,
  EdgeTypes,
  MarkerType,
  Node,
  NodeTypes,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  Viewport,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { HeroBlock } from './hero-block'
import { HeroEdge } from './hero-edge'
import { useWindowSize } from './use-window-size'

const nodeTypes: NodeTypes = { heroBlock: HeroBlock }
const edgeTypes: EdgeTypes = { heroEdge: HeroEdge }

// Desktop layout
const desktopNodes: Node[] = [
  {
    id: 'function1',
    type: 'heroBlock',
    position: { x: 150, y: 400 },
    data: { type: 'function', isHeroSection: true },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
  {
    id: 'agent1',
    type: 'heroBlock',
    position: { x: 600, y: 600 },
    data: { type: 'agent' },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
  {
    id: 'router1',
    type: 'heroBlock',
    position: { x: 1050, y: 600 },
    data: { type: 'router' },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
  {
    id: 'slack1',
    type: 'heroBlock',
    position: { x: 1500, y: 400 },
    data: { type: 'slack' },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  },
]

const desktopEdges: Edge[] = [
  {
    id: 'func1-agent1',
    source: 'function1',
    target: 'agent1',
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'heroEdge',
    animated: true,
    style: { stroke: '#404040', strokeWidth: 2, strokeDasharray: '5,5' },
    zIndex: 5,
  },
  {
    id: 'agent1-router1',
    source: 'agent1',
    target: 'router1',
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'heroEdge',
    animated: true,
    style: { stroke: '#404040', strokeWidth: 2, strokeDasharray: '5,5' },
    zIndex: 5,
  },
  {
    id: 'router1-slack1',
    source: 'router1',
    target: 'slack1',
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'heroEdge',
    animated: true,
    style: { stroke: '#404040', strokeWidth: 2, strokeDasharray: '5,5' },
    zIndex: 5,
  },
]

const tabletNodes: Node[] = [
  {
    id: 'function1',
    type: 'heroBlock',
    position: { x: 50, y: 480 },
    data: { type: 'function', isHeroSection: true },
  },
  { id: 'agent1', type: 'heroBlock', position: { x: 300, y: 660 }, data: { type: 'agent' } },
  { id: 'router1', type: 'heroBlock', position: { x: 550, y: 660 }, data: { type: 'router' } },
  { id: 'slack1', type: 'heroBlock', position: { x: 800, y: 480 }, data: { type: 'slack' } },
].map((n) => ({ ...n, sourcePosition: Position.Right, targetPosition: Position.Left }))

const tabletEdges = desktopEdges.map((edge) => ({
  ...edge,
  sourceHandle: 'source',
  targetHandle: 'target',
  type: 'heroEdge',
}))

// Mobile: only the agent node, centered under text
const makeMobileNodes = (w: number, h: number): Node[] => {
  const BLOCK_HALF = 100
  return [
    {
      id: 'agent1',
      type: 'heroBlock',
      position: { x: w / 2 - BLOCK_HALF - 180, y: h / 2 },
      data: { type: 'agent' },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    },
    {
      id: 'slack1',
      type: 'heroBlock',
      position: { x: w / 2 - BLOCK_HALF + 180, y: h / 2 + 200 },
      data: { type: 'slack' },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    },
  ]
}

const mobileEdges: Edge[] = [
  {
    id: 'agent1-slack1',
    source: 'agent1',
    target: 'slack1',
    sourceHandle: 'source',
    targetHandle: 'target',
    type: 'heroEdge',
    animated: true,
    style: { stroke: '#404040', strokeWidth: 2, strokeDasharray: '5,5' },
    zIndex: 5,
  },
]

const workflowVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, delay: 0.1, ease: 'easeOut' } },
}

export function HeroWorkflow() {
  const { width = 0, height = 0 } = useWindowSize()
  const isMobile = width < 768
  const isTablet = width >= 768 && width < 1024

  const [nodes, setNodes, onNodesChange] = useNodesState<Node[]>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([])
  const { fitView } = useReactFlow()

  // Default viewport to make elements smaller
  const defaultViewport: Viewport = useMemo(() => ({ x: 0, y: 0, zoom: 0.8 }), [])

  // Load layout
  useEffect(() => {
    if (isMobile) {
      setNodes(makeMobileNodes(width, height))
      setEdges(mobileEdges)
    } else if (isTablet) {
      setNodes(tabletNodes)
      setEdges(tabletEdges)
    } else {
      setNodes(desktopNodes)
      setEdges(desktopEdges)
    }
  }, [width, height, isMobile, isTablet, setNodes, setEdges])

  // Center and scale
  useEffect(() => {
    if (nodes.length) {
      if (isMobile) {
        fitView({ padding: 0.2 }) // reduced padding to zoom in more
      } else {
        fitView({ padding: 0.2 }) // added padding to create more space around elements
      }
    }
  }, [nodes, edges, fitView, isMobile])

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none"
      style={{
        height: '100%',
        width: '100%',
        position: 'absolute',
        top: '160px',
        left: 0,
        willChange: 'opacity, transform',
      }}
      variants={workflowVariants}
      initial="hidden"
      animate="visible"
    >
      <style jsx global>{`
        .react-flow__edge-path {
          stroke-dasharray: 5, 5;
          stroke-width: 2;
          animation: dash 1s linear infinite;
        }
        @keyframes dash {
          to {
            stroke-dashoffset: 10;
          }
        }
        /* Make handles always visible in hero workflow with high z-index */
        .react-flow__handle {
          opacity: 1 !important;
          z-index: 1000 !important;
          cursor: default !important;
        }
        /* Force edges to stay below handles */
        .react-flow__edge {
          z-index: 5 !important;
        }
        /* Ensure nodes are above edges */
        .react-flow__node {
          z-index: 10 !important;
        }
        /* Proper z-index stacking for the entire flow */
        .react-flow__renderer {
          z-index: 1;
        }
      `}</style>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'heroEdge', animated: true }}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#404040', strokeWidth: 2, strokeDasharray: '5,5' }}
        minZoom={0.1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={false}
        selectionOnDrag={false}
        preventScrolling={true}
        defaultViewport={defaultViewport}
      />
    </motion.div>
  )
}

export default function HeroWorkflowProvider() {
  return (
    <ReactFlowProvider>
      <HeroWorkflow />
    </ReactFlowProvider>
  )
}
