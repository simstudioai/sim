import {
  AgentIcon,
  AnthropicIcon,
  CodeIcon,
  GmailIcon,
  HubspotIcon,
  SlackIcon,
} from '@/components/icons'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { BLOCK_WIDTH } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * Design-space geometry for the hero's live workflow stage - the lead-enrichment
 * flow the chat conversation "builds": a new HubSpot lead feeds the enrichment
 * agent (grounded on the Sales playbook knowledge base and a Claude model), a
 * fit score follows, and the flow fans out to a Slack post and a Gmail intro.
 * Every step past the code block is a REAL third-party integration, so its tile
 * carries the brand mark - HubSpot (#FF7A59), Slack (#611F69), and Gmail (white
 * tile, brand glyph); the Agent and Code blocks keep the platform grey ramp.
 * Same four-level footprint as before, so it fits the right pane unchanged.
 *
 * Blocks are ordered by build sequence - the stage reveals `blocks[0..built-1]`
 * as the loop's build counter advances, and an edge draws once both its
 * endpoints are on canvas.
 */
export const STAGE_BLOCKS: BlockDef[] = [
  {
    id: 'hubspot',
    name: 'New HubSpot lead',
    icon: HubspotIcon,
    bgColor: '#FF7A59',
    isTrigger: true,
    rows: [{ title: 'Event', value: 'New contact' }],
    x: 155,
    y: 12,
  },
  {
    id: 'enrich',
    name: 'Enrich lead',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    rows: [
      { title: 'Model', value: 'Claude', valueIcon: AnthropicIcon },
      { title: 'Instructions', value: 'Qualify vs ICP' },
      { title: 'Knowledge', value: 'Sales playbook' },
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
      { title: 'Code', value: 'score.ts' },
      { title: 'Timeout', value: '30s' },
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
      { title: 'Channel', value: '#sales' },
      { title: 'Message', value: 'Summary' },
    ],
    x: 0,
    y: 580,
  },
  {
    id: 'gmail',
    name: 'Send intro',
    icon: GmailIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    isTerminal: true,
    rows: [
      { title: 'To', value: 'lead.email' },
      { title: 'Subject', value: 'Welcome' },
    ],
    x: 310,
    y: 580,
  },
]

/** Source → target pairs, drawn in order as their endpoints land on canvas. */
export const STAGE_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['hubspot', 'enrich'],
  ['enrich', 'score'],
  ['score', 'slack'],
  ['score', 'gmail'],
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

/** Handle anchor points for a block at a live position. */
export function handleAnchors(block: BlockDef, pos: { x: number; y: number }) {
  return {
    out: { x: pos.x + BLOCK_WIDTH / 2, y: pos.y + blockHeight(block) },
    in: { x: pos.x + BLOCK_WIDTH / 2, y: pos.y },
  }
}
