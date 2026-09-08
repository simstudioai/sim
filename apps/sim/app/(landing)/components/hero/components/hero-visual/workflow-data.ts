import type { ComponentType, SVGProps } from 'react'
import type {
  BLOCK_DIMENSIONS,
  CONNECTION_KNOB_PEAK_PX,
  HANDLE_POSITIONS,
} from '@sim/workflow-renderer'
import { AgentIcon, GithubIcon, JiraIcon } from '@/components/icons'
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

/** A production-style natural-language summary shown below a block header. */
export interface BlockSentence {
  segments: ReadonlyArray<string | { subBlockId: string; noun?: string }>
  values: Readonly<Record<string, string>>
}

/** A workflow block in design space. */
export interface BlockDef {
  id: string
  name: string
  /** Production block type used by the shared workflow card renderer. */
  type?: string
  /** Production type label shown in the card's header tag. */
  typeLabel?: string
  /** Uses the provider's brand treatment instead of a core workflow accent. */
  isIntegration?: boolean
  icon: IconComponent
  /** Icon-tile fill - a brand-faithful color or a platform token (`var(--…)`). */
  bgColor: string
  /** White icon tiles (e.g. Jira) need a hairline so the mark stays visible. */
  tileBorder?: boolean
  /** Trigger blocks start the flow, so they render no incoming (left) handle. */
  isTrigger?: boolean
  /** Terminal blocks end the flow, so they render no outgoing (right) handle. */
  isTerminal?: boolean
  /** Natural-language canvas summary used by current production block cards. */
  sentence?: BlockSentence
  rows: BlockRow[]
  /** Top-left corner in design space. */
  x: number
  y: number
}

/** Fixed block width, matching the real canvas (`BLOCK_DIMENSIONS.FIXED_WIDTH`). */
export const BLOCK_WIDTH = 250

/**
 * Compile-time pins onto the shared renderer's card dimensions. This module is
 * pure data that server modules also import, so it carries no runtime renderer
 * import; the numbers are spelled out here and their types force them to
 * track `BLOCK_DIMENSIONS`, `HANDLE_POSITIONS`, and `CONNECTION_KNOB_PEAK_PX`.
 */
const HEADER_HEIGHT: (typeof BLOCK_DIMENSIONS)['HEADER_HEIGHT'] = 40
const CONTENT_PADDING: (typeof BLOCK_DIMENSIONS)['WORKFLOW_CONTENT_PADDING'] = 16
const ROW_HEIGHT: (typeof BLOCK_DIMENSIONS)['WORKFLOW_ROW_HEIGHT'] = 20
const CONTENT_GAP: (typeof BLOCK_DIMENSIONS)['WORKFLOW_CONTENT_GAP'] = 8
const ERROR_ROW_HEIGHT: (typeof BLOCK_DIMENSIONS)['WORKFLOW_ERROR_ROW_HEIGHT'] = 24
const SENTENCE_LINE_HEIGHT: (typeof BLOCK_DIMENSIONS)['WORKFLOW_SENTENCE_LINE_HEIGHT'] = 24
const HEADER_ONLY_HEIGHT: (typeof BLOCK_DIMENSIONS)['MIN_PAINTED_HEIGHT'] = 48
const CONDITION_START_Y: (typeof HANDLE_POSITIONS)['CONDITION_START_Y'] = 58
const CONDITION_ROW_HEIGHT: (typeof HANDLE_POSITIONS)['CONDITION_ROW_HEIGHT'] = 28
/** Tip of a connection knob, outside the card edge - where an edge starts and ends. */
export const HANDLE_KNOB_PEAK: typeof CONNECTION_KNOB_PEAK_PX = 7

/**
 * Exact read-only production card height: the header, a padded content stack
 * of summary rows or one sentence line, the gaps between them, and the disabled
 * error row every non-trigger block carries. A header-only card paints at the
 * border's minimum.
 */
export function blockHeight(block: BlockDef): number {
  const showErrorRow = !block.isTrigger
  const contentRows = block.sentence ? 1 : block.rows.length
  const contentItems = contentRows + (showErrorRow ? 1 : 0)
  if (contentItems === 0) return HEADER_ONLY_HEIGHT

  const summaryHeight = block.sentence ? SENTENCE_LINE_HEIGHT : contentRows * ROW_HEIGHT
  const contentHeight = summaryHeight + (showErrorRow ? ERROR_ROW_HEIGHT : 0)
  return (
    HEADER_HEIGHT + CONTENT_PADDING + contentHeight + Math.max(0, contentItems - 1) * CONTENT_GAP
  )
}

/**
 * Production left-input / right-output anchors: the knob tips at the card's
 * vertical centre, or on a condition block's branch rows for its outputs.
 */
export function horizontalHandleAnchors(block: BlockDef, branchIndex?: number) {
  const sourceY =
    block.type === 'condition' && branchIndex !== undefined
      ? block.y + CONDITION_START_Y + branchIndex * CONDITION_ROW_HEIGHT
      : block.y + blockHeight(block) / 2

  return {
    out: { x: block.x + BLOCK_WIDTH + HANDLE_KNOB_PEAK, y: sourceY },
    in: { x: block.x - HANDLE_KNOB_PEAK, y: block.y + blockHeight(block) / 2 },
  }
}

/**
 * Camera zoom while the workflow stage is focused on the first block. Chosen so
 * the focused first block lands at the same on-screen width as the chat card
 * (`BLOCK_WIDTH * SCALE ≈ 460`), so the chat card morphs straight into it with
 * no jump. Shared by the chat stage (its morph target) and the workflow camera.
 */
export const WORKFLOW_FOCUS_SCALE = 1.25

/**
 * GitHub → Agent → Jira, the workflow Sim builds from the demo prompt. A gentle
 * staircase: GitHub and Jira ride high, the Agent dips between them, so the
 * two edges read as a clean down-then-up flow. Every block carries the fields
 * the production card renders - its type tag, the provider treatment, and the
 * card's natural-language sentence - so the demo draws the real card. The
 * GitHub block has no trigger picker, so its trigger sentence is the resolver's
 * literal form (`Run on <trigger name>`); the Agent and Jira sentences follow
 * their blocks' own `sentences` config with the configured values as chips.
 */
export const BLOCKS: BlockDef[] = [
  {
    id: 'github',
    name: 'PR opened',
    type: 'github',
    typeLabel: 'GitHub',
    isIntegration: true,
    icon: GithubIcon,
    bgColor: '#181C1E',
    isTrigger: true,
    sentence: {
      segments: ['Run on GitHub PR Opened'],
      values: {},
    },
    rows: [],
    x: 0,
    y: 0,
  },
  {
    id: 'agent',
    name: 'Review PR',
    type: 'agent',
    typeLabel: 'Agent',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    sentence: {
      segments: ['Prompt', { subBlockId: 'model', noun: 'a model' }],
      values: { model: 'claude-sonnet-5' },
    },
    rows: [],
    x: 300,
    y: 96,
  },
  {
    id: 'jira',
    name: 'Create issue',
    type: 'jira',
    typeLabel: 'Jira',
    isIntegration: true,
    icon: JiraIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    isTerminal: true,
    sentence: {
      segments: [
        'Create',
        { subBlockId: 'issueType', noun: 'an issue' },
        'in',
        { subBlockId: 'project', noun: 'a project' },
      ],
      values: { issueType: 'Task', project: 'ENG' },
    },
    rows: [],
    x: 600,
    y: 0,
  },
]

/**
 * Design-space bounding box of {@link BLOCKS}, derived from the cards' real
 * heights so the overview camera centres the workflow with no stray margin.
 */
export const CANVAS = {
  width: Math.max(...BLOCKS.map((block) => block.x + BLOCK_WIDTH)),
  height: Math.max(...BLOCKS.map((block) => block.y + blockHeight(block))),
} as const

/**
 * Corner radius of a production edge (`WorkflowEdgeView` passes 8 to React
 * Flow's smooth-step path), in design px.
 */
const EDGE_CORNER_RADIUS = 8

/** An ordered source → target connection between two blocks. */
export interface EdgeDef {
  id: string
  /** SVG path `d` in design space; `pathLength` is normalized to 1 by the renderer. */
  d: string
}

/**
 * Rounded orthogonal ("smoothstep") path from a source's right handle to a
 * target's left handle, stepping at the horizontal midpoint with `r`-radius
 * corners - the same route React Flow draws between two production cards.
 * Endpoints come from {@link horizontalHandleAnchors}: the knob tips at each
 * card's vertical centre.
 */
export function smoothStep(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  r = EDGE_CORNER_RADIUS
): string {
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
  const out = horizontalHandleAnchors(source).out
  const inbound = horizontalHandleAnchors(target).in
  return { sx: out.x, sy: out.y, tx: inbound.x, ty: inbound.y }
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
/** The GitHub card's half-height in design space, from its real card height. */
const GH_CENTER_Y = blockHeight(BLOCKS[0]) / 2
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
    d: smoothStep(
      toSceneX(sx),
      toSceneY(sy),
      toSceneX(tx),
      toSceneY(ty),
      EDGE_CORNER_RADIUS * WORKFLOW_FOCUS_SCALE
    ),
  }
})

/**
 * Pull-out transform from FOCUS (block 1 centered, full size) to OVERVIEW (whole
 * workflow centered, fit to panel). `SCALE` brings the FOCUS-scale scene down to
 * the design overview (1.84 × 0.37 ≈ 0.68). Transform-origin is the panel
 * center (block 1's center), so FOCUS is the identity transform.
 */
export const SCENE_OVERVIEW_SCALE = 0.68 / WORKFLOW_FOCUS_SCALE

/** Camera scale while tracing the workflow edge-by-edge before the full zoom-out. */
export const SCENE_FOLLOW_SCALE = 0.86

/** A point's scene-space position under the camera transform. */
interface ScenePoint {
  x: number
  y: number
}

/** The camera translate that puts scene point `center` on the panel centre at `scale`. */
function centeringTranslate(center: ScenePoint, scale: number): ScenePoint {
  return { x: -center.x * scale, y: -center.y * scale }
}

/** A block's centre in scene space, from its real card height. */
function sceneCenter(block: BlockDef): ScenePoint {
  return {
    x: toSceneX(block.x + BLOCK_WIDTH / 2),
    y: toSceneY(block.y + blockHeight(block) / 2),
  }
}

/**
 * The overview's translate recentres the whole workflow's bounding box, so the
 * framing follows the cards' real heights.
 */
export const SCENE_OVERVIEW_TRANSLATE = centeringTranslate(
  { x: toSceneX(CANVAS.width / 2), y: toSceneY(CANVAS.height / 2) },
  SCENE_OVERVIEW_SCALE
)

/**
 * Intermediate camera stops for the edge-follow pass: each centres the block
 * the connection just reached, at follow scale, so the destination reads
 * while a little of the incoming connection stays in view.
 */
export const SCENE_AGENT_FOCUS_TRANSLATE = centeringTranslate(
  sceneCenter(BLOCKS[1]),
  SCENE_FOLLOW_SCALE
)
export const SCENE_JIRA_FOCUS_TRANSLATE = centeringTranslate(
  sceneCenter(BLOCKS[2]),
  SCENE_FOLLOW_SCALE
)

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
