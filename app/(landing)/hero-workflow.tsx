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
  {
    id: 'router-agent3',
    source: 'router',
    target: 'agent3',
    type: 'smoothstep',
    style: { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '5,5' },
    className: 'animated-edge',
  },
]

export function HeroWorkflow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div className="w-full h-[260px] md:h-[340px]">
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
        maxZoom={1.3}
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
        nodeExtent={[
          [-200, -300],
          [800, 300],
        ]}
        translateExtent={[
          [-200, -300],
          [800, 300],
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
