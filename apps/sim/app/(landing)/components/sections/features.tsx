'use client'

import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CodeXml, WorkflowIcon } from 'lucide-react'
import ReactFlow, {
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
import { AgentIcon, ConnectIcon, SlackIcon, StartIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { DotPattern } from '../dot-pattern'
import { HeroBlock } from '../hero-block'

// --- Types ---
type Feature = {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>> | typeof CodeXml
  color: string
  name: string
  feature: {
    icon: React.ReactNode
    title: string
    color: string
    bullets: string[]
  }
  nodes: Node[]
  edges: Edge[]
}
type FeaturesArray = Feature[]

// --- Data ---
const nodeTypes: NodeTypes = {
  heroBlock: HeroBlock,
}

// --- Features as Array ---
const features: FeaturesArray = [
  {
    icon: AgentIcon,
    color: 'bg-violet-500/5',
    name: 'Agent 1',
    feature: {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center rounded bg-[#7c3aed]">
          <AgentIcon className="text-white w-5 h-5" />
        </div>
      ),
      title: 'Agents',
      color: 'bg-violet-500/5',
      bullets: [
        'Build intelligent agents with a single configuration, using our unified API for any model.',
        'Equip agents with persistent memory to maintain context across interactions.',
        'Deploy agents in workflows with built-in tool calling for real-world actions.',
      ],
    },
    nodes: [
      {
        id: 'agent1',
        type: 'heroBlock',
        position: { x: 75, y: 100 },
        data: { type: 'agent' },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
      {
        id: 'slack1',
        type: 'heroBlock',
        position: { x: 500, y: -50 },
        data: { type: 'slack' },
        sourcePosition: Position.Left,
        targetPosition: Position.Right,
      },
    ],
    edges: [
      {
        id: 'agent1-slack1',
        source: 'agent1',
        target: 'slack1',
        type: 'smoothstep',
        style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' },
        animated: true,
      },
    ],
  },
  {
    icon: WorkflowIcon,
    color: 'bg-blue-500/5',
    name: 'Custom Workflows',
    feature: {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center rounded bg-[#2563eb]">
          <StartIcon className="text-white w-5 h-5" />
        </div>
      ),
      title: 'Custom Workflows',
      color: 'bg-blue-500/5',
      bullets: [
        'Design multi-step automations visually.',
        'Mix and match agents, functions, and integrations.',
        'Branch, loop, and orchestrate complex logic with ease.',
      ],
    },
    nodes: [
      {
        id: 'start',
        type: 'heroBlock',
        position: { x: 75, y: 150 },
        data: { type: 'start' },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
      {
        id: 'function1',
        type: 'heroBlock',
        position: { x: 500, y: -20 },
        data: { type: 'function' },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
    ],
    edges: [
      {
        id: 'start-func1',
        source: 'start',
        target: 'function1',
        type: 'smoothstep',
        style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' },
        animated: true,
      },
    ],
  },
  {
    icon: CodeXml,
    color: 'bg-red-500/5',
    name: 'Function 1',
    feature: {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center rounded bg-[#ef4444]">
          <CodeXml className="text-white w-5 h-5" />
        </div>
      ),
      title: 'Custom Functions',
      color: 'bg-red-500/5',
      bullets: [
        'Write and deploy custom logic in seconds.',
        'Integrate any API or service with minimal boilerplate.',
        'TypeScript-first, hot-reload, and versioned.',
      ],
    },
    nodes: [
      {
        id: 'function1',
        type: 'heroBlock',
        position: { x: 75, y: 125 },
        data: { type: 'function' },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
      {
        id: 'agent1',
        type: 'heroBlock',
        position: { x: 500, y: -50 },
        data: { type: 'agent' },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
    ],
    edges: [
      {
        id: 'func1-agent1',
        source: 'function1',
        target: 'agent1',
        type: 'smoothstep',
        style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' },
        animated: true,
      },
    ],
  },
  {
    icon: ConnectIcon,
    color: 'bg-green-500/5',
    name: 'Router 1',
    feature: {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center rounded bg-[#22c55e]">
          <ConnectIcon className="text-white w-5 h-5" />
        </div>
      ),
      title: 'Routers',
      color: 'bg-green-500/5',
      bullets: [
        'Route tasks dynamically based on context or input.',
        'Chain multiple agents and tools with conditional logic.',
        'Easily add fallback and error handling branches.',
      ],
    },
    nodes: [
      {
        id: 'router1',
        type: 'heroBlock',
        position: { x: 75, y: 100 },
        data: { type: 'router' },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
      {
        id: 'agent1',
        type: 'heroBlock',
        position: { x: 500, y: -20 },
        data: { type: 'agent' },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
    ],
    edges: [
      {
        id: 'router1-agent1',
        source: 'router1',
        target: 'agent1',
        type: 'smoothstep',
        style: { stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' },
        animated: true,
      },
    ],
  },
]

// Add this mapping at the top of the file
const bulletColors = [
  'bg-violet-500', // Agents
  'bg-blue-500', // Workflows
  'bg-red-500', // Functions
  'bg-green-500', // Routers
]

function FeaturesFlow({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(nodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(edges)
  useEffect(() => {
    setRfNodes(nodes)
    setRfEdges(edges)
  }, [nodes, edges, setRfNodes, setRfEdges])
  return (
    <motion.div className="w-full h-full relative">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#404040', strokeWidth: 1.5, strokeDasharray: '4 4' }}
        defaultViewport={{ x: 80, y: 0, zoom: 1.3 }}
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
        proOptions={{ hideAttribution: true }}
        className="pointer-events-none"
      />
    </motion.div>
  )
}

function Features() {
  const [open, setOpen] = useState(0)
  const selectedFeature = features[open]

  return (
    <motion.section
      className="flex flex-col py-20 w-full gap-20 px-8 md:px-0"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
    >
      <motion.div
        className="flex flex-col gap-7 w-full items-center"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
      >
        <motion.p
          className="text-white font-medium tracking-tight text-5xl text-center"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          Powerful tools for Agent success
        </motion.p>
        <motion.p
          className="text-white/60 text-xl tracking-normal max-w-xl text-center font-light"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          Unlock the full potential of your agents with intuitive features designed to simplify
          development and maximize impact.
        </motion.p>
      </motion.div>

      <div className="flex w-full">
        <div className="lg:flex relative w-full hidden">
          <div className="absolute -top-48 left-0">
            <svg
              width="1021"
              height="1126"
              viewBox="0 0 1021 1126"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g filter="url(#filter0_f_82_4275)">
                <ellipse cx="342.5" cy="556" rx="278.5" ry="280" fill="#593859" />
              </g>
              <defs>
                <filter
                  id="filter0_f_82_4275"
                  x="-336"
                  y="-124"
                  width="1357"
                  height="1360"
                  filterUnits="userSpaceOnUse"
                  colorInterpolationFilters="sRGB"
                >
                  <feFlood floodOpacity="0" result="BackgroundImageFix" />
                  <feBlend
                    mode="normal"
                    in="SourceGraphic"
                    in2="BackgroundImageFix"
                    result="shape"
                  />
                  <feGaussianBlur stdDeviation="200" result="effect1_foregroundBlur_82_4275" />
                </filter>
              </defs>
            </svg>
          </div>
          <motion.div
            className="lg:flex relative w-full hidden flex-col bg-[#0f0f0f] border border-[#606060]/30 rounded-r-3xl min-h-[44rem] z-10 overflow-hidden"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
          >
            <DotPattern className="rounded-r-3xl opacity-20" x={-5} y={-5} />
            <div className="flex-1 flex items-center justify-center w-full">
              <ReactFlowProvider>
                <FeaturesFlow nodes={selectedFeature.nodes} edges={selectedFeature.edges} />
              </ReactFlowProvider>
            </div>
          </motion.div>
        </div>
        <div className="w-full flex px-4 md:px-24 lg:px-32 xl:px-48">
          <motion.div
            className="w-full bg-[#0f0f0f] border border-[#606060]/30 rounded-3xl flex flex-col overflow-hidden"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
          >
            {features.map((f, i) => {
              const isOpen = open === i
              return (
                <motion.div
                  key={f.feature.title}
                  className={cn(
                    'h-full w-full border-b border-[#222222] flex flex-col justify-center',
                    isOpen ? f.color : ''
                  )}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.5, delay: 0.1 + i * 0.08, ease: 'easeInOut' }}
                >
                  <button
                    className="flex items-center w-full gap-4 px-8 py-6 focus:outline-none transition-colors"
                    onClick={() => setOpen(i)}
                    aria-expanded={isOpen}
                  >
                    {f.feature.icon}
                    <span className="text-xl font-semibold text-white/70">{f.feature.title}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.45, ease: 'easeInOut' }}
                        className="px-8 overflow-hidden"
                      >
                        <motion.div
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 16 }}
                          transition={{ duration: 0.35, ease: 'easeInOut' }}
                          className="pb-8"
                        >
                          {f.feature.bullets.length > 0 && (
                            <ul className="flex flex-col gap-5 mt-2">
                              {f.feature.bullets.map((b, j) => (
                                <li
                                  key={j}
                                  className="flex items-start text-white/80 text-lg max-w-sm"
                                >
                                  <span
                                    className={`w-2 h-2 ${bulletColors[i]} inline-block mt-2 mr-2`}
                                  />
                                  <span className="text-base leading-[1.4] text-white/70 font-light">
                                    {b}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      </div>
    </motion.section>
  )
}

export default Features
