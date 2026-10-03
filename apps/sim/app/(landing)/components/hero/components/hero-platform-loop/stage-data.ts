import { Table as TableIcon } from '@sim/emcn/icons'
import { CONNECTION_KNOB_PEAK_PX } from '@sim/workflow-renderer'
import {
  AgentIcon,
  ApiIcon,
  CodeIcon,
  ConditionalIcon,
  SlackIcon,
  StartIcon,
} from '@/components/icons'
import {
  BLOCK_WIDTH,
  type BlockDef,
  blockHeight,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * Design-space geometry for the hero's live workflow stage - the lead-enrichment
 * flow the chat conversation "builds": Start feeds a research agent, normalized
 * company data is scored, and a condition routes qualified leads through Slack
 * into Tables while the alternate path verifies the company through an API.
 * The graph follows production's left-input/right-output topology and extends
 * beyond the initial viewport so the homepage canvas has useful space to pan.
 *
 * Blocks are ordered by build sequence - the stage reveals `blocks[0..built-1]`
 * as the loop's build counter advances, and an edge draws once both its
 * endpoints are on canvas.
 */
export const STAGE_BLOCKS: BlockDef[] = [
  {
    id: 'start',
    name: 'Start',
    type: 'start_trigger',
    typeLabel: 'Start',
    icon: StartIcon,
    bgColor: 'var(--text-muted)',
    isTrigger: true,
    rows: [],
    x: 40,
    y: 310,
  },
  {
    id: 'enrich',
    name: 'Enrich lead',
    type: 'agent',
    typeLabel: 'Agent',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    sentence: {
      segments: ['Prompt', { subBlockId: 'model', noun: 'model' }],
      values: { model: 'GPT-6 Astra' },
    },
    rows: [],
    x: 390,
    y: 278,
  },
  {
    id: 'score',
    name: 'Score company fit',
    type: 'function',
    typeLabel: 'Function',
    icon: CodeIcon,
    bgColor: '#FF402F',
    sentence: {
      segments: ['Run', { subBlockId: 'code', noun: 'code' }],
      values: { code: 'code' },
    },
    rows: [],
    x: 740,
    y: 278,
  },
  {
    id: 'route',
    name: 'Qualified lead?',
    type: 'condition',
    typeLabel: 'Condition',
    icon: ConditionalIcon,
    bgColor: '#FF752F',
    rows: [
      { title: 'If', value: 'score ≥ 80' },
      { title: 'Else', value: 'score < 80' },
    ],
    x: 1090,
    y: 266,
  },
  {
    id: 'slack',
    name: 'Post qualified lead',
    type: 'slack',
    typeLabel: 'Slack',
    isIntegration: true,
    icon: SlackIcon,
    bgColor: '#611F69',
    sentence: {
      segments: [
        'Post',
        { subBlockId: 'message', noun: 'message' },
        'to',
        { subBlockId: 'channel', noun: 'channel' },
      ],
      values: { message: 'lead summary', channel: '#sales' },
    },
    rows: [],
    x: 1440,
    y: 170,
  },
  {
    id: 'tables',
    name: 'Save qualified lead',
    type: 'table',
    typeLabel: 'Table',
    icon: TableIcon,
    bgColor: '#10B981',
    isTerminal: true,
    sentence: {
      segments: ['Insert row into', { subBlockId: 'table', noun: 'table' }],
      values: { table: 'Qualified leads' },
    },
    rows: [],
    x: 1790,
    y: 170,
  },
  {
    id: 'verify',
    name: 'Verify company data',
    type: 'api',
    typeLabel: 'API',
    icon: ApiIcon,
    bgColor: '#2F55FF',
    isTerminal: true,
    sentence: {
      segments: [
        'Send',
        { subBlockId: 'method', noun: 'method' },
        'request to',
        { subBlockId: 'url', noun: 'a URL' },
      ],
      values: { method: 'GET', url: 'company API' },
    },
    rows: [],
    x: 1440,
    y: 430,
  },
]

/** Source → target pairs, drawn in order as their endpoints land on canvas. */
export const STAGE_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['start', 'enrich'],
  ['enrich', 'score'],
  ['score', 'route'],
  ['route', 'slack'],
  ['slack', 'tables'],
  ['route', 'verify'],
]

/** Initial camera viewport. The workflow continues to the right. */
export const STAGE_CANVAS = { width: 860, height: 720 } as const

/**
 * Rounded orthogonal ("smoothstep") path for a VERTICAL flow - from a source's
 * bottom-center handle to a target's top-center handle, stepping at the
 * vertical midpoint with `r`-radius corners. The horizontal-flow counterpart
 * lives in `hero-visual/workflow-data.ts`.
 */
export function verticalSmoothStep(sx: number, sy: number, tx: number, ty: number, r = 8): string {
  if (Math.abs(tx - sx) < 1) return `M ${sx} ${sy} L ${tx} ${ty}`
  const midY = (sy + ty) / 2
  const dir = tx >= sx ? 1 : -1
  return [
    `M ${sx} ${sy}`,
    `L ${sx} ${midY - r}`,
    `Q ${sx} ${midY} ${sx + dir * r} ${midY}`,
    `L ${tx - dir * r} ${midY}`,
    `Q ${tx} ${midY} ${tx} ${midY + r}`,
    `L ${tx} ${ty}`,
  ].join(' ')
}

/** Handle anchor points for a block at its fixed position. */
export function handleAnchors(block: BlockDef) {
  return {
    out: {
      x: block.x + BLOCK_WIDTH / 2,
      y: block.y + blockHeight(block) + CONNECTION_KNOB_PEAK_PX,
    },
    in: { x: block.x + BLOCK_WIDTH / 2, y: block.y - CONNECTION_KNOB_PEAK_PX },
  }
}
