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

// Desktop Layout - Precise positions matching the image
const desktopNodes: Node[] = [
  { id: 'start', type: 'heroBlock', position: { x: 150, y: 200 }, data: { type: 'start' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'function1', type: 'heroBlock', position: { x: 330, y: 470 }, data: { type: 'function' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'agent1', type: 'heroBlock', position: { x: 820, y: 600 }, data: { type: 'agent' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'slack1', type: 'heroBlock', position: { x: 1180, y: 470 }, data: { type: 'slack' }, sourcePosition: Position.Left, targetPosition: Position.Right },
  { id: 'router1', type: 'heroBlock', position: { x: 1520, y: 200 }, data: { type: 'router' }, sourcePosition: Position.Left, targetPosition: Position.Right },
];

const desktopEdges: Edge[] = [
  { id: 'start-func1', source: 'start', target: 'function1', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'func1-agent1', source: 'function1', target: 'agent1', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'agent1-slack1', source: 'agent1', target: 'slack1', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'agent1-router1', source: 'slack1', target: 'router1', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
];

// Tablet Layout - Adjusted to match image proportions
const tabletNodes: Node[] = [
  { id: 'start', type: 'heroBlock', position: { x: -180, y: 480 }, data: { type: 'start' } },
  { id: 'function1', type: 'heroBlock', position: { x: 120, y: 660 }, data: { type: 'function' } },
  { id: 'agent1', type: 'heroBlock', position: { x: 400, y: 660 }, data: { type: 'agent' } },
  { id: 'router1', type: 'heroBlock', position: { x: 800, y: 320 }, data: { type: 'router' } },
  { id: 'slack1', type: 'heroBlock', position: { x: 680, y: 660 }, data: { type: 'slack' } },
].map(n => ({ ...n, sourcePosition: Position.Right, targetPosition: Position.Left }));
const tabletEdges: Edge[] = desktopEdges;

// Mobile Layout - Vertically stacked with adjusted spacing
const mobileNodes: Node[] = [
  { id: 'start', type: 'heroBlock', position: { x: 40, y: 180 }, data: { type: 'start' } },
  { id: 'function1', type: 'heroBlock', position: { x: 40, y: 380 }, data: { type: 'function' } },
  { id: 'agent1', type: 'heroBlock', position: { x: 40, y: 630 }, data: { type: 'agent' } },
  { id: 'slack1', type: 'heroBlock', position: { x: 40, y: 930 }, data: { type: 'slack' } },
  { id: 'router1', type: 'heroBlock', position: { x: 40, y: 1180 }, data: { type: 'router' } },
].map(n => ({ ...n, sourcePosition: Position.Bottom, targetPosition: Position.Top }));

const mobileEdges: Edge[] = [
  { id: 'start-func1-m', source: 'start', target: 'function1', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'func1-agent1-m', source: 'function1', target: 'agent1', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'agent1-slack1-m', source: 'agent1', target: 'slack1', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
  { id: 'slack1-router1-m', source: 'slack1', target: 'router1', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep', style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }, animated: true },
];

// Framer motion variants for load animation
const workflowVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, delay: 0.1, ease: "easeOut" },
  },
};

export function HeroWorkflow() {
  const { width } = useWindowSize();
  const isMobile = width !== undefined && width < 768;
  const isTablet = width !== undefined && width >= 768 && width < 1024;

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Set initial viewport based on device size
  const defaultViewport = useMemo(() => {
    if (isMobile) {
      return { x: 0, y: 0, zoom: 0.5 };
    } else if (isTablet) {
      return { x: 0, y: 0, zoom: 0.65 };
    } else {
      return { x: 0, y: 0, zoom: 1 };
    }
  }, [isMobile, isTablet]);

  useEffect(() => {
    if (isMobile) {
      setNodes(mobileNodes);
      setEdges(mobileEdges);
    } else if (isTablet) {
      setNodes(tabletNodes);
      setEdges(tabletEdges); 
    } else { // Desktop
      setNodes(desktopNodes);
      setEdges(desktopEdges);
    }
  }, [isMobile, isTablet, setNodes, setEdges]);

  return (
    <motion.div 
      className="absolute inset-0 pointer-events-none h-screen"
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
          from { stroke-dashoffset: 8; }
        }
        .react-flow__handle {
          opacity: 0;
        }
        .react-flow__node:hover .react-flow__handle {
          opacity: 1;
        }
        .react-flow__renderer {
          z-index: 5;
        }
      `}</style>
      <div className="w-full h-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionLineStyle={{ stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }}
          defaultViewport={defaultViewport}
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
        >
        </ReactFlow>
      </div>
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
