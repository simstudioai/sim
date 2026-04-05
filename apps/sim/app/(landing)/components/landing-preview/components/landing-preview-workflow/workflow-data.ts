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
  /** Public JSON export used to seed the landing-page import flow */
  seedPath?: string
}

/**
 * IT Service Management workflow — Slack Trigger -> Agent (KB tool) -> Jira
 */
const IT_SERVICE_WORKFLOW: PreviewWorkflow = {
  id: 'wf-it-service',
  name: 'IT Service Management',
  color: '#FF6B2C',
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
        {
          title: 'System Prompt',
          value:
            'Triage incoming IT support requests from Slack, categorize by severity, and create Jira tickets for the appropriate team.',
        },
      ],
      tools: [{ name: 'Knowledge Base', type: 'knowledge_base', bgColor: '#10B981' }],
      position: { x: 420, y: 40 },
    },
    {
      id: 'jira-1',
      name: 'Jira',
      type: 'jira',
      bgColor: '#E0E0E0',
      rows: [
        { title: 'Operation', value: 'Get Issues' },
        { title: 'Project', value: 'IT-Support' },
      ],
      position: { x: 420, y: 260 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-1', source: 'slack-1', target: 'agent-1' },
    { id: 'e-2', source: 'slack-1', target: 'jira-1' },
  ],
}

/**
 * Self-healing CRM workflow — Schedule -> Agent
 */
const SELF_HEALING_CRM_WORKFLOW: PreviewWorkflow = {
  id: 'wf-self-healing-crm',
  name: 'Self-healing CRM',
  color: '#33C482',
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
      id: 'agent-crm',
      name: 'CRM Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'gpt-5.4' },
        {
          title: 'System Prompt',
          value:
            'Audit CRM records, identify data inconsistencies, and fix duplicate contacts, missing fields, and stale pipeline entries across HubSpot and Salesforce.',
        },
      ],
      tools: [
        { name: 'HubSpot', type: 'hubspot', bgColor: '#FF7A59' },
        { name: 'Salesforce', type: 'salesforce', bgColor: '#E0E0E0' },
      ],
      position: { x: 420, y: 140 },
      hideSourceHandle: true,
    },
  ],
  edges: [{ id: 'e-3', source: 'schedule-1', target: 'agent-crm' }],
}

/**
 * Customer Support Agent workflow — Gmail Trigger -> Agent (KB + Notion tools) -> Slack
 */
const CUSTOMER_SUPPORT_WORKFLOW: PreviewWorkflow = {
  id: 'wf-customer-support',
  name: 'Customer Support Agent',
  color: '#0EA5E9',
  blocks: [
    {
      id: 'gmail-1',
      name: 'Gmail',
      type: 'gmail',
      bgColor: '#E0E0E0',
      rows: [
        { title: 'Event', value: 'New Email' },
        { title: 'Label', value: 'Support' },
      ],
      position: { x: 80, y: 140 },
      hideTargetHandle: true,
    },
    {
      id: 'agent-3',
      name: 'Support Agent',
      type: 'agent',
      bgColor: '#701ffc',
      rows: [
        { title: 'Model', value: 'gpt-5.4' },
        {
          title: 'System Prompt',
          value:
            'Resolve customer support issues using the knowledge base, draft a response, and notify the team in Slack.',
        },
      ],
      tools: [
        { name: 'Knowledge', type: 'knowledge_base', bgColor: '#10B981' },
        { name: 'Notion', type: 'notion', bgColor: '#181C1E' },
      ],
      position: { x: 420, y: 40 },
    },
    {
      id: 'slack-3',
      name: 'Slack',
      type: 'slack',
      bgColor: '#611f69',
      rows: [
        { title: 'Channel', value: '#support' },
        { title: 'Operation', value: 'Send Message' },
      ],
      position: { x: 420, y: 260 },
      hideSourceHandle: true,
    },
  ],
  edges: [
    { id: 'e-cs-1', source: 'gmail-1', target: 'agent-3' },
    { id: 'e-cs-2', source: 'gmail-1', target: 'slack-3' },
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
      markdown: '### What will you build?\n\n_"Find Linear todos and send in Slack"_',
      position: { x: 0, y: 0 },
      hideTargetHandle: true,
      hideSourceHandle: true,
    },
  ],
  edges: [],
}

export const PREVIEW_WORKFLOWS: PreviewWorkflow[] = [
  SELF_HEALING_CRM_WORKFLOW,
  IT_SERVICE_WORKFLOW,
  CUSTOMER_SUPPORT_WORKFLOW,
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
  animate = false,
  highlightedBlockId?: string | null
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
      isHighlighted: highlightedBlockId === block.id,
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

/** Block types that carry an editable prompt suitable for the Editor tab. */
const AGENT_BLOCK_TYPES = new Set(['agent', 'mothership'])

export interface EditorPromptData {
  blockId: string
  blockName: string
  blockType: string
  bgColor: string
  prompt: string
  model: string | null
  tools: PreviewTool[]
}

/**
 * Extracts the editor-facing prompt from the first agent/mothership block.
 *
 * @returns Block metadata + prompt + model + tools, or `null` when the workflow has no agent.
 */
export function getEditorPrompt(workflow: PreviewWorkflow): EditorPromptData | null {
  for (const block of workflow.blocks) {
    if (!AGENT_BLOCK_TYPES.has(block.type)) continue
    const promptRow = block.rows.find((r) => r.title === 'Prompt' || r.title === 'System Prompt')
    if (promptRow) {
      const modelRow = block.rows.find((r) => r.title === 'Model')
      return {
        blockId: block.id,
        blockName: block.name,
        blockType: block.type,
        bgColor: block.bgColor,
        prompt: promptRow.value,
        model: modelRow?.value ?? null,
        tools: block.tools ?? [],
      }
    }
  }
  return null
}

/**
 * Computes the delay (ms) before the Editor tab should activate.
 * Accounts for all block staggers + edge draw durations + a small buffer.
 */
export function getWorkflowAnimationTiming(workflow: PreviewWorkflow): { editorDelay: number } {
  const maxBlockIndex = Math.max(0, workflow.blocks.length - 1)
  const hasEdges = workflow.edges.length > 0
  const edgeDuration = hasEdges ? 0.4 : 0
  const buffer = 0.15
  const total = maxBlockIndex * BLOCK_STAGGER + BLOCK_STAGGER + edgeDuration + buffer
  return { editorDelay: Math.round(total * 1000) }
}

/** Milliseconds between each character typed in the Editor prompt animation. */
export const TYPE_INTERVAL_MS = 30

/** Extra pause (ms) after switching to the Editor tab before typing begins. */
export const TYPE_START_BUFFER_MS = 150

/** How long to dwell on a completed step before advancing (ms). */
export const STEP_DWELL_MS = 2500

/**
 * Computes the total time (ms) a workflow step occupies, including
 * canvas animation, editor typing, and a dwell period.
 */
export function getWorkflowStepDuration(workflow: PreviewWorkflow): number {
  const { editorDelay } = getWorkflowAnimationTiming(workflow)
  const prompt = getEditorPrompt(workflow)
  const typingTime = prompt ? prompt.prompt.length * TYPE_INTERVAL_MS : 0
  return editorDelay + TYPE_START_BUFFER_MS + typingTime + STEP_DWELL_MS
}
