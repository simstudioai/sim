import { AgentIcon, CodeIcon, SlackIcon, StartIcon, TableIcon } from '@/components/icons'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { BLOCK_WIDTH } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * Design-space geometry for the hero's live workflow stage - the lead-enrichment
 * flow the chat conversation "builds": Start feeds the enrichment agent, a
 * scoring function follows, and the flow fans out to Slack and Tables. Block
 * tiles use the platform's grey text ramp (each block a different shade, dark
 * enough to carry the white glyph) - color is reserved for REAL third-party
 * marks, so only Slack keeps its brand tile (#611F69).
 *
 * Blocks are ordered by build sequence - the stage reveals `blocks[0..built-1]`
 * as the loop's build counter advances, and an edge draws once both its
 * endpoints are on canvas.
 */
export const STAGE_BLOCKS: BlockDef[] = [
  {
    id: 'start',
    name: 'Start',
    icon: StartIcon,
    bgColor: 'var(--text-muted)',
    isTrigger: true,
    rows: [{ title: 'Inputs', value: '-' }],
    x: 155,
    y: 12,
  },
  {
    id: 'enrich',
    name: 'Enrich lead',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    rows: [
      { title: 'Messages', value: '-' },
      { title: 'Model', value: '-' },
      { title: 'Files', value: '-' },
    ],
    x: 155,
    y: 172,
  },
  {
    id: 'score',
    name: 'Score fit',
    icon: CodeIcon,
    bgColor: 'var(--text-secondary)',
    rows: [
      { title: 'Code', value: '-' },
      { title: 'Timeout', value: '-' },
    ],
    x: 155,
    y: 390,
  },
  {
    id: 'slack',
    name: 'Post to #sales',
    icon: SlackIcon,
    bgColor: '#611F69',
    isTerminal: true,
    rows: [
      { title: 'Channel', value: '-' },
      { title: 'Message', value: '-' },
    ],
    x: 0,
    y: 580,
  },
  {
    id: 'tables',
    name: 'Save to Tables',
    icon: TableIcon,
    bgColor: 'var(--text-body)',
    isTerminal: true,
    rows: [
      { title: 'Table', value: '-' },
      { title: 'Operation', value: '-' },
    ],
    x: 310,
    y: 580,
  },
]

/** Source → target pairs, drawn in order as their endpoints land on canvas. */
export const STAGE_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['start', 'enrich'],
  ['enrich', 'score'],
  ['score', 'slack'],
  ['score', 'tables'],
]

/** Design-space bounding box of the layout above. */
export const STAGE_CANVAS = { width: 560, height: 700 } as const

/**
 * Approximate rendered block height - the icon-tile header (~40px) plus the
 * rows section (16px padding + 21px per row + 8px gaps). Used to place a
 * block's bottom (outgoing) handle; a few px of drift is invisible at stage
 * scale.
 */
export function blockHeight(block: BlockDef): number {
  const n = block.rows.length
  return 40 + (n > 0 ? 16 + n * 21 + (n - 1) * 8 : 0)
}

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
    out: { x: block.x + BLOCK_WIDTH / 2, y: block.y + blockHeight(block) },
    in: { x: block.x + BLOCK_WIDTH / 2, y: block.y },
  }
}
