import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChipTag, cn, handleKeyboardActivation, Tooltip } from '@sim/emcn'
import { Ban, Lock, Repeat, Split } from '@sim/emcn/icons'
import {
  Handle,
  Position,
  type ReactFlowState,
  useStore as useReactFlowStore,
  useStoreApi as useReactFlowStoreApi,
  useUpdateNodeInternals,
} from '@xyflow/react'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS, HANDLE_POSITIONS } from '../dimensions'
import { OverflowSpan } from '../lib/overflow-span'
import type { DiffStatus } from '../types'
import {
  getCursorBranchSourceHandleId,
  getCursorSourceHandleId,
  getCursorSourceHandlePosition,
} from '../workflow-block/source-handle'
import { useActionMenuSwell } from '../workflow-block/use-action-menu-swell'
import {
  CONNECTION_KNOB_PEAK_PX,
  CURSOR_SWELL_LENGTH_PX,
  WorkflowBlockBorder,
  type WorkflowBorderCursorHandle,
  type WorkflowBorderPort,
} from '../workflow-block/workflow-block-border'
import { getWorkflowTypeAccent } from '../workflow-block/workflow-block-view'

/** Data attached to loop/parallel container nodes. */
export interface SubflowNodeData extends Record<string, unknown> {
  width?: number
  height?: number
  parentId?: string
  extent?: 'parent'
  isPreview?: boolean
  /** Whether this subflow is selected in preview mode. */
  isPreviewSelected?: boolean
  kind: 'loop' | 'parallel'
  name?: string
  /** Execution status passed by preview/snapshot views. */
  executionStatus?: 'success' | 'error' | 'not-executed'
  /** Whether the parent workflow is locked and should render read-only. */
  isWorkflowLocked?: boolean
}

/**
 * Props for the pure subflow (loop/parallel container) renderer.
 *
 * Geometry and presentation come from `data`; the state that the editor would
 * read from stores — enabled/locked flags, focus, execution and diff status,
 * nesting depth, and edit permission — is resolved by the container and passed
 * in. The editor-only action bar is injected via the `actionBar` slot so the
 * pure renderer carries no store, socket, or permission coupling.
 */
export interface SubflowNodeViewProps {
  id: string
  data: SubflowNodeData
  /** ReactFlow selection flag. */
  selected?: boolean
  isEnabled: boolean
  isLocked: boolean
  /** Whether this subflow is the focused block in the editor panel. */
  isFocused: boolean
  /** Whether execution controls are active for this subflow. */
  isRunning?: boolean
  /** Whether this subflow participates in the current execution handoff. */
  isExecutionHighlighted?: boolean
  /** Diff state when comparing workflow versions. */
  diffStatus?: DiffStatus
  /** Depth in the parent container hierarchy (drives nesting styling). */
  nestingLevel: number
  canEditWorkflow: boolean
  /** Selects this subflow in the editor panel. */
  onSelect: () => void
  /** Editor-only action bar; omit in read-only / preview contexts. */
  actionBar?: ReactNode
}

const SUBFLOW_CORNER_RADIUS_PX = 16
/* Compile-time pin: the Start card's `top-3 h-[34px] w-[58px]` classes below
   are what HANDLE_POSITIONS.SUBFLOW_CONNECTION_Y is derived from, and Tailwind
   only scans literal class strings — so these annotations fail the build if the
   constants and the CSS ever drift apart. */
const START_WIDTH_PX: 58 = BLOCK_DIMENSIONS.SUBFLOW_START_WIDTH
const START_HEIGHT_PX: 34 = BLOCK_DIMENSIONS.SUBFLOW_START_HEIGHT
const START_CORNER_RADIUS_PX = 8
const START_CURSOR_SIDES = ['right'] as const
/** Aligns the outer input/output ports with the centre of the inset Start card. */
const HANDLE_STYLE = {
  top: `${HANDLE_POSITIONS.SUBFLOW_CONNECTION_Y}px`,
  transform: 'translateY(-50%)',
} as const
const ACTION_MENU_RIGHT_INSET_PX = 24
const ACTION_MENU_AMPLITUDE = 7
const CURSOR_HANDLE_CROSS_PX = CONNECTION_KNOB_PEAK_PX * 2

interface SubflowCursorSourceHandle extends WorkflowBorderCursorHandle {
  handleId: string
}

const getCursorHandleSize = (side: WorkflowBorderCursorHandle['edgeSide']) =>
  side === 'top' || side === 'bottom'
    ? { width: CURSOR_SWELL_LENGTH_PX, height: CURSOR_HANDLE_CROSS_PX }
    : { width: CURSOR_HANDLE_CROSS_PX, height: CURSOR_SWELL_LENGTH_PX }

/** Invisible React Flow handles aligned with the painted connection knobs. */
const getHandleClasses = (position: 'left' | 'right') => {
  const baseClasses =
    'z-20! h-[38px]! w-[14px]! cursor-crosshair! rounded-none! border-none! bg-transparent! opacity-0!'

  const positionClasses = {
    left: 'left-[-7px]!',
    right: 'right-[-7px]!',
  }

  return cn(baseClasses, positionClasses[position])
}

interface SubflowStateIndicatorProps {
  label: string
  Icon: typeof Ban
}

/** Compact disabled/locked marker aligned with the standard workflow-card header. */
function SubflowStateIndicator({ label, Icon }: SubflowStateIndicatorProps) {
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

interface SubflowStartViewProps {
  parentId: string
  kind: SubflowNodeData['kind']
  isPreview?: boolean
  isHighlighted?: boolean
}

/** Start control shared by editable and preview subflow containers. */
export function SubflowStartView({
  parentId,
  kind,
  isPreview = false,
  isHighlighted = false,
}: SubflowStartViewProps) {
  const startHandleId = kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
  /*
   * The swell's temporary handle carries the branch-cursor form of the start
   * id. The plain cursor id normalizes by block type — for a container that is
   * `loop-end-source`/`parallel-end-source`, the container's exit — so a drag
   * begun on the Start pill would persist as an edge leaving the container.
   * The branch form passes the start id through normalization verbatim.
   */
  const cursorHandleId = getCursorBranchSourceHandleId(startHandleId)
  const reactFlowStore = useReactFlowStoreApi()
  const updateNodeInternals = useUpdateNodeInternals()
  const cursorSourceHandleRef = useRef<HTMLDivElement>(null)
  const cursorSourceHandleKeyRef = useRef<string | null>(null)
  const [cursorSourceHandle, setCursorSourceHandle] = useState<WorkflowBorderCursorHandle | null>(
    null
  )

  const getConnectionNodeId = useCallback(
    () => reactFlowStore.getState().connection.fromNode?.id ?? null,
    [reactFlowStore]
  )

  const onCursorHandleChange = useCallback((nextHandle: WorkflowBorderCursorHandle | null) => {
    if (!nextHandle) {
      if (cursorSourceHandleKeyRef.current === null) return
      cursorSourceHandleKeyRef.current = null
      setCursorSourceHandle(null)
      return
    }

    const handleElement = cursorSourceHandleRef.current
    if (handleElement) {
      handleElement.style.left = `${nextHandle.x}px`
      handleElement.style.top = `${nextHandle.y}px`
    }

    if (cursorSourceHandleKeyRef.current !== nextHandle.edgeSide) {
      cursorSourceHandleKeyRef.current = nextHandle.edgeSide
      setCursorSourceHandle(nextHandle)
    }
  }, [])

  /** Aligns React Flow's cached handle origin before a cursor-swell drag begins. */
  const syncCursorSourceHandleBounds = useCallback(() => {
    const handleElement = cursorSourceHandleRef.current
    const nodeElement = handleElement?.closest<HTMLDivElement>('.react-flow__node') ?? null
    if (!handleElement || !nodeElement) return

    const state = reactFlowStore.getState()
    const sourceBounds = state.nodeLookup.get(parentId)?.internals.handleBounds?.source
    const handleId = handleElement.dataset.handleid
    const handlePosition = handleElement.dataset.handlepos as Position | undefined
    const zoom = state.transform[2]
    if (!sourceBounds || !handleId || !handlePosition || zoom <= 0) return

    const nodeBounds = nodeElement.getBoundingClientRect()
    const handleBounds = handleElement.getBoundingClientRect()
    const [originX, originY] = state.nodeOrigin
    const nextBounds = {
      id: handleId,
      nodeId: parentId,
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
  }, [parentId, reactFlowStore])

  useLayoutEffect(() => {
    updateNodeInternals(parentId)
  }, [cursorSourceHandle?.edgeSide, parentId, updateNodeInternals])

  const ports = useMemo<WorkflowBorderPort[]>(
    () => [
      {
        id: startHandleId,
        side: 'right',
        position: 'center',
        plateau: CURSOR_SWELL_LENGTH_PX,
        color: isHighlighted ? 'var(--text-secondary)' : undefined,
      },
    ],
    [isHighlighted, startHandleId]
  )

  return (
    <div
      className='absolute top-3 left-[16px] flex h-[34px] w-[58px] items-center justify-center rounded-lg'
      style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
      data-parent-id={parentId}
      data-node-role={`${kind}-start`}
      data-extent='parent'
      data-connection-swell=''
    >
      <WorkflowBlockBorder
        nodeId={parentId}
        getConnectionNodeId={getConnectionNodeId}
        ports={ports}
        cursorSwellEnabled={!isPreview}
        cursorSwellSides={START_CURSOR_SIDES}
        onCursorHandleChange={!isPreview ? onCursorHandleChange : undefined}
        radius={START_CORNER_RADIUS_PX}
        hasRing={false}
        ringStyles=''
        width={START_WIDTH_PX}
        height={START_HEIGHT_PX}
      />
      <span className='relative z-10 text-[var(--text-primary)] text-sm'>Start</span>
      <Handle
        type='source'
        position={Position.Right}
        id={startHandleId}
        className={getHandleClasses('right')}
        style={{
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'auto',
        }}
        data-parent-id={parentId}
      />
      {cursorSourceHandle && !isPreview && (
        <Handle
          ref={cursorSourceHandleRef}
          type='source'
          position={getCursorSourceHandlePosition(cursorSourceHandle.edgeSide)}
          id={cursorHandleId}
          className='z-50! cursor-crosshair! rounded-none! border-none! bg-transparent! opacity-0!'
          style={{
            right: 'auto',
            bottom: 'auto',
            left: cursorSourceHandle.x,
            top: cursorSourceHandle.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
            ...getCursorHandleSize(cursorSourceHandle.edgeSide),
          }}
          data-nodeid={parentId}
          data-handleid={cursorHandleId}
          isConnectableStart={true}
          isConnectableEnd={false}
          onPointerDownCapture={syncCursorSourceHandleBounds}
        />
      )}
    </div>
  )
}

/**
 * Pure renderer for loop/parallel execution containers: a resizable container
 * with a header (icon, name, disabled/locked badges), a start pill with its
 * source handle, and the left/right connection handles.
 */
export function SubflowNodeView({
  id,
  data,
  selected,
  isEnabled,
  isLocked,
  isFocused,
  isRunning = false,
  isExecutionHighlighted = false,
  diffStatus,
  nestingLevel,
  canEditWorkflow,
  onSelect,
  actionBar,
}: SubflowNodeViewProps) {
  const updateNodeInternals = useUpdateNodeInternals()
  const reactFlowStore = useReactFlowStoreApi()
  const cursorSourceHandleRef = useRef<HTMLDivElement>(null)
  const cursorSourceHandleKeyRef = useRef<string | null>(null)
  const [cursorSourceHandle, setCursorSourceHandle] = useState<SubflowCursorSourceHandle | null>(
    null
  )
  const isPreview = data?.isPreview || false
  const isPreviewSelected = data?.isPreviewSelected || false

  const endHandleId = data.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
  const showFixedEndPort = useReactFlowStore(
    useMemo(() => {
      let previousEdges: ReactFlowState['edges'] | undefined
      let previousResult = !data.parentId

      return (state: ReactFlowState) => {
        if (!data.parentId || state.edges === previousEdges) return previousResult

        previousEdges = state.edges
        previousResult = state.edges.some(
          (edge) => edge.source === id && edge.sourceHandle === endHandleId
        )
        return previousResult
      }
    }, [data.parentId, endHandleId, id])
  )
  const BlockIcon = data.kind === 'loop' ? Repeat : Split
  const blockName = data.name || (data.kind === 'loop' ? 'Loop' : 'Parallel')
  const blockTypeLabel = data.kind === 'loop' ? 'Loop' : 'Parallel'
  const blockTypeAccent = getWorkflowTypeAccent(data.kind)
  const width = data.width ?? 500
  const height = data.height ?? 300

  const getConnectionNodeId = useCallback(
    () => reactFlowStore.getState().connection.fromNode?.id ?? null,
    [reactFlowStore]
  )

  const onCursorHandleChange = useCallback((nextHandle: WorkflowBorderCursorHandle | null) => {
    if (!nextHandle) {
      if (cursorSourceHandleKeyRef.current === null) return
      cursorSourceHandleKeyRef.current = null
      setCursorSourceHandle(null)
      return
    }

    const handleId = getCursorSourceHandleId(nextHandle.side)
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
  }, [])

  /** Aligns React Flow's cached handle origin before a cursor-swell drag begins. */
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

  useLayoutEffect(() => {
    updateNodeInternals(id)
  }, [cursorSourceHandle?.handleId, cursorSourceHandle?.side, id, updateNodeInternals])

  const isSelected = !isPreview && selected
  const isNodeSelected = Boolean(isFocused || isSelected || isPreviewSelected)
  const usesSelectedVisuals = isNodeSelected || isExecutionHighlighted
  const previewRunStatus = isPreview ? data.executionStatus : undefined
  const hasStatusRing =
    diffStatus === 'new' ||
    diffStatus === 'edited' ||
    previewRunStatus === 'success' ||
    previewRunStatus === 'error'
  const hasRing = isNodeSelected || hasStatusRing
  const ringStyles = isNodeSelected
    ? 'ring-[1.5px] ring-[var(--text-secondary)]'
    : diffStatus === 'new'
      ? 'ring-[1.5px] ring-[var(--brand-accent)]'
      : diffStatus === 'edited'
        ? 'ring-[1.5px] ring-[var(--warning)]'
        : previewRunStatus === 'success'
          ? 'ring-[1.5px] ring-[var(--brand-accent)]'
          : previewRunStatus === 'error'
            ? 'ring-[1.5px] ring-[var(--text-error)]'
            : ''

  const showActionMenu = Boolean(actionBar) && !isPreview
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
     * A container in the handoff into the running block takes the selected
     * TREATMENT — graphite silhouette, so the eye can follow the baton — but
     * that is not a reason to pin its toolbar open, which left it down for the
     * whole run. Selection is deliberately not here either: a selected container
     * opens on hover like any other, which is what its own tests pin.
     */
    forceOpen: isRunning,
    suspendInteraction: isRunning,
    suppressNestedNodeHover: true,
  })

  const borderPorts = useMemo<WorkflowBorderPort[]>(() => {
    const ports: WorkflowBorderPort[] = [
      {
        id: 'target',
        side: 'left',
        position: HANDLE_POSITIONS.SUBFLOW_CONNECTION_Y,
        plateau: CURSOR_SWELL_LENGTH_PX,
      },
    ]

    if (showFixedEndPort) {
      ports.push({
        id: endHandleId,
        side: 'right',
        position: HANDLE_POSITIONS.SUBFLOW_CONNECTION_Y,
        plateau: CURSOR_SWELL_LENGTH_PX,
      })
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
  }, [actionMenuSwellOpen, actionMenuWidth, endHandleId, showActionMenu, showFixedEndPort])

  return (
    <div
      ref={actionMenuRootRef}
      className='group pointer-events-none relative'
      data-action-menu-ready={actionMenuContentVisible ? '' : undefined}
      data-action-menu-open={actionMenuSwellOpen ? '' : undefined}
      data-node-selected={usesSelectedVisuals ? '' : undefined}
      data-execution-highlighted={isExecutionHighlighted ? '' : undefined}
    >
      {showActionMenu && (
        <>
          <div
            aria-hidden='true'
            data-workflow-action-bar-bridge=''
            className='-top-[28px] pointer-events-auto absolute right-0 z-10 h-[28px] w-[240px]'
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
        className='relative select-none rounded-2xl'
        style={{
          width,
          height,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
        data-node-id={id}
        data-type='subflowNode'
        data-nesting-level={nestingLevel}
      >
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 z-40 rounded-2xl opacity-0 ring-[1.5px] ring-[var(--text-secondary)] transition-opacity duration-100 [.subflow-node-drop-target_&]:opacity-100'
          data-subflow-drop-target-outline=''
        />

        <WorkflowBlockBorder
          nodeId={id}
          getConnectionNodeId={getConnectionNodeId}
          ports={borderPorts}
          cursorSwellEnabled={!isPreview}
          onCursorHandleChange={!isPreview ? onCursorHandleChange : undefined}
          radius={SUBFLOW_CORNER_RADIUS_PX}
          hasRing={hasRing || isExecutionHighlighted}
          ringStyles={
            isExecutionHighlighted ? 'ring-[1.5px] ring-[var(--text-secondary)]' : ringStyles
          }
          isSelected={usesSelectedVisuals}
          bodyFill={data.kind === 'loop' ? 'var(--surface-3)' : undefined}
          width={width}
          height={height}
          onActionMenuReadyChange={setActionMenuSwellReady}
        />

        {cursorSourceHandle && !isPreview && (
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
              pointerEvents: 'auto',
              ...getCursorHandleSize(cursorSourceHandle.edgeSide),
            }}
            data-nodeid={id}
            data-handleid={cursorSourceHandle.handleId}
            isConnectableStart={true}
            isConnectableEnd={false}
            onPointerDownCapture={syncCursorSourceHandleBounds}
          />
        )}

        <div
          role='button'
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(event) => handleKeyboardActivation(event, onSelect)}
          className='workflow-drag-handle relative z-20 flex cursor-grab items-center justify-between px-2 [&:active]:cursor-grabbing'
          style={{ pointerEvents: 'auto', height: CONTAINER_DIMENSIONS.HEADER_HEIGHT }}
          data-subflow-header=''
        >
          <div
            className={cn(
              'relative z-10 flex min-w-0 flex-1 items-center transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
              !isEnabled && 'opacity-50'
            )}
          >
            <OverflowSpan
              value={blockName}
              className={cn('text-[17px]', !isEnabled && 'text-[var(--text-muted)]')}
            />
          </div>
          <div className='relative z-10 flex shrink-0 items-center gap-1'>
            {!isEnabled && <SubflowStateIndicator label='Disabled' Icon={Ban} />}
            {isLocked && <SubflowStateIndicator label='Locked' Icon={Lock} />}
            <ChipTag
              variant={blockTypeAccent.variant}
              tone={blockTypeAccent.tone}
              className={cn(
                'shrink-0 justify-center transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
                !isEnabled && 'opacity-50'
              )}
              data-subflow-type-tag={data.kind}
            >
              <BlockIcon className='size-[14px] shrink-0' />
              {blockTypeLabel}
            </ChipTag>
          </div>
        </div>

        {/*
         * Subflow body background. Captures clicks to select the subflow in the
         * panel editor, matching the header click behavior. Child nodes and edges
         * are rendered as sibling divs at the viewport level by ReactFlow (not as
         * DOM children), so enabling pointer events here doesn't block them.
         */}
        <div
          role='button'
          tabIndex={isPreview ? -1 : 0}
          aria-label={`Select ${blockName}`}
          className='workflow-drag-handle absolute inset-0 top-[40px] z-10 cursor-grab rounded-b-2xl [&:active]:cursor-grabbing'
          style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
          onClick={onSelect}
          onKeyDown={(event) => handleKeyboardActivation(event, onSelect)}
        />

        {!isPreview && canEditWorkflow && (
          <div
            role='separator'
            aria-orientation='horizontal'
            className='absolute right-[8px] bottom-2 z-20 flex size-[32px] cursor-se-resize items-center justify-center text-muted-foreground'
            style={{ pointerEvents: 'auto' }}
          />
        )}

        <div
          className='relative z-20'
          data-dragarea='true'
          style={{
            pointerEvents: 'none',
            height: `calc(100% - ${CONTAINER_DIMENSIONS.HEADER_HEIGHT}px)`,
            paddingTop: CONTAINER_DIMENSIONS.TOP_PADDING,
            paddingRight: CONTAINER_DIMENSIONS.RIGHT_PADDING,
            paddingBottom: CONTAINER_DIMENSIONS.BOTTOM_PADDING,
            paddingLeft: CONTAINER_DIMENSIONS.LEFT_PADDING,
          }}
        >
          <SubflowStartView
            parentId={id}
            kind={data.kind}
            isPreview={isPreview}
            isHighlighted={usesSelectedVisuals}
          />
        </div>

        {/* Input handle on left middle */}
        <Handle
          type='target'
          position={Position.Left}
          id='target'
          className={getHandleClasses('left')}
          style={{
            ...HANDLE_STYLE,
            pointerEvents: 'auto',
          }}
        />

        {/* Output handle on right middle */}
        <Handle
          type='source'
          position={Position.Right}
          className={getHandleClasses('right')}
          style={{
            ...HANDLE_STYLE,
            pointerEvents: 'auto',
          }}
          id={endHandleId}
        />
      </div>
    </div>
  )
}
