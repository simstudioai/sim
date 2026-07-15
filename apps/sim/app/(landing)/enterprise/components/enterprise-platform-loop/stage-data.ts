import { AgentIcon, ConditionalIcon, MailIcon, StartIcon, TableIcon } from '@/components/icons'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * Content + timing config for the enterprise hero's platform loop. Kept in one
 * place (and phase starts derived, not hardcoded) so later stages - tables,
 * files, knowledge base, logs walkthroughs - extend the timeline by appending
 * beats here rather than reworking the clock.
 */

/** The new-chat greeting, personalized like the real workspace Home. */
export const ENTERPRISE_GREETING = 'What should we get done, Morgan?'

/** Placeholder shown in the composer before the prompt types out. */
export const COMPOSER_PLACEHOLDER = 'Ask Sim to automate a process.'

/**
 * The prompt the loop types - a large company's multi-system operational
 * workflow (AP + NetSuite + finance review + audit trail), concise enough to
 * type on screen.
 */
export const ENTERPRISE_PROMPT =
  'When a vendor invoice lands in AP, match it against the PO in NetSuite, flag exceptions for finance review, and log the approval trail.'

/** Typewriter cadence for the composer prompt. */
export const PROMPT_CHAR_MS = 28

/** Sim's reply, streamed word by word once the workflow finishes building. */
export const ENTERPRISE_REPLY =
  "On it. I'll match each AP invoice to its PO in NetSuite, route exceptions to finance review, and log the full approval trail."

/** Word-reveal cadence for the streamed reply. */
export const REPLY_WORD_MS = 55

/**
 * Recent chats - enterprise-flavored, so Brightwave reads long-tenured. Four
 * entries: together with the five workflows this fills the sidebar's 735px
 * design height exactly, without clipping the Workflows section.
 */
export const SIDEBAR_CHATS = [
  'Vendor invoice exceptions',
  'Q3 access review',
  'NetSuite sync errors',
  'Supplier onboarding docs',
] as const

/** Deployed workflows - a fuller section than the homepage's three. */
export const SIDEBAR_WORKFLOWS = [
  'Invoice exception routing',
  'Employee onboarding',
  'Vendor risk scoring',
  'IT access provisioning',
  'Weekly compliance report',
] as const

/** Suggested actions under the composer, mirroring the real Home rows. */
export const SUGGESTED_ACTIONS = [
  'Reconcile vendor invoices in NetSuite',
  'Triage pending IT access requests',
  'Summarize open compliance exceptions',
  'Draft the weekly ops readiness report',
] as const

/**
 * The workflow the chat "builds" on the stage pane - the invoice-matching flow
 * the prompt describes, distilled to what reads at mini-app scale: Start feeds
 * the NetSuite PO match, exceptions are flagged, and the flow fans out to
 * finance review and the audit log. Same geometry conventions as the homepage
 * stage (250px blocks, vertical spine at x=155, terminals fanned at y=580);
 * tiles use the platform's grey text ramp - color is reserved for real
 * third-party marks, and none of these carry one.
 *
 * Ordered by build sequence; an edge draws once both endpoints are on canvas.
 */
export const ENTERPRISE_STAGE_BLOCKS: BlockDef[] = [
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
    id: 'match',
    name: 'Match PO',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    rows: [
      { title: 'Messages', value: '-' },
      { title: 'Model', value: '-' },
    ],
    x: 155,
    y: 172,
  },
  {
    id: 'exceptions',
    name: 'Flag exceptions',
    icon: ConditionalIcon,
    bgColor: 'var(--text-secondary)',
    rows: [{ title: 'Conditions', value: '-' }],
    x: 155,
    y: 372,
  },
  {
    id: 'review',
    name: 'Finance review',
    icon: MailIcon,
    bgColor: 'var(--text-body)',
    isTerminal: true,
    rows: [
      { title: 'To', value: '-' },
      { title: 'Subject', value: '-' },
    ],
    x: 0,
    y: 560,
  },
  {
    id: 'audit',
    name: 'Audit log',
    icon: TableIcon,
    bgColor: 'var(--text-muted)',
    isTerminal: true,
    rows: [
      { title: 'Table', value: '-' },
      { title: 'Operation', value: '-' },
    ],
    x: 310,
    y: 560,
  },
]

/** Source → target pairs, drawn in order as their endpoints land on canvas. */
export const ENTERPRISE_STAGE_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['start', 'match'],
  ['match', 'exceptions'],
  ['exceptions', 'review'],
  ['exceptions', 'audit'],
]

/** Design-space bounding box of the layout above. */
export const ENTERPRISE_STAGE_CANVAS = { width: 560, height: 680 } as const

/** Where the main pane is within one loop pass. */
export type EnterpriseLoopPhase = 'idle' | 'typing' | 'typed' | 'dispatch' | 'reply'

/**
 * Everything domain-specific the platform loop replays - the sidebar's
 * workspace identity, the chat exchange, and the staged workflow. The
 * solutions pages supply their own content through this shape; the enterprise
 * page renders {@link ENTERPRISE_LOOP_CONTENT} by default, so its hero stays
 * byte-for-byte what it was before the loop was parametrized.
 */
export interface EnterpriseLoopContent {
  /** Workspace name shown in the sidebar header. */
  workspaceName: string
  /** The new-chat greeting, personalized like the real workspace Home. */
  greeting: string
  /** Composer placeholder shown before the prompt types out. */
  placeholder: string
  /** The prompt the loop types - concise enough to type on screen. */
  prompt: string
  /** Sim's reply, streamed word by word once the workflow finishes building. */
  reply: string
  /** Recent chats in the sidebar - exactly four fill the design height. */
  sidebarChats: readonly [string, string, string, string]
  /** Deployed workflows in the sidebar - exactly five fill the design height. */
  sidebarWorkflows: readonly [string, string, string, string, string]
  /** Suggested actions under the composer - one per leading icon. */
  suggestedActions: readonly [string, string, string, string]
  /** The workflow the chat "builds" on the stage pane, in build order. */
  stageBlocks: BlockDef[]
  /** Source → target pairs among {@link stageBlocks}, drawn in build order. */
  stageEdges: ReadonlyArray<readonly [string, string]>
  /** Design-space bounding box of the staged block layout. */
  stageCanvas: { width: number; height: number }
}

/** The enterprise hero's own loop content - the parametrized loop's default. */
export const ENTERPRISE_LOOP_CONTENT: EnterpriseLoopContent = {
  workspaceName: 'Brightwave',
  greeting: ENTERPRISE_GREETING,
  placeholder: COMPOSER_PLACEHOLDER,
  prompt: ENTERPRISE_PROMPT,
  reply: ENTERPRISE_REPLY,
  sidebarChats: SIDEBAR_CHATS,
  sidebarWorkflows: SIDEBAR_WORKFLOWS,
  suggestedActions: SUGGESTED_ACTIONS,
  stageBlocks: ENTERPRISE_STAGE_BLOCKS,
  stageEdges: ENTERPRISE_STAGE_EDGES,
  stageCanvas: ENTERPRISE_STAGE_CANVAS,
}

/** The idle new-chat view holds this long before typing starts. */
const IDLE_HOLD_MS = 1400
/** Rest on the fully-typed prompt before "send". */
const TYPED_HOLD_MS = 700
/** Thinking runs alone this long before the stage pane slides open. */
const STAGE_OPEN_AFTER_MS = 900
/** First block lands this long after the pane opens. */
const BUILD_START_AFTER_MS = 500
/** Block N (build order) pops in at buildStart + N * BUILD_STEP_MS. */
export const BUILD_STEP_MS = 620
/** The reply starts streaming this long after the last block lands. */
const REPLY_AFTER_MS = 500
/** The finished scene (reply + built canvas) holds this long. */
const REPLY_HOLD_MS = 4800

/** Derived phase starts for one loop pass. */
export interface LoopTimeline {
  typing: number
  typed: number
  dispatch: number
  stageOpen: number
  buildStart: number
  reply: number
  total: number
}

/**
 * Derives the phase starts for a given loop content - the typing beat scales
 * with the prompt's length and the build window with the staged block count,
 * so every domain's pass keeps the enterprise pacing. Later stages (tables,
 * files, knowledge base, logs) slot in after `reply` by extending
 * {@link EnterpriseLoopPhase} and appending starts here.
 */
export function buildLoopTimeline(content: EnterpriseLoopContent): LoopTimeline {
  const typing = IDLE_HOLD_MS
  const typed = typing + content.prompt.length * PROMPT_CHAR_MS
  const dispatch = typed + TYPED_HOLD_MS
  const stageOpen = dispatch + STAGE_OPEN_AFTER_MS
  const buildStart = stageOpen + BUILD_START_AFTER_MS
  const reply = buildStart + (content.stageBlocks.length - 1) * BUILD_STEP_MS + REPLY_AFTER_MS
  const total = reply + REPLY_HOLD_MS
  return { typing, typed, dispatch, stageOpen, buildStart, reply, total }
}
