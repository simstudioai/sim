'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  ConnectionLineType,
  Edge,
  MarkerType,
  Node,
  NodeTypes,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import { motion } from 'framer-motion'
import 'reactflow/dist/style.css'
import { HeroBlock } from './hero-block'
import { useWindowSize } from './use-window-size'

const nodeTypes: NodeTypes = {
  heroBlock: HeroBlock,
}

// --- Layouts based on visual position in the reference image --- 

// Desktop Layout (Wide spread)
const desktopNodes: Node[] = [
  { id: 'function', type: 'heroBlock', position: { x: -550, y: -100 }, data: { type: 'function', content: "functions.svg" }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'router', type: 'heroBlock', position: { x: 550, y: -100 }, data: { type: 'router', content: 'router.svg' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'agent', type: 'heroBlock', position: { x: -400, y: 250 }, data: { type: 'agent', content: 'agent.svg' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'workflow', type: 'heroBlock', position: { x: 400, y: 250 }, data: { type: 'workflow', name: 'Workflow 1', content: 'workflow.svg' }, sourcePosition: Position.Right, targetPosition: Position.Left },
];
const desktopEdges: Edge[] = [
  { id: 'function-router', source: 'function', target: 'router', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'agent-workflow', source: 'agent', target: 'workflow', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'function-agent', source: 'function', target: 'agent', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'router-workflow', source: 'router', target: 'workflow', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
];

// Tablet Layout (Slightly less spread)
const tabletNodes: Node[] = [
  { id: 'function', type: 'heroBlock', position: { x: -400, y: -80 }, data: { type: 'function', content: "functions.svg" }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'router', type: 'heroBlock', position: { x: 400, y: -80 }, data: { type: 'router', content: 'router.svg' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'agent', type: 'heroBlock', position: { x: -400, y: 220 }, data: { type: 'agent', content: 'agent.svg' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'workflow', type: 'heroBlock', position: { x: 400, y: 220 }, data: { type: 'workflow', name: 'Workflow 1', content: 'workflow.svg' }, sourcePosition: Position.Right, targetPosition: Position.Left },
];
const tabletEdges: Edge[] = desktopEdges; // Reuse edges

// Mobile Layout (Vertical Stack)
const mobileNodes: Node[] = [
  { id: 'function', type: 'heroBlock', position: { x: 0, y: -200 }, data: { type: 'function', content: "functions.svg" }, sourcePosition: Position.Bottom, targetPosition: Position.Top }, 
  { id: 'router', type: 'heroBlock', position: { x: 0, y: 100 }, data: { type: 'router', content: 'router.svg' }, sourcePosition: Position.Bottom, targetPosition: Position.Top },
  { id: 'agent', type: 'heroBlock', position: { x: 0, y: 400 }, data: { type: 'agent', content: 'agent.svg' }, sourcePosition: Position.Bottom, targetPosition: Position.Top }, 
  { id: 'workflow', type: 'heroBlock', position: { x: 0, y: 700 }, data: { type: 'workflow', name: 'Workflow 1', content: 'workflow.svg' }, sourcePosition: Position.Bottom, targetPosition: Position.Top },
];
const mobileEdges: Edge[] = [
  { id: 'function-router-mobile', source: 'function', target: 'router', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'router-agent-mobile', source: 'router', target: 'agent', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'agent-workflow-mobile', source: 'agent', target: 'workflow', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
];

const workflowVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.5,
      delay: 0.1, // Small delay after hero text animation
      ease: "easeOut",
    },
  },
};

export function HeroWorkflow() {
  const { width } = useWindowSize();
  const isMobile = width !== undefined && width < 768;
  const isTablet = width !== undefined && width >= 768 && width < 1024;

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  useEffect(() => {
    if (isMobile) {
      setNodes(mobileNodes);
      setEdges(mobileEdges);
    } else if (isTablet) {
      setNodes(tabletNodes);
      setEdges(tabletEdges); 
    } else {
      setNodes(desktopNodes);
      setEdges(desktopEdges);
    }
  }, [isMobile, isTablet, setNodes, setEdges]);

  const fitViewPadding = useMemo(() => {
    if (isMobile) {
      return 1.0;
    } else if (isTablet) {
      return 0.3;
    } else {
      return 0.1;
    }
  }, [isMobile, isTablet]);

  return (
    <motion.div 
      className="absolute inset-0 pointer-events-none"
      variants={workflowVariants}
      initial="hidden"
      animate="visible"
    >
       <style jsx global>{`
        .react-flow__edge-path {
          stroke-dasharray: 4;
          animation: dashdraw .5s linear infinite;
        }
        @keyframes dashdraw {
          from {
            stroke-dashoffset: 8;
          }
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }}
        fitView
        fitViewOptions={{ padding: fitViewPadding }}
        minZoom={0.1}
        maxZoom={1.2}
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
      >
      </ReactFlow>
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
