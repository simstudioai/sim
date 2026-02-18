import type { Edge, Node } from 'reactflow'
import { Position } from 'reactflow'

/**
 * Tool entry displayed as a chip on agent blocks
 */
export interface PreviewTool {
  name: string
  type: string
  bgColor: string
}

/**
 * Static block definition for preview workflow nodes
 */
export interface PreviewBlock {
  id: string
  name: string
  type: string
  bgColor: string
  rows: Array<{ title: string; value: string }>
  tools?: PreviewTool[]
  markdown?: string
  position: { x: number; y: number }
  hideTargetHandle?: boolean
  hideSourceHandle?: boolean
}

/**
 * Workflow definition containing nodes, edges, and metadata
 */
export interface PreviewWorkflow {
  id: string
  name: string
  color: string
  blocks: PreviewBlock[]
  edges: Array<{ id: string; source: string; target: string }>
}

/**
 * IT Service Management workflow — Slack Trigger -> Agent (KB + Jira tools)
 */
const IT_SERVICE_WORKFLOW: PreviewWorkflow = {
  id: 'wf-it-service',
  name: 'IT Service Management',
  color: '#33C482',
  blocks: [
    {
      id: 'slack-1',
      name: 'Slack',
      type: 'slack',
      bgColor: '#611f69',
      rows: [
        { title: 'Channel', value: '#it-support' },
        { title: 'Event', value: 'New Message' },
      ],
      position: { x: 80, y: 140 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-1',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'claude-sonnet-4.6' },
        { title: 'System Prompt', value: 'Triage incoming IT...' },
      ],
      tools: [
        { name: 'Knowledge Base', type: 'knowledge_base', bgColor: '#10B981' },
        { name: 'Jira', type: 'jira', bgColor: '#E0E0E0' },
      ],
      position: { x: 420, y: 80 },
      hideSourceHandle: true,
    },
  ],
  edges: [{ id: 'e-1', source: 'slack-1', target: 'agent-1' }],
}

/**
 * Content pipeline workflow — Schedule -> Agent (X + YouTube tools)
 *                                     \-> Telegram
 */
const CONTENT_PIPELINE_WORKFLOW: PreviewWorkflow = {
  id: 'wf-content-pipeline',
  name: 'Content Pipeline',
  color: '#FF6B2C',
  blocks: [
    {
      id: 'schedule-1',
      name: 'Schedule',
      type: 'schedule',
      bgColor: '#6366F1',
      rows: [
        { title: 'Run Frequency', value: 'Daily' },
        { title: 'Time', value: '09:00 AM' },
      ],
      position: { x: 80, y: 140 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-2',
      name: 'Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'grok-4' },
        { title: 'System Prompt', value: 'Repurpose trending...' },
      ],
      tools: [
        { name: 'X', type: 'x', bgColor: '#000000' },
        { name: 'YouTube', type: 'youtube', bgColor: '#FF0000' },
      ],
      position: { x: 420, y: 40 },
      hideSourceHandle: true,
    },
    {
      id: 'telegram-1',
      name: 'Telegram',
      type: 'telegram',
      bgColor: '#E0E0E0',
      rows: [
        { title: 'Operation', value: 'Send Message' },
        { title: 'Chat', value: '#content-updates' },
      ],
      position: { x: 420, y: 260 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-3', source: 'schedule-1', target: 'agent-2' },
    { id: 'e-4', source: 'schedule-1', target: 'telegram-1' },
  ],
}

/**
 * Empty "New Agent" workflow — a single note prompting the user to start building
 */
const NEW_AGENT_WORKFLOW: PreviewWorkflow = {
  id: 'wf-new-agent',
  name: 'New Agent',
  color: '#787878',
  blocks: [
    {
      id: 'note-1',
      name: '',
      type: 'note',
      bgColor: 'transparent',
      rows: [],
      markdown: '### What will you build?\n\n_"Find Slack todos and add them to Linear"_',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      hideSourceHandle: true,
    },
  ],
  edges: [],
}

export const PREVIEW_WORKFLOWS: PreviewWorkflow[] = [
  IT_SERVICE_WORKFLOW,
  CONTENT_PIPELINE_WORKFLOW,
  NEW_AGENT_WORKFLOW,
]

/** Stagger delay between each block appearing (seconds). */
export const BLOCK_STAGGER = 0.12

/** Shared cubic-bezier easing — fast deceleration, gentle settle. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

/** Shared edge style applied to all preview workflow connections */
const EDGE_STYLE = { stroke: '#454545', strokeWidth: 1.5 } as const

/**
 * Converts a PreviewWorkflow to React Flow nodes and edges.
 *
 * @param workflow - The workflow definition
 * @param animate - When true, node/edge data includes animation metadata
 */
export function toReactFlowElements(
  workflow: PreviewWorkflow,
  animate = false
): {
  nodes: Node[]
  edges: Edge[]
} {
  const blockIndexMap = new Map(workflow.blocks.map((b, i) => [b.id, i]))

  const nodes: Node[] = workflow.blocks.map((block, index) => ({
    id: block.id,
    type: 'previewBlock',
    position: block.position,
    data: {
      name: block.name,
      blockType: block.type,
      bgColor: block.bgColor,
      rows: block.rows,
      tools: block.tools,
      markdown: block.markdown,
      hideTargetHandle: block.hideTargetHandle,
      hideSourceHandle: block.hideSourceHandle,
      index,
      animate,
    },
    draggable: true,
    selectable: false,
    connectable: false,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }))

  const edges: Edge[] = workflow.edges.map((e) => {
    const sourceIndex = blockIndexMap.get(e.source) ?? 0
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'previewEdge',
      animated: false,
      style: EDGE_STYLE,
      sourceHandle: 'source',
      targetHandle: 'target',
      data: {
        animate,
        delay: animate ? sourceIndex * BLOCK_STAGGER + BLOCK_STAGGER : 0,
      },
    }
  })

  return { nodes, edges }
}
