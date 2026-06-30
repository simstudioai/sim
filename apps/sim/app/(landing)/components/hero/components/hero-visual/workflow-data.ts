import type { ComponentType, SVGProps } from 'react'
import { AgentIcon, AnthropicIcon, GithubIcon, JiraIcon } from '@/components/icons'
import { CsvIcon, DocxIcon, MarkdownIcon, PdfIcon } from '@/components/icons/document-icons'

/**
 * Shared data + geometry for the hero visual - the single source of truth the
 * presentational stages render against. No JSX, no client code; pure data so it
 * can be imported by both server- and client-side modules.
 *
 * The workflow is laid out in a fixed "design space" (px). Block positions and
 * the SVG edge paths share these coordinates, so the `<svg>` overlay and the
 * absolutely-positioned block cards line up exactly. {@link CANVAS} is the
 * bounding box of that space; the stage scales it to fit the hero panel.
 */

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

/** A single field row inside a block card (label → value), faithful to the real WorkflowBlock. */
export interface BlockRow {
  title: string
  value: string
  /** Optional provider mark shown left of the value (e.g. Anthropic for a Claude model). */
  valueIcon?: IconComponent
}

/** A workflow block in design space. */
export interface BlockDef {
  id: string
  name: string
  icon: IconComponent
  /** Icon-tile fill - a brand-faithful color or a platform token (`var(--…)`). */
  bgColor: string
  /** White icon tiles (e.g. Jira) need a hairline so the mark stays visible. */
  tileBorder?: boolean
  /** Trigger blocks start the flow, so they render no incoming (left) handle. */
  isTrigger?: boolean
  /** Terminal blocks end the flow, so they render no outgoing (right) handle. */
  isTerminal?: boolean
  rows: BlockRow[]
  /** Top-left corner in design space. */
  x: number
  y: number
}

/** Fixed block width, matching the real canvas (`BLOCK_DIMENSIONS.FIXED_WIDTH`). */
export const BLOCK_WIDTH = 250

/**
 * Camera zoom while the workflow stage is focused on the first block. Chosen so
 * the focused first block lands at the same on-screen width as the chat card
 * (`BLOCK_WIDTH * SCALE ≈ 460`), so the chat card morphs straight into it with
 * no jump. Shared by the chat stage (its morph target) and the workflow camera.
 */
export const WORKFLOW_FOCUS_SCALE = 1.25

/** Handle vertical offset from a block's top edge (matches the real WorkflowBlock). */
export const HANDLE_Y_OFFSET = 20

/**
 * Design-space bounding box the stage scales to fit the panel. Sized to exactly
 * bound the blocks below (GitHub/Jira at y=0, Agent's foot at ~y=203), so the
 * stage's flex-centering centers the workflow with no stray margin.
 */
export const CANVAS = { width: 850, height: 206 } as const

/**
 * GitHub → Agent → Jira. A gentle staircase: GitHub and Jira ride high, the
 * Agent dips between them, so the two edges read as a clean down-then-up flow.
 * The shape is left-right symmetric (Agent centered at x=425) and its bounding
 * box matches {@link CANVAS}, keeping it centered in the panel.
 */
export const BLOCKS: BlockDef[] = [
  {
    id: 'github',
    name: 'GitHub',
    icon: GithubIcon,
    bgColor: '#181C1E',
    isTrigger: true,
    rows: [{ title: 'Trigger', value: 'PR opened' }],
    x: 0,
    y: 0,
  },
  {
    id: 'agent',
    name: 'Agent',
    icon: AgentIcon,
    bgColor: 'var(--brand-accent)',
    rows: [
      { title: 'Model', value: 'Claude', valueIcon: AnthropicIcon },
      { title: 'Task', value: 'Review PR' },
    ],
    x: 300,
    y: 96,
  },
  {
    id: 'jira',
    name: 'Jira',
    icon: JiraIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    isTerminal: true,
    rows: [{ title: 'Action', value: 'Create issue' }],
    x: 600,
    y: 0,
  },
]

/** An ordered source → target connection between two blocks. */
export interface EdgeDef {
  id: string
  /** SVG path `d` in design space; `pathLength` is normalized to 1 by the renderer. */
  d: string
}

/**
 * Rounded orthogonal ("smoothstep") path from a source's right handle to a
 * target's left handle, stepping at the horizontal midpoint with `r`-radius
 * corners. Source/target points are taken at `block.x±width` and
 * `block.y + HANDLE_Y_OFFSET`, matching where the handles render.
 */
function smoothStep(sx: number, sy: number, tx: number, ty: number, r = 8): string {
  const midX = (sx + tx) / 2
  const dir = ty >= sy ? 1 : -1
  return [
    `M ${sx} ${sy}`,
    `L ${midX - r} ${sy}`,
    `Q ${midX} ${sy} ${midX} ${sy + dir * r}`,
    `L ${midX} ${ty - dir * r}`,
    `Q ${midX} ${ty} ${midX + r} ${ty}`,
    `L ${tx} ${ty}`,
  ].join(' ')
}

function handlePoints(sourceId: string, targetId: string) {
  const source = BLOCKS.find((b) => b.id === sourceId)
  const target = BLOCKS.find((b) => b.id === targetId)
  if (!source || !target) throw new Error(`Unknown block in edge ${sourceId}→${targetId}`)
  return {
    sx: source.x + BLOCK_WIDTH,
    sy: source.y + HANDLE_Y_OFFSET,
    tx: target.x,
    ty: target.y + HANDLE_Y_OFFSET,
  }
}

export const EDGES: EdgeDef[] = (
  [
    ['github', 'agent'],
    ['agent', 'jira'],
  ] as const
).map(([from, to]) => {
  const { sx, sy, tx, ty } = handlePoints(from, to)
  return { id: `${from}-${to}`, d: smoothStep(sx, sy, tx, ty) }
})

/**
 * Unified hero scene geometry. The chat card is block 1 (GitHub), centered at
 * the panel center; the rest of the workflow is placed relative to it, all at
 * FOCUS scale (design × {@link WORKFLOW_FOCUS_SCALE}). The whole scene is then
 * scaled/translated to the OVERVIEW to reveal the full workflow - so the SAME
 * card element is continuously block 1 through the pull-out.
 *
 * Scene origin is the GitHub block's CENTER (which sits at the panel center).
 */
const GH_CENTER_X = BLOCK_WIDTH / 2
/** GitHub block half-height in design space (its content is ~77px tall). */
const GH_CENTER_Y = 38.5
const toSceneX = (dx: number) => (dx - GH_CENTER_X) * WORKFLOW_FOCUS_SCALE
const toSceneY = (dy: number) => (dy - GH_CENTER_Y) * WORKFLOW_FOCUS_SCALE

/** A satellite block (everything past block 1) placed in scene space. */
export interface SceneBlock {
  block: BlockDef
  /** Top-left in scene space (origin = panel center), at FOCUS scale. */
  left: number
  top: number
}

/**
 * Block 1 (GitHub) in scene space. It's the morphed chat card - rendered
 * content-only and clipped by the card's `overflow-hidden` - so its edge-handle
 * nub is drawn separately at this position, matching where a satellite block
 * (and its handle) would sit.
 */
export const SCENE_BLOCK1: SceneBlock = {
  block: BLOCKS[0],
  left: toSceneX(BLOCKS[0].x),
  top: toSceneY(BLOCKS[0].y),
}

/** Blocks 2…N, positioned relative to the centered first block. */
export const SCENE_SATELLITES: SceneBlock[] = BLOCKS.slice(1).map((block) => ({
  block,
  left: toSceneX(block.x),
  top: toSceneY(block.y),
}))

/** Edge paths in scene space (same connections as {@link EDGES}). */
export const SCENE_EDGES: EdgeDef[] = (
  [
    ['github', 'agent'],
    ['agent', 'jira'],
  ] as const
).map(([from, to]) => {
  const { sx, sy, tx, ty } = handlePoints(from, to)
  return {
    id: `${from}-${to}`,
    d: smoothStep(toSceneX(sx), toSceneY(sy), toSceneX(tx), toSceneY(ty), 14),
  }
})

/**
 * Pull-out transform from FOCUS (block 1 centered, full size) to OVERVIEW (whole
 * workflow centered, fit to panel). `SCALE` brings the FOCUS-scale scene down to
 * the design overview (1.84 × 0.37 ≈ 0.68); the translate recenters the group -
 * it matches the design overview's GitHub offset, so the framing is identical to
 * the prior camera overview. Transform-origin is the panel center (block 1's
 * center), so FOCUS is the identity transform (no measurement needed).
 */
export const SCENE_OVERVIEW_SCALE = 0.68 / WORKFLOW_FOCUS_SCALE
export const SCENE_OVERVIEW_TRANSLATE = { x: -204, y: -43 } as const

/** Camera scale while tracing the workflow edge-by-edge before the full zoom-out. */
export const SCENE_FOLLOW_SCALE = 0.86

/**
 * Intermediate camera stops for the edge-follow pass. These keep the active
 * destination block centered enough to read while preserving a little context
 * around the incoming connection.
 */
export const SCENE_AGENT_FOCUS_TRANSLATE = { x: -323, y: -126 } as const
export const SCENE_JIRA_FOCUS_TRANSLATE = { x: -645, y: 0 } as const

/**
 * The typed prompt, encoded as ordered atoms the typewriter reveals one at a
 * time. A `char` atom is a single character; a `mention` atom pops in
 * atomically as an inline icon-chip - exactly how the real input renders an
 * `@GitHub` / `@Jira` mention.
 */
export type PromptAtom =
  | { kind: 'char'; char: string }
  | { kind: 'mention'; label: string; icon: IconComponent }

const PROMPT_SEGMENTS: Array<string | { label: string; icon: IconComponent }> = [
  'Create me a ',
  { label: 'GitHub', icon: GithubIcon },
  ' PR review bot that connects to ',
  { label: 'Jira', icon: JiraIcon },
]

export const PROMPT_ATOMS: PromptAtom[] = PROMPT_SEGMENTS.flatMap((seg) =>
  typeof seg === 'string'
    ? [...seg].map((char): PromptAtom => ({ kind: 'char', char }))
    : [{ kind: 'mention', label: seg.label, icon: seg.icon } as PromptAtom]
)

/** Greeting shown above the input in the home state (matches the Mothership home). */
export const HOME_GREETING = 'What should we get done?'

/** Total reveal cadence for the typewriter, in ms per atom. */
export const TYPE_MS_PER_ATOM = 45

/**
 * The Mothership's reply, typed out after it "thinks" (the cycle loader). Keeps
 * the world voice - it dispatches an agent - and previews the workflow it's
 * about to build, so the chat answer morphs naturally into the canvas below.
 */
export const ANSWER_TEXT = 'On it, dispatching an agent to review every PR and open a Jira issue.'

/** Reveal cadence for the answer typewriter (faster than a human; the AI types). */
export const ANSWER_MS_PER_CHAR = 18

/** White chat card grow after send, before the sent-message bubble is visible. */
export const SEND_BUBBLE_GROW_MS = 620

/** Delay the grey sent-message reveal until the card grow has visibly settled. */
export const SEND_BUBBLE_REVEAL_DELAY_MS = SEND_BUBBLE_GROW_MS + 260

/** Soft enter for the grey sent-message bubble once the card has room for it. */
export const SEND_BUBBLE_ENTER_MS = 280

/** Full send beat duration: grow, reveal, then a brief hold before loader slide. */
export const SEND_BUBBLE_HOLD_MS = SEND_BUBBLE_REVEAL_DELAY_MS + SEND_BUBBLE_ENTER_MS + 220

/** Knowledge-base name shown pre-filled in the create modal. */
export const KB_NAME = 'Product Docs'

/** A file shown dropping into the knowledge-base create modal. */
export interface KbFile {
  name: string
  size: string
  icon: IconComponent
}

export const KB_FILES: KbFile[] = [
  { name: 'product-spec.pdf', size: '2.4 MB', icon: PdfIcon },
  { name: 'api-reference.md', size: '88 KB', icon: MarkdownIcon },
  { name: 'support-faq.docx', size: '1.1 MB', icon: DocxIcon },
  { name: 'pricing.csv', size: '12 KB', icon: CsvIcon },
]

/** Design-space bounding box for the embedding graph (its own SVG viewBox). */
export const GRAPH_VIEWBOX = { width: 340, height: 150 } as const

/** A node in the embedding graph. Hubs are larger, darker, and gently pulse. */
export interface GraphNode {
  x: number
  y: number
  hub?: boolean
}

/**
 * A single connected knowledge-graph laid out organically across the viewBox -
 * three hubs with satellites, bridged into one mesh. Hand-placed (deterministic,
 * SSR-stable) for a balanced, deliberate look rather than random scatter.
 */
export const GRAPH_NODES: GraphNode[] = [
  { x: 38, y: 66 },
  { x: 74, y: 104 },
  { x: 96, y: 44 },
  { x: 132, y: 82, hub: true },
  { x: 158, y: 40 },
  { x: 168, y: 116 },
  { x: 206, y: 70, hub: true },
  { x: 228, y: 38 },
  { x: 236, y: 112 },
  { x: 268, y: 72 },
  { x: 300, y: 104, hub: true },
  { x: 312, y: 58 },
  { x: 286, y: 40 },
  { x: 54, y: 96 },
  { x: 140, y: 122 },
  { x: 250, y: 96 },
]

/** Edges between {@link GRAPH_NODES} (index pairs) - one connected component. */
export const GRAPH_EDGES: Array<[number, number]> = [
  [0, 2],
  [0, 13],
  [13, 1],
  [1, 3],
  [2, 3],
  [2, 4],
  [3, 4],
  [3, 5],
  [3, 14],
  [5, 14],
  [4, 6],
  [6, 7],
  [6, 15],
  [6, 8],
  [7, 12],
  [12, 9],
  [9, 15],
  [8, 15],
  [9, 10],
  [8, 10],
  [10, 11],
  [11, 12],
  [9, 11],
]
