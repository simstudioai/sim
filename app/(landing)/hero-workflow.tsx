'use client'

import { useCallback, useState } from 'react'
import ReactFlow, {
  Background,
  ConnectionLineType,
  Edge,
  Node,
  NodeTypes,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { HeroBlock } from './hero-block'

const nodeTypes: NodeTypes = {
  heroBlock: HeroBlock,
}

// Initial nodes configuration
const initialNodes: Node[] = [
  {
    id: 'api',
    type: 'heroBlock',
    position: { x: 50, y: -150 },
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
    position: { x: 100, y: -25 },
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
    position: { x: 400, y: -75 },
    data: {
      type: 'agent',
      name: 'Agent 1',
      color: '#7F2FFF',
    },
    dragHandle: '.workflow-drag-handle',
  },
  {
    id: 'agent2',
    type: 'heroBlock',
    position: { x: 400, y: 25 },
    data: {
      type: 'agent',
      name: 'Agent 2',
      color: '#7F2FFF',
    },
    dragHandle: '.workflow-drag-handle',
  },
]

// Initial edges configuration
const initialEdges: Edge[] = [
  {
    id: 'api-router',
    source: 'api',
    target: 'router',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
  },
  {
    id: 'router-agent1',
    source: 'router',
    target: 'agent1',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
  },
  {
    id: 'router-agent2',
    source: 'router',
    target: 'agent2',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
  },
  {
    id: 'router-agent3',
    source: 'router',
    target: 'agent3',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
  },
]

export function HeroWorkflow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="w-full h-[300px] md:h-[420px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#94a3b8', strokeWidth: 2 }}
        fitView
        minZoom={0.8}
        maxZoom={1.3}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        selectionOnDrag={true}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        nodeExtent={[
          [-100, -200],
          [600, 200],
        ]}
        translateExtent={[
          [-100, -200],
          [600, 200],
        ]}
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
