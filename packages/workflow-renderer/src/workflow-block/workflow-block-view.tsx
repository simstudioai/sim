import {
  type ComponentType,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Badge, ChipTag, cn, handleKeyboardActivation, Switch, Tooltip } from '@sim/emcn'
import { Ban, Lock } from '@sim/emcn/icons'
import {
  WORKFLOW_SOURCE_HANDLE_ID,
  WORKFLOW_TARGET_HANDLE_ID,
  type WorkflowConnectionSide,
} from '@sim/workflow-types/workflow'
import {
  Handle,
  Position,
  useStoreApi as useReactFlowStoreApi,
  useUpdateNodeInternals,
} from '@xyflow/react'
import { BLOCK_DIMENSIONS, HANDLE_POSITIONS } from '../dimensions'
import { humanizeBlockName } from '../lib/humanize-block-name'
import { OverflowSpan } from '../lib/overflow-span'
import { isLightTileColor } from '../lib/tile-icon-color'
import type { BlockRunStatus } from '../types'
import {
  getCursorBranchSourceHandleId,
  getCursorSourceHandleId,
  getCursorSourceHandlePosition,
} from './source-handle'
import { SubBlockRowView } from './sub-block-row-view'
import { useActionMenuSwell } from './use-action-menu-swell'
import {
  CONNECTION_KNOB_PEAK_PX,
  CURSOR_SWELL_LENGTH_PX,
  WorkflowBlockBorder,
  type WorkflowBorderCursorHandle,
  type WorkflowBorderPort,
} from './workflow-block-border'

const getHandleStyle = (position: 'horizontal' | 'vertical') => {
  if (position === 'horizontal') {
    return { top: '50%', transform: 'translateY(-50%)' }
  }
  return { left: '50%', transform: 'translateX(-50%)' }
}

/** Radial hit depth stays on the painted knob instead of covering card content. */
const HANDLE_HIT_CROSS_PX = CONNECTION_KNOB_PEAK_PX * 2
/** Along-edge hit span matches the primary connection knob's painted footprint. */
const MAIN_HANDLE_HIT_LENGTH_PX = 38
/** Card bottom → error-row centre: half the content padding + half the row. */
const TAB_LENGTH_PX = 36
const TAB_LENGTH_SMALL_PX = 24
const TAB_LENGTH_MIN_PX = 16
const TAB_LENGTH_HEADER_ONLY_PX = 10
/** The error knob is deliberately the shortest of the connection knobs — it is
 *  a secondary output, and a full-length tab crowds the card's bottom corner. */
const TAB_HEIGHT_RATIO = 0.5
const DEFAULT_TARGET_SIDE: WorkflowConnectionSide = 'left'
const DEFAULT_SOURCE_SIDE: WorkflowConnectionSide = 'right'
const CARD_CORNER_RADIUS_PX = 16
const CORNER_SLACK_PX = 4
const ACTION_MENU_RIGHT_INSET_PX = 24
const ACTION_MENU_MAX_WIDTH_PX = BLOCK_DIMENSIONS.FIXED_WIDTH - ACTION_MENU_RIGHT_INSET_PX * 2
const ACTION_MENU_AMPLITUDE = 7
/** Compile-time pin: the `-7px` handle outsets below must track the knob peak. */
const HANDLE_OUTSET_PX: typeof CONNECTION_KNOB_PEAK_PX = 7

interface BranchCursorRow {
  id: string
}

interface WorkflowCursorSourceHandle extends WorkflowBorderCursorHandle {
  handleId: string
}

/** Resolves a moving branch-card swell to the nearest visible branch row. */
export function getNearestBranchCursorHandleId(
  rows: BranchCursorRow[],
  cursorY: number,
  firstRowY: number,
  handlePrefix: 'condition' | 'router'
): string | null {
  if (rows.length === 0) return null

  const nearestIndex = Math.min(
    rows.length - 1,
    Math.max(0, Math.round((cursorY - firstRowY) / HANDLE_POSITIONS.CONDITION_ROW_HEIGHT))
  )
  return getCursorBranchSourceHandleId(`${handlePrefix}-${rows[nearestIndex].id}`)
}

const WORKFLOW_ROLE_ACCENTS = {
  agentic: { variant: 'workflow', tone: 'inverse' },
  interface: { variant: 'workflow', tone: 'blue' },
  logic: { variant: 'workflow', tone: 'orange' },
  state: { variant: 'workflow', tone: 'yellow' },
  flow: { variant: 'workflow', tone: 'ash' },
  records: { variant: 'workflow', tone: 'green' },
  identity: { variant: 'workflow', tone: 'identity' },
  neutral: { variant: 'workflow', tone: 'neutral' },
  generative: { variant: 'workflow', tone: 'purple' },
  knowledge: { variant: 'workflow', tone: 'content' },
} as const

export type WorkflowTypeRole = keyof typeof WORKFLOW_ROLE_ACCENTS

const WORKFLOW_TYPE_ROLES = {
  a2a: 'neutral',
  agent: 'agentic',
  api: 'interface',
  condition: 'logic',
  credential: 'state',
  credential_group: 'identity',
  deployments: 'neutral',
  enrichment: 'knowledge',
  evaluator: 'logic',
  file: 'knowledge',
  file_v2: 'knowledge',
  file_v3: 'knowledge',
  file_v4: 'knowledge',
  file_v5: 'knowledge',
  function: 'logic',
  generic_webhook: 'interface',
  guardrails: 'logic',
  human_in_the_loop: 'state',
  image_generator: 'generative',
  image_generator_v2: 'generative',
  imap: 'interface',
  knowledge: 'knowledge',
  logs: 'records',
  logs_v2: 'records',
  loop: 'flow',
  mcp: 'interface',
  memory: 'state',
  mothership: 'agentic',
  note: 'neutral',
  parallel: 'flow',
  pi: 'agentic',
  response: 'interface',
  router: 'flow',
  router_v2: 'flow',
  rss: 'knowledge',
  schedule: 'flow',
  search: 'knowledge',
  sim_workspace_event: 'interface',
  start_trigger: 'flow',
  starter: 'neutral',
  stt: 'generative',
  stt_v2: 'generative',
  table: 'records',
  table_v2: 'records',
  thinking: 'agentic',
  translate: 'generative',
  tts: 'generative',
  variables: 'state',
  video_generator: 'generative',
  video_generator_v2: 'generative',
  video_generator_v3: 'generative',
  vision: 'generative',
  vision_v2: 'generative',
  wait: 'flow',
  webhook_request: 'interface',
  workflow: 'interface',
  workflow_input: 'interface',
} as const satisfies Record<string, WorkflowTypeRole>

const DEFAULT_WORKFLOW_TYPE_ROLE: WorkflowTypeRole = 'neutral'

export const hasWorkflowTypeRole = (type: string): type is keyof typeof WORKFLOW_TYPE_ROLES =>
  Object.hasOwn(WORKFLOW_TYPE_ROLES, type)

export const getWorkflowTypeRole = (type: string): WorkflowTypeRole =>
  WORKFLOW_TYPE_ROLES[type as keyof typeof WORKFLOW_TYPE_ROLES] ?? DEFAULT_WORKFLOW_TYPE_ROLE

export const getWorkflowTypeAccent = (type: string) =>
  WORKFLOW_ROLE_ACCENTS[getWorkflowTypeRole(type)]

export interface WorkflowTypeIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  type: string
  Icon: ComponentType<{ className?: string }>
  /** Overrides the glyph size when the chip is rendered at a non-default slot. */
  iconClassName?: string
}

/** Shared compact core-block icon used by workflow discovery surfaces. */
export function WorkflowTypeIcon({
  type,
  Icon,
  className,
  iconClassName,
  ...props
}: WorkflowTypeIconProps) {
  const typeAccent = getWorkflowTypeAccent(type)

  return (
    <ChipTag
      variant={typeAccent.variant}
      tone={typeAccent.tone}
      className={cn('size-[16px] shrink-0 justify-center p-0', className)}
      data-workflow-type-icon={type}
      {...props}
    >
      <Icon
        className={cn(
          'size-[10px] transition-transform duration-100 group-hover:scale-110',
          iconClassName
        )}
      />
    </ChipTag>
  )
}

export interface WorkflowTypeTagProps {
  type: string
  typeLabel?: string
  Icon: ComponentType<{ className?: string }>
  iconBgColor: string
  isIntegration?: boolean
  isEnabled?: boolean
}

/** Shared provider/type tag used by editable and read-only workflow canvases. */
export function WorkflowTypeTag({
  type,
  typeLabel,
  Icon,
  iconBgColor,
  isIntegration = false,
  isEnabled = true,
}: WorkflowTypeTagProps) {
  const typeAccent = getWorkflowTypeAccent(type)
  const sharedClassName = cn(
    'shrink-0 justify-center transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
    !isEnabled && 'opacity-50'
  )
  /*
   * The tag names the block's kind, and it says so whether or not the title
   * happens to repeat it. Dropping the label when the two matched meant a card
   * changed shape the moment it was renamed — a freshly dropped Wait showed a
   * bare icon, its second copy showed "Wait" — so the tag read as a badge that
   * came and went rather than as one fixed part of the header.
   */
  const label = typeLabel || null

  if (isIntegration) {
    return (
      <ChipTag
        variant='brand'
        brandColor={iconBgColor}
        brandForeground={isLightTileColor(iconBgColor) ? 'dark' : 'light'}
        className={sharedClassName}
        data-workflow-type-accent={type}
        data-workflow-brand-tag=''
      >
        <Icon className='size-[14px] shrink-0' />
        {label}
      </ChipTag>
    )
  }

  return (
    <ChipTag
      variant={typeAccent.variant}
      tone={typeAccent.tone}
      className={sharedClassName}
      data-workflow-type-accent={type}
    >
      <Icon className='size-[14px] shrink-0' />
      {label}
    </ChipTag>
  )
}

interface BlockStateIndicatorProps {
  label: string
  Icon: ComponentType<{ className?: string }>
}

function BlockStateIndicator({ label, Icon }: BlockStateIndicatorProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <ChipTag
          variant='workflow'
          tone='neutral'
          className='size-5 shrink-0 justify-center p-0'
          aria-label={label}
        >
          <Icon className='size-[12px] shrink-0' />
        </ChipTag>
      </Tooltip.Trigger>
      <Tooltip.Content side='top'>
        <span className='text-sm'>{label}</span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

const clampTabLength = (length: number) =>
  Math.min(TAB_LENGTH_PX, Math.max(TAB_LENGTH_MIN_PX, Math.round(length)))

/**
 * The outsets below are the anchor every edge terminates at, and they must
 * equal the height each knob is painted at — otherwise the line stops short of
 * the knob (or overshoots past it). Tailwind only scans literal class strings,
 * so the value is spelled out here and pinned to the renderer's constant by the
 * assertion above.
 */
const getInvisibleHandleClasses = (side: 'left' | 'right' | 'top' | 'bottom') => {
  const offsetClasses = {
    right: 'right-[-7px]!',
    left: 'left-[-7px]!',
    top: 'top-[-7px]!',
    bottom: 'bottom-[-7px]!',
  } as const
  return cn(
    'z-20! cursor-crosshair! rounded-none! border-none! bg-transparent! opacity-0!',
    offsetClasses[side]
  )
}

/**
 * Hit area for a connection port. It follows the painted knob instead of the
 * broader edge-hover swell, keeping nearby card content draggable. Main ports
 * use the primary knob footprint; branch ports can fill their row lane so
 * adjacent targets meet without overlapping while the painted knobs stay
 * visually compact.
 */
const invisibleHandleSize = (
  side: 'left' | 'right' | 'top' | 'bottom',
  length: number,
  minLength = 0
) => {
  const span = Math.max(length, minLength)
  return side === 'top' || side === 'bottom'
    ? { width: span, height: HANDLE_HIT_CROSS_PX }
    : { width: HANDLE_HIT_CROSS_PX, height: span }
}

/** Error is the only persisted source that leaves from a vertical card edge. */
export const ERROR_SOURCE_HANDLE_POSITION = Position.Bottom

/** Keeps the Error hit target centered on the painted bottom-right knob. */
export const getErrorSourceHandleStyle = (): CSSProperties => ({
  right: 'auto',
  top: 'auto',
  bottom: -HANDLE_OUTSET_PX,
  left: `calc(100% - ${HANDLE_POSITIONS.ERROR_RIGHT_OFFSET}px)`,
  width: TAB_LENGTH_SMALL_PX,
  height: HANDLE_HIT_CROSS_PX,
  transform: 'translateX(-50%)',
})

/** Builds the fixed Error knob painted into the card's bottom edge. */
export const getErrorBorderPort = (color?: string): WorkflowBorderPort => ({
  id: 'error',
  side: 'bottom',
  position: { fromEnd: HANDLE_POSITIONS.ERROR_RIGHT_OFFSET },
  plateau: TAB_LENGTH_SMALL_PX,
  color,
})

/**
 * Props for the pure workflow-block renderer.
 *
 * Presentation comes from the editor (or docs) container: visual flags
 * (enabled/locked/pending/ring), handle topology (condition/router rows), and
 * the resolved badge state (child-deploy, schedule, webhook) are all computed
 * upstream and passed in. The block icon, content rows, and editor-only action
 * bar are injected as slots so the pure renderer carries no store, query, or
 * registry coupling.
 */
export interface WorkflowBlockViewProps {
  /** Block identity and visual state, resolved by the container. */
  id: string
  type: string
  name: string
  isPending?: boolean
  isEnabled: boolean
  isLocked: boolean
  hasRing: boolean
  ringStyles: string
  /** Resolved run-path outcome, drives the muted-name styling. */
  runPathStatus?: BlockRunStatus
  /** Whether execution controls are active for this block. */
  isRunning?: boolean
  /** Whether this block participates in the current execution handoff. */
  isExecutionHighlighted?: boolean
  /** Block icon component and its background color. */
  Icon: ComponentType<{ className?: string }>
  iconBgColor: string
  /** Whether the header tag should use the provider's integration colour. */
  isIntegration?: boolean

  /** Handle orientation and topology, resolved by the container. */
  horizontalHandles: boolean
  shouldShowDefaultHandles: boolean
  /**
   * Predicted card height in px, from the deterministic-dimensions pass.
   *
   * Scales the side connection tabs so a short card never wears a tab nearly
   * as tall as itself, and seeds the border's first paint so a card does not
   * flash a default-sized outline. It does NOT size the card — the card sizes
   * itself from its content and the border measures it — so a prediction that
   * runs long or short changes nothing but auto-layout's spacing. Omit it in
   * read-only contexts with no computed dimensions.
   */
  blockHeight?: number
  hasContentBelowHeader: boolean
  conditionRows: { id: string; title: string; value: string }[]
  routerRows: { id: string; value: string }[]
  /** Router 'Context' summary-row value (router_v2 only). */
  routerContextValue?: string
  /** Connection-cycle guard; reads fresh edge state on every call. */
  wouldCreateConnectionCycle: (source: string, target: string) => boolean
  /** Whether edge hover mounts an interactive React Flow source handle. */
  cursorConnectionsEnabled?: boolean

  /** Sunset badge — editor-only. `legacy` shows an amber "legacy" badge, `deprecated`
   * a red "deprecated" badge; clicking (gated on `canFixSunset`) invokes `onFixSunset`. */
  sunsetStatus?: 'legacy' | 'deprecated'
  sunsetTooltip?: string
  canFixSunset?: boolean
  onFixSunset?: () => void

  /** Child-workflow deploy badge state — editor-only; omit in read-only contexts. */
  isWorkflowSelector?: boolean
  childWorkflowId?: string
  childIsDeployed?: boolean | null
  childNeedsRedeploy?: boolean
  isDeploying?: boolean
  canAdmin?: boolean
  onDeployChild?: () => void

  /** Schedule badge state — editor-only; omit in read-only contexts. */
  shouldShowScheduleBadge?: boolean
  scheduleIsDisabled?: boolean
  onReactivateSchedule?: () => void

  /** Webhook badge state — editor-only; omit in read-only contexts. */
  showWebhookIndicator?: boolean
  webhookProvider?: string
  webhookPath?: string
  webhookProviderName?: string
  isWebhookConfigured?: boolean
  isWebhookDisabled?: boolean
  webhookId?: string
  onReactivateWebhook?: () => void

  /** Selects this block in the editor panel. */
  onSelect: () => void
  /** Ref attached to the inner content container. */
  contentRef?: Ref<HTMLDivElement>
  /** Editor-only action bar; omit in read-only / preview contexts. */
  actionBar?: ReactNode
  /**
   * Non-branch collapsed subblock summary rows, built by the container.
   * Condition/router/error rows are rendered by the view itself from
   * conditionRows/routerRows.
   */
  rows: ReactNode
  /**
   * Inline statement fragments rendered as one line above the rows (operation
   * · target). Built by the container; standard blocks only — condition/router
   * blocks render their branch rows instead.
   */
  chips?: ReactNode
  /**
   * Block-kind label (e.g. "Table", "Agent") shown as a ChipTag on the header
   * right. Hidden when it matches the block name to avoid duplication.
   */
  typeLabel?: string
  /**
   * Natural-language summary of what the block does, with inline value
   * chips. When present it replaces the statement line and field rows;
   * the error footer stays.
   *
   * Pass a {@link CanvasSentenceView}, which owns the paragraph and the
   * segment spacing so every surface renders the sentence identically.
   */
  sentence?: ReactNode
  /**
   * Whether a persisted legacy error route is wired from this block. Used
   * only to retain a non-interactive edge anchor for existing workflows.
   */
  hasErrorConnection?: boolean
  /** Whether this block's error output is switched on. */
  errorOutputEnabled?: boolean
  /** Toggles the error output from the card's error row. */
  onToggleErrorOutput?: (enabled: boolean) => void
  /**
   * Handle ids whose connected edge is currently highlighted (an endpoint
   * block is selected) — their tabs darken to match the edge color so the
   * line and its port read as one piece.
   */
  highlightedHandles?: ReadonlySet<string>
}

/**
 * Pure renderer for a workflow block: a header (icon, name, status badges), an
 * optional content section of collapsed subblock rows, and the full handle
 * topology (default/condition/router/error connection handles).
 */
export function WorkflowBlockView({
  id,
  type,
  name,
  isPending,
  isEnabled,
  isLocked,
  hasRing,
  ringStyles,
  runPathStatus,
  isRunning = false,
  isExecutionHighlighted = false,
  Icon,
  iconBgColor,
  isIntegration = false,
  shouldShowDefaultHandles,
  blockHeight,
  hasContentBelowHeader,
  conditionRows,
  routerRows,
  routerContextValue,
  wouldCreateConnectionCycle,
  cursorConnectionsEnabled = true,
  sunsetStatus,
  sunsetTooltip,
  canFixSunset,
  onFixSunset,
  isWorkflowSelector,
  childWorkflowId,
  childIsDeployed,
  childNeedsRedeploy,
  isDeploying,
  canAdmin,
  onDeployChild,
  shouldShowScheduleBadge,
  scheduleIsDisabled,
  onReactivateSchedule,
  showWebhookIndicator,
  webhookProvider,
  webhookPath,
  webhookProviderName,
  isWebhookConfigured,
  isWebhookDisabled,
  webhookId,
  onReactivateWebhook,
  onSelect,
  contentRef,
  actionBar,
  rows,
  chips,
  typeLabel,
  sentence,
  hasErrorConnection = false,
  errorOutputEnabled = false,
  onToggleErrorOutput,
  highlightedHandles,
}: WorkflowBlockViewProps) {
  const updateNodeInternals = useUpdateNodeInternals()
  const reactFlowStore = useReactFlowStoreApi()
  const getConnectionNodeId = useCallback(
    () => reactFlowStore.getState().connection.fromNode?.id ?? null,
    [reactFlowStore]
  )
  const supportsCursorSwell = type !== 'response'
  const supportsCursorHandle = supportsCursorSwell && cursorConnectionsEnabled
  const cursorSourceHandleRef = useRef<HTMLDivElement>(null)
  const cursorSourceHandleKeyRef = useRef<string | null>(null)
  const [cursorSourceHandle, setCursorSourceHandle] = useState<WorkflowCursorSourceHandle | null>(
    null
  )
  const onCursorHandleChange = useCallback(
    (nextHandle: WorkflowBorderCursorHandle | null) => {
      if (!supportsCursorHandle) return
      if (!nextHandle) {
        if (cursorSourceHandleKeyRef.current === null) return
        cursorSourceHandleKeyRef.current = null
        setCursorSourceHandle(null)
        return
      }

      const handleId =
        type === 'condition'
          ? getNearestBranchCursorHandleId(
              conditionRows,
              nextHandle.y,
              HANDLE_POSITIONS.CONDITION_START_Y,
              'condition'
            )
          : type === 'router_v2'
            ? getNearestBranchCursorHandleId(
                routerRows,
                nextHandle.y,
                HANDLE_POSITIONS.CONDITION_START_Y + HANDLE_POSITIONS.CONDITION_ROW_HEIGHT,
                'router'
              )
            : getCursorSourceHandleId(nextHandle.side)
      if (!handleId) return

      const handleElement = cursorSourceHandleRef.current
      if (handleElement) {
        handleElement.style.left = `${nextHandle.x}px`
        handleElement.style.top = `${nextHandle.y}px`
      }
      const nextKey = `${handleId}:${nextHandle.edgeSide}`
      if (cursorSourceHandleKeyRef.current !== nextKey) {
        cursorSourceHandleKeyRef.current = nextKey
        setCursorSourceHandle({ ...nextHandle, handleId })
      }
    },
    [conditionRows, routerRows, supportsCursorHandle, type]
  )
  /**
   * Keeps React Flow's cached origin aligned with the transient DOM handle
   * without remeasuring the node or publishing a canvas-wide store update.
   */
  const syncCursorSourceHandleBounds = useCallback(() => {
    const handleElement = cursorSourceHandleRef.current
    const nodeElement = handleElement?.closest<HTMLDivElement>('.react-flow__node') ?? null
    if (!handleElement || !nodeElement) return

    const state = reactFlowStore.getState()
    const sourceBounds = state.nodeLookup.get(id)?.internals.handleBounds?.source
    const handleId = handleElement.dataset.handleid
    const handlePosition = handleElement.dataset.handlepos as Position | undefined
    const zoom = state.transform[2]
    if (!sourceBounds || !handleId || !handlePosition || zoom <= 0) return

    const nodeBounds = nodeElement.getBoundingClientRect()
    const handleBounds = handleElement.getBoundingClientRect()
    const [originX, originY] = state.nodeOrigin
    const nextBounds = {
      id: handleId,
      nodeId: id,
      type: 'source' as const,
      position: handlePosition,
      x: (handleBounds.left - nodeBounds.left - nodeBounds.width * originX) / zoom,
      y: (handleBounds.top - nodeBounds.top - nodeBounds.height * originY) / zoom,
      width: handleElement.offsetWidth,
      height: handleElement.offsetHeight,
    }
    const currentBounds = sourceBounds.find((bounds) => bounds.id === handleId)
    if (currentBounds) {
      Object.assign(currentBounds, nextBounds)
      return
    }
    sourceBounds.push(nextBounds)
  }, [id, reactFlowStore])
  const isNodeSelected = hasRing && ringStyles.includes('--text-secondary')
  /* Treatment only — the silhouette and `data-node-selected`. Whether the
     action menu is pinned open is a separate question, answered by
     `isNodeSelected` alone below. */
  const usesSelectedVisuals = isNodeSelected || isExecutionHighlighted
  const showActionMenu = Boolean(actionBar)
  const {
    rootRef: actionMenuRootRef,
    hostRef: actionMenuHostRef,
    width: actionMenuWidth,
    swellOpen: actionMenuSwellOpen,
    contentVisible: actionMenuContentVisible,
    setReady: setActionMenuSwellReady,
    onFocusCapture: handleActionMenuFocus,
    onBlurCapture: handleActionMenuBlur,
  } = useActionMenuSwell({
    enabled: showActionMenu,
    /*
     * A run pins the executing card's bar open — not every card's. Pinning them
     * all turned the canvas into a wall of open swells, and suspending their
     * hover on top of it made the "hover a non-running card" treatment below
     * unreachable, so those cards could neither retract nor respond. The block
     * that is actually running keeps both.
     */
    /*
     * `isNodeSelected`, not `usesSelectedVisuals`: a block in the handoff into
     * the running one takes the selected TREATMENT — graphite silhouette, so the
     * eye can follow the baton — but that is not a reason to pin its toolbar
     * open. Including it left the upstream card's bar down permanently through a
     * run, which is the wall-of-open-swells this was supposed to end.
     */
    forceOpen: Boolean(isNodeSelected || isRunning),
    maxWidth: ACTION_MENU_MAX_WIDTH_PX,
    suspendInteraction: isRunning,
  })
  /* Blocks that can emit an error always carry the row; `response` terminates
     the flow and has no error branch. */
  const showErrorRow = shouldShowDefaultHandles && type !== 'response'
  /*
   * The error output is a real, draggable source whenever the toggle is on (a
   * connection forces the toggle on, so connected cards always have it). It
   * doubles as the edge anchor for existing error connections.
   */
  const rendersErrorHandle = showErrorRow && (errorOutputEnabled || hasErrorConnection)
  useEffect(() => {
    if (supportsCursorHandle) return
    cursorSourceHandleKeyRef.current = null
    setCursorSourceHandle(null)
  }, [supportsCursorHandle])
  useLayoutEffect(() => {
    updateNodeInternals(id)
  }, [
    cursorSourceHandle?.handleId,
    cursorSourceHandle?.side,
    id,
    /* The error handle mounts with the toggle; without a refresh React Flow
       keeps stale handleBounds and drops the edge (error 008) until something
       else re-measures the node. */
    rendersErrorHandle,
    updateNodeInternals,
  ])
  const tabFill = (handleId: string) =>
    highlightedHandles?.has(handleId) ? 'var(--text-secondary)' : undefined

  /* Side tabs scale with the card: half the card height, clamped to 16-36px,
     so both default ports on a two-port card stay identical while a
     header-only card gets a proportionally short tab. A second cap keeps the
     bulge junctions on the straight border segment, clear of the rounded
     corners where the outline curves away from the tab's wall. Header-only
     trigger cards do not always expose a computed height, so their fallback
     stays at the minimum. */
  const sideTabLength = !hasContentBelowHeader
    ? TAB_LENGTH_HEADER_ONLY_PX
    : blockHeight && blockHeight > 0
      ? clampTabLength(
          Math.min(
            blockHeight * TAB_HEIGHT_RATIO,
            blockHeight - 2 * (CARD_CORNER_RADIUS_PX - CORNER_SLACK_PX)
          )
        )
      : TAB_LENGTH_MIN_PX
  const mainTabLength = (side: 'left' | 'right' | 'top' | 'bottom') =>
    side === 'top' || side === 'bottom' ? TAB_LENGTH_PX : sideTabLength

  /* Per-row branch ports shrink as rows multiply (24px for two rows, -2px per
     extra row, floored at 16px) so a long stack keeps air between the bumps
     within the fixed 29px row pitch. */
  const branchRowCount = type === 'condition' ? conditionRows.length : routerRows.length
  const rowTabLength = clampTabLength(
    branchRowCount <= 2 ? TAB_LENGTH_SMALL_PX : TAB_LENGTH_SMALL_PX - (branchRowCount - 2) * 2
  )
  const borderPorts = useMemo<WorkflowBorderPort[]>(() => {
    const ports: WorkflowBorderPort[] = []
    if (shouldShowDefaultHandles) {
      ports.push({
        id: WORKFLOW_TARGET_HANDLE_ID,
        side: DEFAULT_TARGET_SIDE,
        position: 'center',
        plateau: mainTabLength(DEFAULT_TARGET_SIDE),
        color: tabFill(WORKFLOW_TARGET_HANDLE_ID),
      })
    }
    if (type === 'condition') {
      conditionRows.forEach((condition, index) => {
        ports.push({
          id: `condition-${condition.id}`,
          side: 'right',
          position:
            HANDLE_POSITIONS.CONDITION_START_Y + index * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT,
          plateau: rowTabLength,
          color: tabFill(`condition-${condition.id}`),
        })
      })
    } else if (type === 'router_v2') {
      routerRows.forEach((route, index) => {
        ports.push({
          id: `router-${route.id}`,
          side: 'right',
          position:
            HANDLE_POSITIONS.CONDITION_START_Y +
            (index + 1) * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT,
          plateau: rowTabLength,
          color: tabFill(`router-${route.id}`),
        })
      })
    } else if (type !== 'response') {
      ports.push({
        id: WORKFLOW_SOURCE_HANDLE_ID,
        side: DEFAULT_SOURCE_SIDE,
        position: 'center',
        plateau: mainTabLength(DEFAULT_SOURCE_SIDE),
        color: tabFill(WORKFLOW_SOURCE_HANDLE_ID),
      })
    }
    if (showErrorRow && errorOutputEnabled) {
      ports.push(getErrorBorderPort(tabFill('error')))
    }
    if (showActionMenu) {
      ports.push({
        id: 'action-menu',
        side: 'top',
        position: { fromEnd: ACTION_MENU_RIGHT_INSET_PX + actionMenuWidth / 2 },
        plateau: actionMenuWidth,
        restAmplitude: actionMenuSwellOpen ? ACTION_MENU_AMPLITUDE : 0,
        hoverAmplitude: ACTION_MENU_AMPLITUDE,
        magnetizable: false,
      })
    }
    return ports
  }, [
    conditionRows,
    actionMenuSwellOpen,
    actionMenuWidth,
    highlightedHandles,
    routerRows,
    rowTabLength,
    shouldShowDefaultHandles,
    showActionMenu,
    showErrorRow,
    errorOutputEnabled,
    sideTabLength,
    type,
  ])

  return (
    <div
      ref={actionMenuRootRef}
      className='group relative'
      data-action-menu-ready={actionMenuContentVisible ? '' : undefined}
      /* Single source of truth for "the swell is painted in the selection
         color" — the action bar keys its icon treatment off this instead of
         React Flow's raw `selected`. */
      data-node-selected={usesSelectedVisuals ? '' : undefined}
      data-execution-highlighted={isExecutionHighlighted ? '' : undefined}
    >
      {showActionMenu && (
        <>
          <div
            aria-hidden='true'
            data-workflow-action-bar-bridge=''
            className='-top-[28px] pointer-events-auto absolute inset-x-0 z-10 h-[28px]'
          />
          <div
            ref={actionMenuHostRef}
            onFocusCapture={handleActionMenuFocus}
            onBlurCapture={handleActionMenuBlur}
          >
            {actionBar}
          </div>
        </>
      )}
      <div
        ref={contentRef}
        role='button'
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => handleKeyboardActivation(event, onSelect)}
        className={cn(
          'workflow-drag-handle relative z-[20] w-[250px] cursor-grab select-none rounded-2xl [&:active]:cursor-grabbing'
        )}
        /* The card is sized by its own content, floored at the shortest
           silhouette the border can paint — below that the perimeter has no
           straight run left, the action-menu tab squashes into the corner arcs
           and its icons spill onto the card.
           Deliberately NOT floored at `blockHeight`: that is a prediction of
           this height for auto-layout, and padding the card up to it left a
           band of dead space under the last row whenever the prediction ran
           long, which it does for any card the estimate cannot model exactly. */
        style={{ minHeight: BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT }}
      >
        <WorkflowBlockBorder
          nodeId={id}
          getConnectionNodeId={getConnectionNodeId}
          ports={borderPorts}
          hasRing={hasRing || isExecutionHighlighted}
          ringStyles={
            isExecutionHighlighted ? 'ring-[1.5px] ring-[var(--text-secondary)]' : ringStyles
          }
          isSelected={usesSelectedVisuals}
          height={blockHeight}
          canStartConnection={supportsCursorSwell}
          canReceiveConnection={shouldShowDefaultHandles}
          onCursorHandleChange={supportsCursorHandle ? onCursorHandleChange : undefined}
          onActionMenuReadyChange={setActionMenuSwellReady}
        />
        {cursorSourceHandle && (
          <Handle
            ref={cursorSourceHandleRef}
            type='source'
            position={getCursorSourceHandlePosition(cursorSourceHandle.edgeSide)}
            id={cursorSourceHandle.handleId}
            className='z-50! cursor-crosshair! rounded-none! border-none! bg-transparent! opacity-0!'
            style={{
              right: 'auto',
              bottom: 'auto',
              left: cursorSourceHandle.x,
              top: cursorSourceHandle.y,
              transform: 'translate(-50%, -50%)',
              ...invisibleHandleSize(cursorSourceHandle.edgeSide, CURSOR_SWELL_LENGTH_PX),
            }}
            data-nodeid={id}
            data-handleid={cursorSourceHandle.handleId}
            isConnectableStart={true}
            isConnectableEnd={false}
            onPointerDownCapture={syncCursorSourceHandleBounds}
            isValidConnection={(connection) => {
              if (connection.target === id) return false
              return !wouldCreateConnectionCycle(connection.source!, connection.target!)
            }}
          />
        )}
        {isPending && (
          <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 rounded-t-md bg-amber-500 px-2 py-0.5 text-white text-xs'>
            Next Step
          </div>
        )}

        {shouldShowDefaultHandles && (
          <Handle
            type='target'
            position={Position.Left}
            id={WORKFLOW_TARGET_HANDLE_ID}
            className={getInvisibleHandleClasses('left')}
            style={{
              ...getHandleStyle('horizontal'),
              ...invisibleHandleSize('left', mainTabLength('left'), MAIN_HANDLE_HIT_LENGTH_PX),
            }}
            data-nodeid={id}
            data-handleid={WORKFLOW_TARGET_HANDLE_ID}
            isConnectableStart={false}
            isConnectableEnd={true}
            isValidConnection={(connection) => {
              if (connection.source === id) return false
              return !wouldCreateConnectionCycle(connection.source!, connection.target!)
            }}
          />
        )}

        <div
          className={cn(
            'flex items-center justify-between px-2',
            hasContentBelowHeader && 'h-[40px]'
          )}
          /* A header-only card is nothing but this row, so it carries the
             card's floor itself and `items-center` centres the title and type
             tag against the painted silhouette. */
          style={
            !hasContentBelowHeader ? { height: BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT } : undefined
          }
        >
          <div
            className={cn(
              'relative z-10 flex min-w-0 flex-1 items-center transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
              !isEnabled && 'opacity-50'
            )}
          >
            <OverflowSpan
              value={humanizeBlockName(name)}
              className={cn(
                'text-[17px]',
                !isEnabled && runPathStatus !== 'success' && 'text-[var(--text-muted)]'
              )}
            />
          </div>
          <div className='relative z-10 flex shrink-0 items-center gap-1'>
            {!isEnabled && <BlockStateIndicator label='Disabled' Icon={Ban} />}
            {isLocked && <BlockStateIndicator label='Locked' Icon={Lock} />}
            <WorkflowTypeTag
              type={type}
              typeLabel={typeLabel}
              Icon={Icon}
              iconBgColor={iconBgColor}
              isIntegration={isIntegration}
              isEnabled={isEnabled}
            />
            {sunsetStatus && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant={sunsetStatus === 'deprecated' ? 'red' : 'amber'}
                    className={canFixSunset ? 'cursor-pointer' : 'cursor-not-allowed'}
                    dot
                    role={canFixSunset ? 'button' : undefined}
                    tabIndex={canFixSunset ? 0 : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (canFixSunset) onFixSunset?.()
                    }}
                    onKeyDown={
                      canFixSunset
                        ? (e) => {
                            e.stopPropagation()
                            handleKeyboardActivation(e, () => onFixSunset?.())
                          }
                        : undefined
                    }
                  >
                    {sunsetStatus}
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className='text-sm'>
                    {canFixSunset ? sunsetTooltip : 'Edit access required to fix'}
                  </span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {isWorkflowSelector &&
              childWorkflowId &&
              typeof childIsDeployed === 'boolean' &&
              (!childIsDeployed || childNeedsRedeploy) && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Badge
                      variant={!childIsDeployed ? 'red' : 'amber'}
                      className={canAdmin ? 'cursor-pointer' : 'cursor-not-allowed'}
                      dot
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeployChild?.()
                      }}
                    >
                      {isDeploying ? 'Deploying...' : !childIsDeployed ? 'undeployed' : 'redeploy'}
                    </Badge>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <span className='text-sm'>
                      {!canAdmin
                        ? 'Admin permission required to deploy'
                        : !childIsDeployed
                          ? 'Click to deploy'
                          : 'Click to redeploy'}
                    </span>
                  </Tooltip.Content>
                </Tooltip.Root>
              )}
            {type === 'schedule' && shouldShowScheduleBadge && scheduleIsDisabled && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='amber'
                    className='cursor-pointer'
                    dot
                    onClick={(e) => {
                      e.stopPropagation()
                      onReactivateSchedule?.()
                    }}
                  >
                    disabled
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className='text-sm'>Click to reactivate</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {showWebhookIndicator && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge variant='orange' dot>
                    Webhook
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='max-w-[300px]'>
                  {webhookProvider && webhookPath ? (
                    <>
                      <p className='text-sm'>{webhookProviderName} Webhook</p>
                      <p className='mt-1 text-muted-foreground text-xs'>Path: {webhookPath}</p>
                    </>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      This workflow is triggered by a webhook.
                    </p>
                  )}
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {isWebhookConfigured && isWebhookDisabled && webhookId && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant='amber'
                    className='cursor-pointer'
                    dot
                    onClick={(e) => {
                      e.stopPropagation()
                      onReactivateWebhook?.()
                    }}
                  >
                    disabled
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span className='text-sm'>Click to reactivate</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {/* {isActive && (
              <div className='mr-0.5 ml-2 flex size-[16px] items-center justify-center'>
                <div
                  className='h-full w-full animate-spin-slow rounded-full border-[2.5px] border-[rgba(255,102,0,0.25)] border-t-[var(--warning)]'
                  aria-hidden='true'
                />
              </div>
            )} */}
          </div>
        </div>

        {hasContentBelowHeader && (
          <div
            className={cn(
              'relative z-10 flex flex-col gap-2 p-2 transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
              !isEnabled && 'opacity-50'
            )}
          >
            {type === 'condition' ? (
              conditionRows.map((cond) => (
                <SubBlockRowView key={cond.id} title={cond.title} displayValue={cond.value} />
              ))
            ) : type === 'router_v2' ? (
              <>
                <SubBlockRowView key='context' title='Context' displayValue={routerContextValue} />
                {routerRows.map((route, index) => (
                  <SubBlockRowView
                    key={route.id}
                    title={`Route ${index + 1}`}
                    displayValue={route.value}
                  />
                ))}
              </>
            ) : sentence ? (
              sentence
            ) : (
              <>
                {chips && (
                  <div className='flex min-w-0 items-center gap-1.5 overflow-hidden'>{chips}</div>
                )}
                {rows}
              </>
            )}
            {showErrorRow && (
              <div
                className='flex h-[24px] shrink-0 items-center justify-between rounded-[6px] bg-[var(--surface-5)] pr-1 pl-2 dark:bg-[var(--surface-4)]'
                /* The card is a drag handle and the row holds a control, so the
                   pointer must not start a node drag here. */
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <span className='text-[var(--text-muted)] text-caption'>On error</span>
                <Switch
                  checked={errorOutputEnabled}
                  onCheckedChange={(next) => onToggleErrorOutput?.(next)}
                  aria-label='On error branch'
                  disabled={!onToggleErrorOutput}
                  className='scale-[0.72]'
                />
              </div>
            )}
          </div>
        )}

        {type === 'condition' && (
          <>
            {conditionRows.map((cond, condIndex) => {
              const topOffset =
                HANDLE_POSITIONS.CONDITION_START_Y +
                condIndex * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
              return (
                <Handle
                  key={`handle-${cond.id}`}
                  type='source'
                  position={Position.Right}
                  id={`condition-${cond.id}`}
                  className={getInvisibleHandleClasses('right')}
                  style={{
                    top: `${topOffset}px`,
                    transform: 'translateY(-50%)',
                    ...invisibleHandleSize(
                      'right',
                      rowTabLength,
                      HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
                    ),
                  }}
                  data-nodeid={id}
                  data-handleid={`condition-${cond.id}`}
                  isConnectableStart={true}
                  isConnectableEnd={false}
                  isValidConnection={(connection) => {
                    if (connection.target === id) return false
                    return !wouldCreateConnectionCycle(connection.source!, connection.target!)
                  }}
                />
              )
            })}
          </>
        )}

        {type === 'router_v2' && (
          <>
            {routerRows.map((route, routeIndex) => {
              // +1 row offset for context row at the top
              const topOffset =
                HANDLE_POSITIONS.CONDITION_START_Y +
                (routeIndex + 1) * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
              return (
                <Handle
                  key={`handle-${route.id}`}
                  type='source'
                  position={Position.Right}
                  id={`router-${route.id}`}
                  className={getInvisibleHandleClasses('right')}
                  style={{
                    top: `${topOffset}px`,
                    transform: 'translateY(-50%)',
                    ...invisibleHandleSize(
                      'right',
                      rowTabLength,
                      HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
                    ),
                  }}
                  data-nodeid={id}
                  data-handleid={`router-${route.id}`}
                  isConnectableStart={true}
                  isConnectableEnd={false}
                  isValidConnection={(connection) => {
                    if (connection.target === id) return false
                    return !wouldCreateConnectionCycle(connection.source!, connection.target!)
                  }}
                />
              )
            })}
          </>
        )}

        {type !== 'condition' && type !== 'router_v2' && type !== 'response' && (
          <Handle
            type='source'
            position={Position.Right}
            id={WORKFLOW_SOURCE_HANDLE_ID}
            className={getInvisibleHandleClasses('right')}
            style={{
              ...getHandleStyle('horizontal'),
              ...invisibleHandleSize('right', mainTabLength('right'), MAIN_HANDLE_HIT_LENGTH_PX),
            }}
            data-nodeid={id}
            data-handleid={WORKFLOW_SOURCE_HANDLE_ID}
            isConnectableStart={true}
            isConnectableEnd={false}
            isValidConnection={(connection) => {
              if (connection.target === id) return false
              return !wouldCreateConnectionCycle(connection.source!, connection.target!)
            }}
          />
        )}

        {rendersErrorHandle && (
          <Handle
            type='source'
            position={ERROR_SOURCE_HANDLE_POSITION}
            id='error'
            className='z-20! cursor-crosshair! rounded-none! border-none! bg-transparent! opacity-0!'
            style={getErrorSourceHandleStyle()}
            data-nodeid={id}
            data-handleid='error'
            isConnectableStart={true}
            isConnectableEnd={false}
            isValidConnection={(connection) => {
              if (connection.target === id) return false
              return !wouldCreateConnectionCycle(connection.source!, connection.target!)
            }}
          />
        )}
      </div>
    </div>
  )
}
