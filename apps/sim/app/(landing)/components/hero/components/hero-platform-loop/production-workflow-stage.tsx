'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  cn,
  Duplicate,
  PlayOutline,
  Tooltip,
  Trash,
  usePrefersReducedMotion,
} from '@sim/emcn'
import { Circle, Minus, Plus, Square, Unlock } from '@sim/emcn/icons'
import {
  CanvasSentenceView,
  InlineChip,
  useCanvasColorMode,
  WorkflowBlockView,
  WorkflowEdgeView,
} from '@sim/workflow-renderer'
import {
  applyNodeChanges,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import styles from '@/app/(landing)/components/hero/components/hero-platform-loop/production-workflow-stage.module.css'
import {
  BLOCK_WIDTH,
  type BlockDef,
  blockHeight,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

const MIN_ZOOM = 0.45
const MAX_ZOOM = 1.3
/** Keep neighboring cards visible in the hero's split workflow pane. */
const FOCUSED_NODE_MIN_ZOOM = 0.65
const FOCUSED_NODE_DURATION_MS = 500
const BLOCK_RUN_DURATION_MS = 1_200
const BLOCK_COMPLETE_DURATION_MS = 1_400
/** Scripted camera: air around the whole workflow when fitting, and the fit's zoom ceiling. */
const FIT_PADDING_PX = 40
/**
 * How a card and its edge arrive. A card rises and fades in over half a second
 * on the editor's ease; its edge fades in a beat later, once the card has
 * landed, so a connection reads as made rather than there already. Both honour
 * reduced motion.
 */
const NODE_ENTER_CLASS = styles.nodeEnter
const EDGE_ENTER_CLASS = styles.edgeEnter
/** A fit never shows cards larger than life: a lone Start block sits at full size, centred. */
const FIT_MAX_ZOOM = 1
/**
 * The fitted overview never shrinks below this: a long workflow is centred and
 * allowed to overflow the frame instead, the way a real canvas viewport crops
 * a graph, so the cards stay legible. Tuned so the demo's eight-column graph
 * just fits a 1750px frame and only overflows on narrower ones.
 */
const FIT_MIN_ZOOM = 0.64
const FIT_DURATION_MS = 600
const EMPTY_IDS: ReadonlySet<string> = new Set()

const ACTION_BUTTON_STYLES = [
  'size-[24px] rounded-md p-0',
  'border-none bg-transparent text-[var(--text-icon)]',
  'hover-hover:bg-[var(--surface-5)] hover-hover:!text-[var(--text-primary)]',
  'dark:hover-hover:bg-[var(--surface-4)]',
  'transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.96]',
  'group-data-[node-selected]:text-[var(--surface-2)]',
  'hover-hover:group-data-[node-selected]:bg-[var(--surface-2)]',
  'hover-hover:group-data-[node-selected]:!text-[var(--text-primary)]',
].join(' ')

const FIRST_ACTION_STYLES =
  "!w-[40px] [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L36_24A4_4_0_0_0_40_20L40_4A4_4_0_0_0_36_0Z')] [&>svg]:translate-x-[8px] [&>svg]:translate-y-px"

/** The running run slot: graphite fill, inverse glyph - the editor's own treatment. */
const RUNNING_RUN_STYLES =
  '!bg-[var(--text-secondary)] !text-[var(--text-inverse)] hover-hover:!bg-[var(--white)] hover-hover:!text-[var(--surface-inverted)]'
/** A bystander card's actions dim mid-run; the run/stop slot keeps its ordinary chrome. */
const BYSTANDER_ACTION_STYLES =
  '!bg-transparent !opacity-25 hover-hover:!bg-transparent dark:hover-hover:!bg-transparent'
/** Slots the hatch runs across blank their icons so it reads uninterrupted. */
const SWEEP_SLOT_STYLES =
  '!opacity-100 [&_svg]:!opacity-0 !bg-transparent hover-hover:!bg-transparent'
/**
 * The editor's running hatch: 24px marks on a 26px pitch sheared to 75°,
 * scrolled by one period so the loop is seamless. Painted once across the
 * row, inset past the run/stop slot, and trimmed to the swell's tapered end.
 */
const RUNNING_FILL =
  'bg-[repeating-linear-gradient(75deg,var(--surface-2)_11.59px_22.805px,transparent_23.555px_24.735px,var(--surface-2)_25.485px_36.7px)]'
const RUNNING_FILL_INSET = 'left-[42px]'
const RUNNING_FILL_END_TAPER = '[clip-path:polygon(0_0,calc(100%_-_20px)_0,100%_100%,0_100%)]'

const LAST_ACTION_STYLES =
  "!w-[40px] [clip-path:path('M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z')] [&_svg]:-translate-x-[6px] [&_svg]:translate-y-px"

const REACT_FLOW_STYLES = [
  '[&_.react-flow__handle]:!z-[30]',
  '[&_.react-flow__pane]:select-none',
  '[&_.react-flow__selectionpane]:select-none',
  '[&_.react-flow__background]:hidden',
].join(' ')

/** Selection and run state a demo drives from its own timeline. */
export interface ScriptedWorkflowState {
  selectedId: string | null
  /** Whether a run is in progress: traversed edges read graphite, the rest dim, swells sweep. */
  isWorkflowRunning: boolean
  runningId: string | null
  completedIds: ReadonlySet<string>
}

interface ProductionWorkflowStageProps {
  builtCount: number
  blocks: BlockDef[]
  edges: ReadonlyArray<readonly [string, string]>
  canvas: { width: number; height: number }
  /**
   * Scripted state for a non-interactive demo. When set, clicks, drags, and
   * the zoom controls are off, selection and run state come from here, and the
   * camera follows: it fits the whole workflow while nothing is selected and
   * glides to each selected card.
   */
  scripted?: ScriptedWorkflowState
  /** Px the camera keeps clear at the container's top and bottom when fitting. */
  viewportInset?: { top: number; bottom: number }
}

/** The design-space box every block of a workflow occupies. */
function workflowBounds(blocks: BlockDef[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const block of blocks) {
    minX = Math.min(minX, block.x)
    minY = Math.min(minY, block.y)
    maxX = Math.max(maxX, block.x + BLOCK_WIDTH)
    maxY = Math.max(maxY, block.y + blockHeight(block))
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

interface LandingWorkflowNodeData extends Record<string, unknown> {
  block: BlockDef
  running: boolean
  workflowRunning: boolean
  complete: boolean
  onSelect: (blockId: string) => void
  onRunToggle: (blockId: string) => void
}

/**
 * The editor's running spinner: it sits in the run slot with the same glyph
 * offset the Play icon gets, and swaps to a stop glyph on hover.
 */
function RunningActionIcon() {
  return (
    <span
      className='relative grid size-[14px] translate-x-[8px] translate-y-px place-items-center'
      role='status'
    >
      <span className='sr-only'>Block running</span>
      <span
        aria-hidden='true'
        className='col-start-1 row-start-1 opacity-100 transition-opacity duration-100 group-hover/run:opacity-0 motion-safe:animate-spin motion-reduce:transition-none'
      >
        <svg className='size-[14px]' viewBox='0 0 24 24' fill='none'>
          <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='2' opacity='0.25' />
          <circle
            cx='12'
            cy='12'
            r='10'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeDasharray='18 45'
          />
        </svg>
      </span>
      <span
        aria-hidden='true'
        className='col-start-1 row-start-1 opacity-0 transition-opacity duration-100 group-hover/run:opacity-100 motion-reduce:transition-none'
      >
        <Square className='size-[11px] fill-current' strokeWidth={0} />
      </span>
    </span>
  )
}

interface PreviewActionBarProps {
  block: BlockDef
  running: boolean
  workflowRunning: boolean
  onRunToggle: () => void
}

/**
 * The editor's action bar in its swell variant, with the same run treatment:
 * Play at rest; while the workflow runs, the running card's slot turns
 * graphite with the spinner and the hatch marches behind its other slots,
 * every other card offers Stop with its remaining actions dimmed.
 */
function PreviewActionBar({ block, running, workflowRunning, onRunToggle }: PreviewActionBarProps) {
  const sweeping = workflowRunning && running
  const inertActions = [
    { label: 'Disable', Icon: Circle },
    { label: 'Lock', Icon: Unlock },
    ...(!block.isTrigger ? [{ label: 'Duplicate', Icon: Duplicate }] : []),
    { label: 'Delete', Icon: Trash },
  ]

  return (
    <div
      data-workflow-action-bar-swell=''
      className='-top-[28px] pointer-events-auto absolute right-[24px] z-[40] h-[28px] w-fit overflow-hidden rounded-lg px-[0.2rem] py-0.5'
    >
      <div className='pointer-events-none relative flex h-full flex-row items-center gap-[2px] opacity-0 transition-opacity duration-[30ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] group-data-[action-menu-ready]:pointer-events-auto group-data-[action-menu-ready]:opacity-100 group-data-[action-menu-ready]:duration-100'>
        {sweeping && (
          <span
            aria-hidden='true'
            className={cn(
              'pointer-events-none absolute inset-y-0 right-0 overflow-hidden',
              RUNNING_FILL_INSET,
              RUNNING_FILL_END_TAPER
            )}
          >
            <span
              className={cn(
                'block h-full w-[calc(100%_+_26px)] will-change-transform',
                'animate-running-hatch-scroll motion-reduce:animate-none',
                RUNNING_FILL
              )}
            />
          </span>
        )}
        <Tooltip.Root preferAbove>
          <Tooltip.Trigger asChild>
            <span className='inline-flex'>
              <Button
                type='button'
                variant='ghost'
                aria-label={workflowRunning ? 'Stop workflow' : `Run ${block.name}`}
                className={cn(
                  ACTION_BUTTON_STYLES,
                  FIRST_ACTION_STYLES,
                  running && RUNNING_RUN_STYLES,
                  workflowRunning && 'group/run'
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  onRunToggle()
                }}
              >
                {workflowRunning ? (
                  running ? (
                    <RunningActionIcon />
                  ) : (
                    <Square
                      className='size-[11px] fill-current'
                      aria-hidden='true'
                      strokeWidth={0}
                    />
                  )
                ) : (
                  <PlayOutline className='size-[14px]' />
                )}
              </Button>
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>{workflowRunning ? 'Stop' : 'Run'}</Tooltip.Content>
        </Tooltip.Root>

        {inertActions.map(({ label, Icon }) => (
          <Tooltip.Root key={label} preferAbove>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='ghost'
                aria-label={label}
                className={cn(
                  ACTION_BUTTON_STYLES,
                  label === 'Delete' && LAST_ACTION_STYLES,
                  workflowRunning && !running && BYSTANDER_ACTION_STYLES,
                  sweeping && SWEEP_SLOT_STYLES
                )}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
              >
                <Icon className='size-[14px]' />
              </Button>
            </Tooltip.Trigger>
            {!workflowRunning && <Tooltip.Content side='top'>{label}</Tooltip.Content>}
          </Tooltip.Root>
        ))}
      </div>
    </div>
  )
}

function renderSentence(block: BlockDef) {
  if (!block.sentence) return undefined

  return (
    <CanvasSentenceView
      segments={block.sentence.segments}
      renderChip={(subBlockId) => {
        const value = block.sentence?.values[subBlockId]
        return value ? (
          <InlineChip>
            <span className='block max-w-[138px] truncate'>{value}</span>
          </InlineChip>
        ) : null
      }}
    />
  )
}

function ProductionWorkflowNode({ data, selected }: NodeProps<Node<LandingWorkflowNodeData>>) {
  const { block, running, workflowRunning, complete, onSelect, onRunToggle } = data
  const shouldShowDefaultHandles = !block.isTrigger
  const conditionRows =
    block.type === 'condition'
      ? block.rows.map((row, index) => ({
          id: index === 0 ? 'if' : index === 1 ? 'else' : `branch-${index + 1}`,
          title: row.title,
          value: row.value,
        }))
      : []
  const hasContentBelowHeader = Boolean(
    block.sentence || block.rows.length > 0 || shouldShowDefaultHandles
  )

  return (
    <div className={NODE_ENTER_CLASS}>
      <WorkflowBlockView
        id={block.id}
        type={block.type ?? 'starter'}
        name={block.name}
        isEnabled
        isLocked={false}
        hasRing={selected}
        ringStyles={selected ? 'ring-[1.5px] ring-[var(--text-secondary)]' : ''}
        runPathStatus={complete ? 'success' : undefined}
        isRunning={running}
        isExecutionHighlighted={running}
        Icon={block.icon}
        iconBgColor={block.bgColor}
        isIntegration={block.isIntegration}
        horizontalHandles
        shouldShowDefaultHandles={shouldShowDefaultHandles}
        blockHeight={blockHeight(block)}
        hasContentBelowHeader={hasContentBelowHeader}
        conditionRows={conditionRows}
        routerRows={[]}
        wouldCreateConnectionCycle={() => false}
        cursorConnectionsEnabled={false}
        onSelect={() => onSelect(block.id)}
        actionBar={
          <PreviewActionBar
            block={block}
            running={running}
            workflowRunning={workflowRunning}
            onRunToggle={() => onRunToggle(block.id)}
          />
        }
        rows={null}
        typeLabel={block.typeLabel}
        sentence={block.type === 'condition' ? undefined : renderSentence(block)}
        errorOutputEnabled={false}
      />
    </div>
  )
}

interface LandingWorkflowEdgeData {
  runStatus?: 'success'
  isWorkflowRunning: boolean
  isTargetActive: boolean
}

function ProductionWorkflowEdge(props: EdgeProps) {
  const data = props.data as LandingWorkflowEdgeData | undefined
  const runStatus = data?.runStatus
  const isWorkflowRunning = Boolean(data?.isWorkflowRunning)
  const isTargetActive = Boolean(data?.isTargetActive)
  const isConnectedToSelection = useStore(
    useCallback(
      (state) =>
        Boolean(
          state.nodeLookup.get(props.source)?.selected ||
            state.nodeLookup.get(props.target)?.selected
        ),
      [props.source, props.target]
    )
  )

  return (
    <g className={EDGE_ENTER_CLASS}>
      <WorkflowEdgeView
        {...props}
        diffStatus={null}
        runStatus={runStatus}
        isPreviewRun={false}
        isWorkflowRunning={isWorkflowRunning}
        isTargetActive={isTargetActive}
        isConnectedToSelection={isConnectedToSelection}
      />
    </g>
  )
}

const NODE_TYPES: NodeTypes = { workflowBlock: ProductionWorkflowNode }
const EDGE_TYPES: EdgeTypes = { workflowEdge: ProductionWorkflowEdge }

function CanvasZoomControls() {
  const reducedMotion = usePrefersReducedMotion()
  const { zoomIn, zoomOut } = useReactFlow()
  const { zoom } = useViewport()
  const buttonClassName = 'size-[28px] rounded-sm p-0'

  return (
    <div className='absolute bottom-3 left-3 z-30 flex h-[36px] items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1'>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            type='button'
            variant='ghost'
            className={buttonClassName}
            onClick={() => zoomOut({ duration: reducedMotion ? 0 : 160 })}
            disabled={zoom <= MIN_ZOOM}
            aria-label='Zoom out'
          >
            <Minus className='size-[14px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>Zoom out</Tooltip.Content>
      </Tooltip.Root>
      <output
        aria-live='polite'
        aria-label={`Canvas zoom ${Math.round(zoom * 100)} percent`}
        className='w-10 text-center text-[var(--text-secondary)] text-caption tabular-nums'
      >
        {Math.round(zoom * 100)}%
      </output>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            type='button'
            variant='ghost'
            className={buttonClassName}
            onClick={() => zoomIn({ duration: reducedMotion ? 0 : 160 })}
            disabled={zoom >= MAX_ZOOM}
            aria-label='Zoom in'
          >
            <Plus className='size-[14px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>Zoom in</Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
}

function ProductionWorkflowCanvas({
  builtCount,
  blocks,
  edges,
  scripted,
  viewportInset,
}: ProductionWorkflowStageProps) {
  const colorMode = useCanvasColorMode()
  const { getNode, getViewport, setCenter, setViewport } = useReactFlow()
  const containerRef = useRef<HTMLDivElement>(null)
  const focusFrameRef = useRef(0)
  const reducedMotion = usePrefersReducedMotion()
  const defaultSelection = scripted
    ? undefined
    : (blocks.find((block) => block.type === 'agent')?.id ?? blocks[0]?.id)
  const initialFocusAppliedRef = useRef(false)
  const [internalSelectedId, setSelectedId] = useState(defaultSelection)
  const [internalRunningId, setRunningId] = useState<string | null>(null)
  const [internalCompletedId, setCompletedId] = useState<string | null>(null)
  const selectedId = scripted ? scripted.selectedId : internalSelectedId
  const runningId = scripted ? scripted.runningId : internalRunningId
  const isWorkflowRunning = scripted ? scripted.isWorkflowRunning : Boolean(internalRunningId)
  const completedIds = useMemo<ReadonlySet<string>>(() => {
    if (scripted) return scripted.completedIds
    return internalCompletedId ? new Set([internalCompletedId]) : EMPTY_IDS
  }, [scripted, internalCompletedId])
  const builtBlocks = useMemo(() => blocks.slice(0, builtCount), [blocks, builtCount])
  const builtIds = useMemo(() => new Set(builtBlocks.map((block) => block.id)), [builtBlocks])

  useEffect(() => {
    if (!internalRunningId) return
    const blockId = internalRunningId
    const timer = window.setTimeout(() => {
      setRunningId((current) => (current === blockId ? null : current))
      setCompletedId(blockId)
    }, BLOCK_RUN_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [internalRunningId])

  useEffect(() => {
    if (!internalCompletedId) return
    const blockId = internalCompletedId
    const timer = window.setTimeout(() => {
      setCompletedId((current) => (current === blockId ? null : current))
    }, BLOCK_COMPLETE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [internalCompletedId])

  const handleRunToggle = useCallback((blockId: string) => {
    setSelectedId(blockId)
    setCompletedId(null)
    setRunningId((current) => (current === blockId ? null : blockId))
  }, [])

  const createWorkflowNode = useCallback(
    (block: BlockDef, existing?: Node<LandingWorkflowNodeData>): Node<LandingWorkflowNodeData> => ({
      ...existing,
      id: block.id,
      type: 'workflowBlock',
      position: existing?.position ?? { x: block.x, y: block.y },
      initialWidth: BLOCK_WIDTH,
      initialHeight: blockHeight(block),
      selected: selectedId === block.id,
      dragHandle: '.workflow-drag-handle',
      draggable: true,
      connectable: false,
      data: {
        block,
        running: runningId === block.id,
        workflowRunning: isWorkflowRunning,
        complete: completedIds.has(block.id),
        onSelect: setSelectedId,
        onRunToggle: handleRunToggle,
      },
    }),
    [completedIds, handleRunToggle, isWorkflowRunning, runningId, selectedId]
  )

  const [nodes, setNodes] = useState<Node<LandingWorkflowNodeData>[]>(() =>
    builtBlocks.map((block) => createWorkflowNode(block))
  )

  useEffect(() => {
    setNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]))
      return builtBlocks.map((block) => createWorkflowNode(block, currentById.get(block.id)))
    })
  }, [builtBlocks, createWorkflowNode])

  const handleNodesChange = useCallback((changes: NodeChange<Node<LandingWorkflowNodeData>>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  const focusBlockInView = useCallback(
    (blockId: string, duration = FOCUSED_NODE_DURATION_MS) => {
      cancelAnimationFrame(focusFrameRef.current)
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = requestAnimationFrame(() => {
          const node = getNode(blockId)
          if (!node) return

          const position = node.position
          const nodeWidth = node.measured?.width ?? BLOCK_WIDTH
          const nodeHeight = node.measured?.height ?? 100
          const targetZoom = Math.max(getViewport().zoom, FOCUSED_NODE_MIN_ZOOM)

          void setCenter(position.x + nodeWidth / 2, position.y + nodeHeight / 2, {
            zoom: targetZoom,
            duration: reducedMotion ? 0 : duration,
          })
        })
      })
    },
    [getNode, getViewport, reducedMotion, setCenter]
  )

  useEffect(() => () => cancelAnimationFrame(focusFrameRef.current), [])

  useEffect(() => {
    if (initialFocusAppliedRef.current || !defaultSelection || !builtIds.has(defaultSelection)) {
      return
    }

    initialFocusAppliedRef.current = true
    focusBlockInView(defaultSelection, 0)
  }, [builtIds, defaultSelection, focusBlockInView])

  const fitWorkflow = useCallback(
    (duration: number) => {
      const container = containerRef.current
      if (!container) return
      const top = viewportInset?.top ?? 0
      const bottom = viewportInset?.bottom ?? 0
      const width = container.clientWidth
      const height = container.clientHeight - top - bottom
      if (width <= 0 || height <= 0) return
      const bounds = workflowBounds(builtBlocks)
      const zoom = Math.min(
        FIT_MAX_ZOOM,
        Math.max(
          FIT_MIN_ZOOM,
          Math.min(
            (width - 2 * FIT_PADDING_PX) / bounds.width,
            (height - 2 * FIT_PADDING_PX) / bounds.height
          )
        )
      )
      void setViewport(
        {
          x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
          y: top + (height - bounds.height * zoom) / 2 - bounds.y * zoom,
          zoom,
        },
        { duration: reducedMotion ? 0 : duration }
      )
    },
    [builtBlocks, reducedMotion, setViewport, viewportInset]
  )

  const scriptedFittedRef = useRef(false)
  /**
   * A scripted canvas stays invisible until its first fit has landed. React
   * Flow paints its default viewport first and ignores a fit that arrives
   * before its zoom is initialised, which would show the first card at the
   * stage's left edge until the next fit carried it into place. Even a
   * zero-duration fit is applied through a d3 transition on the next
   * animation frame, so the reveal waits two frames for it to reach the DOM.
   */
  const [fitted, setFitted] = useState(!scripted)
  const revealFrameRef = useRef(0)
  const handleInit = useCallback(() => {
    if (!scripted) {
      if (defaultSelection) focusBlockInView(defaultSelection, 0)
      return
    }
    fitWorkflow(0)
    scriptedFittedRef.current = true
    revealFrameRef.current = requestAnimationFrame(() => {
      revealFrameRef.current = requestAnimationFrame(() => setFitted(true))
    })
  }, [defaultSelection, focusBlockInView, scripted, fitWorkflow])
  useEffect(() => () => cancelAnimationFrame(revealFrameRef.current), [])
  /**
   * The scripted camera keeps every built card in view: it opens on the first
   * card at full size and eases out as cards land, so a workflow is watched
   * growing from its Start block rather than revealed all at once. Selection
   * never moves it - the newest card is selected as it lands, in frame already.
   */
  useEffect(() => {
    if (!scripted) return
    fitWorkflow(scriptedFittedRef.current ? FIT_DURATION_MS : 0)
    scriptedFittedRef.current = true
  }, [scripted, fitWorkflow])

  useEffect(() => {
    if (!scripted || typeof ResizeObserver === 'undefined') return
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => fitWorkflow(0))
    observer.observe(container)
    return () => observer.disconnect()
  }, [scripted, fitWorkflow])

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<LandingWorkflowNodeData>) => {
      setSelectedId(node.id)
      focusBlockInView(node.id)
    },
    [focusBlockInView]
  )

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.flatMap(([source, target], index) => {
        if (!builtIds.has(source) || !builtIds.has(target)) return []
        const sourceBlock = blocks.find((block) => block.id === source)
        const conditionEdgeIndex =
          sourceBlock?.type === 'condition'
            ? edges.slice(0, index).filter(([candidate]) => candidate === source).length
            : -1
        return [
          {
            id: `${source}-${target}`,
            source,
            target,
            sourceHandle:
              conditionEdgeIndex >= 0
                ? `condition-${conditionEdgeIndex === 0 ? 'if' : 'else'}`
                : undefined,
            type: 'workflowEdge',
            selectable: false,
            data: {
              runStatus:
                completedIds.has(source) && (target === runningId || completedIds.has(target))
                  ? ('success' as const)
                  : undefined,
              isWorkflowRunning,
              isTargetActive: target === runningId,
            } satisfies LandingWorkflowEdgeData,
          },
        ]
      }),
    [blocks, builtIds, completedIds, edges, isWorkflowRunning, runningId]
  )

  const liveStatus = runningId
    ? `${blocks.find((block) => block.id === runningId)?.name ?? 'Block'} is running`
    : internalCompletedId
      ? `${blocks.find((block) => block.id === internalCompletedId)?.name ?? 'Block'} completed`
      : ''
  const interactive = !scripted

  return (
    <div
      ref={containerRef}
      inert={!interactive}
      className={cn(
        'relative size-full overflow-hidden',
        /* React Flow re-enables the pointer on nodes and handles; a scripted stage is inert throughout. */
        !interactive && '[&_*]:!pointer-events-none select-none',
        !fitted && 'opacity-0'
      )}
    >
      <ReactFlow
        colorMode={colorMode}
        onInit={handleInit}
        nodes={nodes}
        edges={flowEdges}
        onNodesChange={handleNodesChange}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        defaultViewport={{ x: 0, y: 48, zoom: FOCUSED_NODE_MIN_ZOOM }}
        panOnDrag={interactive}
        panOnScroll={false}
        preventScrolling={false}
        zoomOnPinch={interactive}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        nodesDraggable={interactive}
        nodesConnectable={false}
        elementsSelectable={interactive}
        edgesFocusable={false}
        nodesFocusable={interactive}
        selectNodesOnDrag={false}
        onNodeClick={interactive ? handleNodeClick : undefined}
        onNodeDragStart={interactive ? (_event, node) => setSelectedId(node.id) : undefined}
        proOptions={{ hideAttribution: true }}
        className={cn(
          REACT_FLOW_STYLES,
          interactive ? '[--xy-background-color:var(--bg)]' : '[--xy-background-color:transparent]'
        )}
      />
      {interactive && <CanvasZoomControls />}
      {interactive && (
        <span className='sr-only' aria-live='polite'>
          {liveStatus}
        </span>
      )}
    </div>
  )
}

/**
 * Homepage workflow demo rendered by the same pure node and edge views used by
 * the production editor. React Flow owns viewport, selection, handle geometry,
 * and edge routing; the preview only withholds mutation callbacks. With
 * `scripted` state it becomes a non-interactive stage whose selection, run
 * path, and camera a demo timeline drives.
 */
export function ProductionWorkflowStage(props: ProductionWorkflowStageProps) {
  return (
    <ReactFlowProvider>
      <ProductionWorkflowCanvas {...props} />
    </ReactFlowProvider>
  )
}
