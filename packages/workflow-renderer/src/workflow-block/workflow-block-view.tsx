import {
  type ComponentType,
  type CSSProperties,
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
import {
  getPositionedSourceHandleId,
  getPositionedTargetHandleId,
  POSITIONED_SOURCE_HANDLE_SIDES,
  type PositionedSourceHandleSide,
} from '@sim/workflow-types/workflow'
import {
  Handle,
  internalsSymbol,
  Position,
  useStoreApi as useReactFlowStoreApi,
  useUpdateNodeInternals,
} from 'reactflow'
import { BLOCK_DIMENSIONS, HANDLE_POSITIONS } from '../dimensions'
import { humanizeBlockName } from '../lib/humanize-block-name'
import { OverflowSpan } from '../lib/overflow-span'
import type { BlockRunStatus } from '../types'
import {
  getCursorBranchSourceHandleId,
  getCursorSourceHandleId,
  getCursorSourceHandlePosition,
} from './source-handle'
import { SubBlockRowView } from './sub-block-row-view'
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
const CARD_CORNER_RADIUS_PX = 16
const CORNER_SLACK_PX = 4
const ACTION_MENU_FALLBACK_WIDTH_PX = 132
const ACTION_MENU_RIGHT_INSET_PX = 24
const ACTION_MENU_MAX_WIDTH_PX = BLOCK_DIMENSIONS.FIXED_WIDTH - ACTION_MENU_RIGHT_INSET_PX * 2
const ACTION_MENU_AMPLITUDE = 7
/** Hold the gray swell open briefly on close so icons can fade out first. */
const ACTION_MENU_CLOSE_RETRACT_DELAY_MS = 40
/** Ignore brief pointer exits (edges, handles) so hover doesn't flicker closed. */
const ACTION_MENU_HOVER_LEAVE_DELAY_MS = 100
/** Extra hit area above the card for the action swell. */
const ACTION_MENU_HOVER_TOP_PAD_PX = 28
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

const WORKFLOW_TYPE_ACCENTS = {
  agent: { variant: 'workflow', tone: 'inverse' },
  api: { variant: 'workflow', tone: 'indigo' },
  condition: { variant: 'workflow', tone: 'violet' },
  credential: { variant: 'workflow', tone: 'amber' },
  file: { variant: 'workflow', tone: 'indigo' },
  file_v5: { variant: 'workflow', tone: 'indigo' },
  function: { variant: 'workflow', tone: 'violet' },
  router_v2: { variant: 'workflow', tone: 'indigoStrong' },
  table: { variant: 'workflow', tone: 'teal' },
} as const

const DEFAULT_WORKFLOW_TYPE_ACCENT = { variant: 'workflow', tone: 'neutral' } as const

export const getWorkflowTypeAccent = (type: string) =>
  WORKFLOW_TYPE_ACCENTS[type as keyof typeof WORKFLOW_TYPE_ACCENTS] ?? DEFAULT_WORKFLOW_TYPE_ACCENT

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
    right: '!right-[-7px]',
    left: '!left-[-7px]',
    top: '!top-[-7px]',
    bottom: '!bottom-[-7px]',
  } as const
  return cn(
    '!z-20 !cursor-crosshair !rounded-none !border-none !bg-transparent !opacity-0',
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

const getReactFlowPosition = (side: PositionedSourceHandleSide) => {
  return side === 'left' ? Position.Left : Position.Right
}

const getCenteredSideHandleStyle = (side: PositionedSourceHandleSide): CSSProperties => {
  const style: CSSProperties = {
    right: 'auto',
    bottom: 'auto',
    width: 1,
    height: 1,
  }
  if (side === 'right') {
    return { ...style, top: '50%', left: '100%', transform: 'translate(-50%, -50%)' }
  }
  return { ...style, top: '50%', left: 0, transform: 'translate(-50%, -50%)' }
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
  /** Block icon component and its background color. */
  Icon: ComponentType<{ className?: string }>
  iconBgColor: string

  /** Handle orientation and topology, resolved by the container. */
  horizontalHandles: boolean
  shouldShowDefaultHandles: boolean
  /**
   * Deterministic card height in px, used to scale the side connection tabs
   * so a short card never wears a tab nearly as tall as itself. Omit to keep
   * the full-size tabs (read-only contexts without computed dimensions).
   */
  blockHeight?: number
  hasContentBelowHeader: boolean
  conditionRows: { id: string; title: string; value: string }[]
  routerRows: { id: string; value: string }[]
  /** Router 'Context' summary-row value (router_v2 only). */
  routerContextValue?: string
  /** Connection-cycle guard; reads fresh edge state on every call. */
  wouldCreateConnectionCycle: (source: string, target: string) => boolean

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
  /** Side-specific source handles currently used by persisted edges. */
  connectedSourceHandles?: ReadonlySet<string>
  /** Side-specific target handles currently used by persisted edges. */
  connectedTargetHandles?: ReadonlySet<string>
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
  Icon,
  iconBgColor,
  shouldShowDefaultHandles,
  blockHeight,
  hasContentBelowHeader,
  conditionRows,
  routerRows,
  routerContextValue,
  wouldCreateConnectionCycle,
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
  connectedSourceHandles,
  connectedTargetHandles,
}: WorkflowBlockViewProps) {
  const updateNodeInternals = useUpdateNodeInternals()
  const reactFlowStore = useReactFlowStoreApi()
  const getConnectionNodeId = useCallback(
    () => reactFlowStore.getState().connectionNodeId,
    [reactFlowStore]
  )
  const supportsPositionedHandles =
    type !== 'condition' && type !== 'router_v2' && type !== 'response'
  const supportsCursorHandle = type !== 'response'
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
    const sourceBounds = state.nodeInternals.get(id)?.[internalsSymbol]?.handleBounds?.source
    const handleId = handleElement.dataset.handleid
    const handlePosition = handleElement.dataset.handlepos as Position | undefined
    const zoom = state.transform[2]
    if (!sourceBounds || !handleId || !handlePosition || zoom <= 0) return

    const nodeBounds = nodeElement.getBoundingClientRect()
    const handleBounds = handleElement.getBoundingClientRect()
    const [originX, originY] = state.nodeOrigin
    const nextBounds = {
      id: handleId,
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
  const [actionMenuFocused, setActionMenuFocused] = useState(false)
  const [actionMenuHovered, setActionMenuHovered] = useState(false)
  const actionMenuRootRef = useRef<HTMLDivElement>(null)
  const actionMenuHostRef = useRef<HTMLDivElement>(null)
  const actionMenuHoverLeaveTimeoutRef = useRef<number | null>(null)
  const actionMenuHoverMoveRef = useRef<((event: PointerEvent) => void) | null>(null)
  const [actionMenuWidth, setActionMenuWidth] = useState(ACTION_MENU_FALLBACK_WIDTH_PX)
  const [actionMenuSwellReady, setActionMenuSwellReady] = useState(false)
  const isNodeSelected = hasRing && ringStyles.includes('--text-secondary')
  const keepActionMenuOpen = actionMenuFocused || actionMenuHovered || isNodeSelected
  const actionMenuContentVisible = keepActionMenuOpen && actionMenuSwellReady
  const [actionMenuSwellOpen, setActionMenuSwellOpen] = useState(keepActionMenuOpen)
  const showActionMenu = Boolean(actionBar)
  const typeAccent = getWorkflowTypeAccent(type)

  useEffect(() => {
    if (keepActionMenuOpen) {
      setActionMenuSwellOpen(true)
      return
    }
    const timeoutId = window.setTimeout(() => {
      setActionMenuSwellOpen(false)
    }, ACTION_MENU_CLOSE_RETRACT_DELAY_MS)
    return () => window.clearTimeout(timeoutId)
  }, [keepActionMenuOpen])

  useEffect(() => {
    if (!showActionMenu) return

    const clearHoverLeave = () => {
      if (actionMenuHoverLeaveTimeoutRef.current !== null) {
        window.clearTimeout(actionMenuHoverLeaveTimeoutRef.current)
        actionMenuHoverLeaveTimeoutRef.current = null
      }
      if (actionMenuHoverMoveRef.current) {
        window.removeEventListener('pointermove', actionMenuHoverMoveRef.current)
        actionMenuHoverMoveRef.current = null
      }
    }

    const isPointerOverActionMenu = (event: PointerEvent) => {
      const root = actionMenuRootRef.current
      if (!root) return false
      const rect = root.getBoundingClientRect()
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top - ACTION_MENU_HOVER_TOP_PAD_PX &&
        event.clientY <= rect.bottom
      )
    }

    const openActionMenuHover = () => {
      clearHoverLeave()
      setActionMenuHovered(true)
      setActionMenuSwellOpen(true)
    }

    const scheduleActionMenuHoverLeave = () => {
      if (actionMenuHoverLeaveTimeoutRef.current !== null) {
        window.clearTimeout(actionMenuHoverLeaveTimeoutRef.current)
      }
      if (!actionMenuHoverMoveRef.current) {
        const onMove = (event: PointerEvent) => {
          if (isPointerOverActionMenu(event)) {
            openActionMenuHover()
          }
        }
        actionMenuHoverMoveRef.current = onMove
        window.addEventListener('pointermove', onMove, { passive: true })
      }
      actionMenuHoverLeaveTimeoutRef.current = window.setTimeout(() => {
        actionMenuHoverLeaveTimeoutRef.current = null
        if (actionMenuHoverMoveRef.current) {
          window.removeEventListener('pointermove', actionMenuHoverMoveRef.current)
          actionMenuHoverMoveRef.current = null
        }
        setActionMenuHovered(false)
      }, ACTION_MENU_HOVER_LEAVE_DELAY_MS)
    }

    // Bind to the React Flow node wrapper so edges/handles that sit above the
    // card don't permanently steal hover from the swell.
    const root = actionMenuRootRef.current
    const nodeEl = root?.closest('.react-flow__node') ?? root
    if (!nodeEl) return

    const onEnter = () => openActionMenuHover()
    const onLeave = () => scheduleActionMenuHoverLeave()
    nodeEl.addEventListener('pointerenter', onEnter)
    nodeEl.addEventListener('pointerleave', onLeave)

    return () => {
      clearHoverLeave()
      nodeEl.removeEventListener('pointerenter', onEnter)
      nodeEl.removeEventListener('pointerleave', onLeave)
    }
  }, [showActionMenu])
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
  useLayoutEffect(() => {
    const actionMenu = actionMenuHostRef.current?.querySelector<HTMLElement>(
      '[data-workflow-action-bar-swell]'
    )
    if (!actionMenu) return
    const updateWidth = () => {
      const nextWidth = Math.min(ACTION_MENU_MAX_WIDTH_PX, actionMenu.offsetWidth)
      if (nextWidth <= 0) return
      setActionMenuWidth((current) => (current === nextWidth ? current : nextWidth))
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(actionMenu)
    return () => observer.disconnect()
  }, [showActionMenu])
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
  const defaultTargetSide: PositionedSourceHandleSide = 'left'
  const defaultSourceSide: PositionedSourceHandleSide = 'right'
  const borderPorts = useMemo<WorkflowBorderPort[]>(() => {
    const ports: WorkflowBorderPort[] = []
    if (shouldShowDefaultHandles) {
      ports.push({
        id: 'target',
        side: defaultTargetSide,
        position: 'center',
        plateau: mainTabLength(defaultTargetSide),
        color:
          tabFill('target') ??
          tabFill(getPositionedSourceHandleId(defaultTargetSide)) ??
          tabFill(getPositionedTargetHandleId(defaultTargetSide)),
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
        id: 'source',
        side: defaultSourceSide,
        position: 'center',
        plateau: mainTabLength(defaultSourceSide),
        color:
          tabFill('source') ??
          tabFill(getPositionedSourceHandleId(defaultSourceSide)) ??
          tabFill(getPositionedTargetHandleId(defaultSourceSide)),
      })
    }
    if (supportsPositionedHandles) {
      for (const side of POSITIONED_SOURCE_HANDLE_SIDES) {
        const handleId = getPositionedSourceHandleId(side)
        const sharesDefaultPort =
          side === defaultSourceSide || (shouldShowDefaultHandles && side === defaultTargetSide)
        if (!connectedSourceHandles?.has(handleId) || sharesDefaultPort) continue
        ports.push({
          id: handleId,
          side,
          position: 'center',
          plateau: mainTabLength(side),
          color: tabFill(handleId) ?? tabFill(getPositionedTargetHandleId(side)),
        })
      }
    }
    for (const side of POSITIONED_SOURCE_HANDLE_SIDES) {
      const handleId = getPositionedTargetHandleId(side)
      const sharesDefaultPort =
        (shouldShowDefaultHandles && side === defaultTargetSide) ||
        side === defaultSourceSide ||
        connectedSourceHandles?.has(getPositionedSourceHandleId(side))
      if (!connectedTargetHandles?.has(handleId) || sharesDefaultPort) continue
      ports.push({
        id: handleId,
        side,
        position: 'center',
        plateau: mainTabLength(side),
        color: tabFill(handleId),
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
    connectedSourceHandles,
    connectedTargetHandles,
    actionMenuSwellOpen,
    actionMenuWidth,
    defaultSourceSide,
    defaultTargetSide,
    highlightedHandles,
    routerRows,
    rowTabLength,
    shouldShowDefaultHandles,
    showActionMenu,
    showErrorRow,
    errorOutputEnabled,
    sideTabLength,
    supportsPositionedHandles,
    type,
  ])

  return (
    <div
      ref={actionMenuRootRef}
      className='group relative'
      data-action-menu-ready={actionMenuContentVisible ? '' : undefined}
      /* Single source of truth for "the swell is painted in the selection
         color" — the action bar keys its icon treatment off this instead of
         React Flow's raw `selected`, which diverges whenever another ring wins
         (an executing block keeps the success ring and no selection swell). */
      data-node-selected={isNodeSelected ? '' : undefined}
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
            onFocusCapture={() => setActionMenuFocused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setActionMenuFocused(false)
              }
            }}
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
        style={blockHeight && blockHeight > 0 ? { minHeight: blockHeight } : undefined}
      >
        <WorkflowBlockBorder
          nodeId={id}
          getConnectionNodeId={getConnectionNodeId}
          ports={borderPorts}
          hasRing={hasRing}
          ringStyles={ringStyles}
          height={blockHeight}
          onCursorHandleChange={supportsCursorHandle ? onCursorHandleChange : undefined}
          onActionMenuReadyChange={setActionMenuSwellReady}
        />
        {cursorSourceHandle && (
          <Handle
            ref={cursorSourceHandleRef}
            type='source'
            position={getCursorSourceHandlePosition(cursorSourceHandle.edgeSide)}
            id={cursorSourceHandle.handleId}
            className='!z-50 !cursor-crosshair !rounded-none !border-none !bg-transparent !opacity-0'
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
            data-workflow-cursor-edge={cursorSourceHandle.edgeSide}
            data-workflow-cursor-source-side={cursorSourceHandle.side}
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
          <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-amber-500 px-2 py-0.5 text-white text-xs'>
            Next Step
          </div>
        )}

        {shouldShowDefaultHandles && (
          <Handle
            type='target'
            position={Position.Left}
            id='target'
            className={getInvisibleHandleClasses('left')}
            style={{
              ...getHandleStyle('horizontal'),
              ...invisibleHandleSize('left', mainTabLength('left'), MAIN_HANDLE_HIT_LENGTH_PX),
            }}
            data-nodeid={id}
            data-handleid='target'
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
          style={
            !hasContentBelowHeader && blockHeight && blockHeight > 0
              ? { height: blockHeight }
              : undefined
          }
        >
          <div className='relative z-10 flex min-w-0 flex-1 items-center'>
            <OverflowSpan
              value={humanizeBlockName(name)}
              className={cn(
                'truncate font-medium text-[17px]',
                !isEnabled && runPathStatus !== 'success' && 'text-[var(--text-muted)]'
              )}
            />
          </div>
          <div className='relative z-10 flex flex-shrink-0 items-center gap-1'>
            <ChipTag
              variant={typeAccent.variant}
              tone={typeAccent.tone}
              className='flex-shrink-0 justify-center'
              data-workflow-type-accent={type}
            >
              <Icon className='size-[14px] flex-shrink-0' />
              {typeLabel && typeLabel !== name ? typeLabel : null}
            </ChipTag>
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
            {!isEnabled && !isLocked && <Badge variant='gray-secondary'>disabled</Badge>}
            {isLocked && <Badge variant='gray-secondary'>locked</Badge>}

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
          <div className='relative z-[2] flex flex-col gap-2 p-2'>
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
              <p className='min-w-0 break-words text-[var(--text-muted)] text-sm leading-6'>
                {sentence}
              </p>
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
                <span className='text-[var(--text-muted)] text-xs'>On error</span>
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
          <>
            <Handle
              type='source'
              position={Position.Right}
              id='source'
              className={getInvisibleHandleClasses('right')}
              style={{
                ...getHandleStyle('horizontal'),
                ...invisibleHandleSize('right', mainTabLength('right'), MAIN_HANDLE_HIT_LENGTH_PX),
              }}
              data-nodeid={id}
              data-handleid='source'
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => {
                if (connection.target === id) return false
                return !wouldCreateConnectionCycle(connection.source!, connection.target!)
              }}
            />
            {POSITIONED_SOURCE_HANDLE_SIDES.map((side) => {
              const handleId = getPositionedSourceHandleId(side)
              return (
                <Handle
                  key={handleId}
                  type='source'
                  position={getReactFlowPosition(side)}
                  id={handleId}
                  className='!pointer-events-none !z-0 !rounded-none !border-none !bg-transparent !opacity-0'
                  style={getCenteredSideHandleStyle(side)}
                  data-nodeid={id}
                  data-handleid={handleId}
                  isConnectable={false}
                  aria-hidden='true'
                />
              )
            })}
          </>
        )}

        {shouldShowDefaultHandles &&
          POSITIONED_SOURCE_HANDLE_SIDES.map((side) => {
            const handleId = getPositionedTargetHandleId(side)
            return (
              <Handle
                key={handleId}
                type='target'
                position={getReactFlowPosition(side)}
                id={handleId}
                className='!pointer-events-none !z-0 !rounded-none !border-none !bg-transparent !opacity-0'
                style={getCenteredSideHandleStyle(side)}
                data-nodeid={id}
                data-handleid={handleId}
                isConnectable={false}
                aria-hidden='true'
              />
            )
          })}

        {rendersErrorHandle && (
          <Handle
            type='source'
            position={ERROR_SOURCE_HANDLE_POSITION}
            id='error'
            className='!z-20 !cursor-crosshair !rounded-none !border-none !bg-transparent !opacity-0'
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
