'use client'

import { type ComponentType, type ReactNode, useEffect, useState } from 'react'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OverflowText,
  Tooltip,
} from '@sim/emcn'
import { ArrowLeft, ArrowRight, Branch, Plus } from '@sim/emcn/icons'
import {
  BLOCK_DIMENSIONS,
  CONNECTION_KNOB_PEAK_PX,
  useCanvasColorMode,
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '@sim/workflow-renderer'
import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { EnvironmentColumn } from '@/app/o/[organizationId]/p/components/environments/mapping-model'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'

const NODE_WIDTH = BLOCK_DIMENSIONS.FIXED_WIDTH
const NODE_HEIGHT = BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT
const COLUMN_GAP = 120
const ROW_GAP = 40
/** The canvas sizes a side port to half its card's height. */
const PORT_LENGTH = NODE_HEIGHT / 2
/** Zoom when an environment is focused. */
const FOCUS_ZOOM = 1.1
const FIT_PADDING = 0.2
const VIEWPORT_DURATION_MS = 400
/** The action swell's height above a card's top edge. */
const ACTION_MENU_HEIGHT = 28
const ACTION_MENU_RIGHT_INSET = 24
const ACTION_MENU_AMPLITUDE = 7
/** The canvas's gap between actions and the swell's horizontal padding. */
const ACTION_GAP = 2
const ACTION_MENU_PADDING = 6

type ActionShape = 'first' | 'middle' | 'last' | 'only'

/** The swell's buttons; the end ones follow its sloped shoulders. */
const ACTION_SHAPES: Record<ActionShape, { width: number; className: string }> = {
  first: {
    width: 40,
    className:
      "!w-[40px] [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L36_24A4_4_0_0_0_40_20L40_4A4_4_0_0_0_36_0Z')] [&>svg]:translate-x-[6px] [&>svg]:translate-y-px",
  },
  middle: { width: 24, className: '' },
  last: {
    width: 40,
    className:
      "!w-[40px] [clip-path:path('M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z')] [&_svg]:-translate-x-[6px] [&_svg]:translate-y-px",
  },
  only: {
    width: 56,
    className:
      "!w-[56px] [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L50.66_24A2.5_2.5_0_0_0_52.59_19.9L38.4_2.88A8_8_0_0_0_32.25_0Z')] [&>svg]:translate-y-px",
  },
}

function actionShape(index: number, count: number): ActionShape {
  if (count === 1) return 'only'
  if (index === 0) return 'first'
  return index === count - 1 ? 'last' : 'middle'
}

interface PullSource {
  id: string
  label: string
  onSelect: () => void
}

interface SwellAction {
  id: string
  icon: ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  /** Opens a menu of choices instead of acting directly. */
  menu?: PullSource[]
}

/** Pushing or pulling a fork against the environment it was forked from. */
interface EnvironmentSyncActions {
  parentLabel: string
  onSync: (direction: ForkDirection) => void
}

interface EnvironmentNodeData extends Record<string, unknown> {
  column: EnvironmentColumn
  /** Other environments were forked from this one: an input port on the left. */
  hasForks: boolean
  /** This environment was forked from another: an output port on the right. */
  hasParent: boolean
  selected: boolean
  /** Present when the viewer can sync this fork with its parent. */
  sync?: EnvironmentSyncActions
  /** Present when the viewer can fork this environment. */
  onFork?: () => void
  /** For the root: the forks that can pull from it, each running that fork's pull. */
  pullInto: PullSource[]
}

interface LineageEdgeData extends Record<string, unknown> {
  /** An endpoint is the selected environment. */
  connectedToSelection: boolean
}

type EnvironmentNode = Node<EnvironmentNodeData, 'environment'>
type LineageEdge = Edge<LineageEdgeData, 'lineage'>

interface SyncActionProps {
  shape: ActionShape
  icon: ComponentType<{ className?: string }>
  label: string
  selected: boolean
  onClick?: () => void
  menu?: PullSource[]
}

function SwellButton({ shape, icon: Icon, label, selected, onClick, menu }: SyncActionProps) {
  const button = (
    <Button
      type='button'
      variant='ghost'
      size={null}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
      className={cn(
        'size-[24px] rounded-md border-none bg-transparent p-0 text-[var(--text-icon)] transition-[background-color,color,opacity,transform] duration-150 hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]! active:scale-[0.96] dark:hover-hover:bg-[var(--surface-4)]',
        selected &&
          'text-[var(--surface-2)] hover-hover:bg-[var(--surface-2)] hover-hover:text-[var(--text-primary)]!',
        ACTION_SHAPES[shape].className
      )}
    >
      <Icon className='size-[14px]' />
    </Button>
  )
  if (menu) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        <DropdownMenuContent align='center'>
          {menu.map((source) => (
            <DropdownMenuItem key={source.id} onSelect={source.onSelect}>
              Into {source.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  return (
    <Tooltip.Root preferAbove>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Content side='top'>{label}</Tooltip.Content>
    </Tooltip.Root>
  )
}

function EnvironmentNodeView({ data }: NodeProps<EnvironmentNode>) {
  const [actionMenuReady, setActionMenuReady] = useState(false)
  const swellActions: SwellAction[] = [
    ...(data.sync
      ? [
          {
            id: 'pull',
            icon: ArrowLeft,
            label: `Pull from ${data.sync.parentLabel}`,
            onClick: () => data.sync?.onSync('pull'),
          },
          {
            id: 'push',
            icon: ArrowRight,
            label: `Push to ${data.sync.parentLabel}`,
            onClick: () => data.sync?.onSync('push'),
          },
        ]
      : data.pullInto.length === 1
        ? [
            {
              id: 'pull',
              icon: ArrowLeft,
              label: `Pull into ${data.pullInto[0].label}`,
              onClick: data.pullInto[0].onSelect,
            },
          ]
        : data.pullInto.length > 1
          ? [{ id: 'pull', icon: ArrowLeft, label: 'Pull into a fork', menu: data.pullInto }]
          : []),
    ...(data.onFork
      ? [{ id: 'fork', icon: Plus, label: `Fork ${data.column.label}`, onClick: data.onFork }]
      : []),
  ]
  const swellWidth =
    swellActions.reduce(
      (width, _, index) => width + ACTION_SHAPES[actionShape(index, swellActions.length)].width,
      0
    ) +
    ACTION_GAP * Math.max(0, swellActions.length - 1) +
    ACTION_MENU_PADDING
  const ports: WorkflowBorderPort[] = [
    ...(data.hasForks
      ? [{ id: 'forks', side: 'left' as const, position: 'center' as const, plateau: PORT_LENGTH }]
      : []),
    ...(data.hasParent
      ? [
          {
            id: 'parent',
            side: 'right' as const,
            position: 'center' as const,
            plateau: PORT_LENGTH,
          },
        ]
      : []),
    ...(swellActions.length
      ? [
          {
            id: 'action-menu',
            side: 'top' as const,
            position: { fromEnd: ACTION_MENU_RIGHT_INSET + swellWidth / 2 },
            plateau: swellWidth,
            restAmplitude: ACTION_MENU_AMPLITUDE,
            hoverAmplitude: ACTION_MENU_AMPLITUDE,
            magnetizable: false,
          },
        ]
      : []),
  ]
  return (
    <div
      className='nopan group relative cursor-pointer select-none rounded-2xl'
      style={{ width: NODE_WIDTH }}
      data-node-selected={data.selected ? '' : undefined}
      data-action-menu-ready={actionMenuReady ? '' : undefined}
    >
      {swellActions.length ? (
        <div
          className='pointer-events-none absolute z-40 flex items-center gap-[2px] overflow-hidden rounded-lg px-[0.2rem] py-0.5 opacity-0 transition-opacity duration-100 group-data-[action-menu-ready]:pointer-events-auto group-data-[action-menu-ready]:opacity-100'
          style={{
            top: -ACTION_MENU_HEIGHT,
            right: ACTION_MENU_RIGHT_INSET,
            height: ACTION_MENU_HEIGHT,
            width: swellWidth,
          }}
        >
          {swellActions.map((action, index) => (
            <SwellButton
              key={action.id}
              shape={actionShape(index, swellActions.length)}
              icon={action.icon}
              label={action.label}
              selected={data.selected}
              onClick={action.onClick}
              menu={action.menu}
            />
          ))}
        </div>
      ) : null}
      <WorkflowBlockBorder
        ports={ports}
        hasRing={false}
        isSelected={data.selected}
        ringStyles=''
        cursorSwellEnabled={false}
        canStartConnection={false}
        canReceiveConnection={false}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        onActionMenuReadyChange={setActionMenuReady}
      />
      <div className='relative flex items-center gap-2 px-3' style={{ height: NODE_HEIGHT }}>
        <span className='flex size-[18px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-5)]'>
          <Branch className='size-[11px] text-[var(--text-icon)]' />
        </span>
        <OverflowText label={data.column.name} className='text-[var(--text-body)] text-small' />
      </div>
      <Handle
        type='target'
        position={Position.Left}
        isConnectable={false}
        className='opacity-0'
        style={{ left: -CONNECTION_KNOB_PEAK_PX }}
      />
      <Handle
        type='source'
        position={Position.Right}
        isConnectable={false}
        className='opacity-0'
        style={{ right: -CONNECTION_KNOB_PEAK_PX }}
      />
    </div>
  )
}

function LineageEdgeView({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<LineageEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    offset: 30,
  })
  return (
    <BaseEdge
      path={path}
      interactionWidth={0}
      style={{
        stroke: data?.connectedToSelection ? 'var(--text-secondary)' : 'var(--workflow-edge)',
        strokeWidth: 1.5,
      }}
    />
  )
}

const NODE_TYPES = { environment: EnvironmentNodeView }
const EDGE_TYPES = { lineage: LineageEdgeView }

/**
 * Lays forks out in columns that flow right into their parent: leaves take successive rows and
 * each parent centres on its children, so every fork-to-parent edge reads left to right.
 */
function layout(columns: readonly EnvironmentColumn[]) {
  const known = new Set(columns.map((column) => column.id))
  const childrenOf = new Map<string | null, EnvironmentColumn[]>()
  for (const column of columns) {
    const key = column.parentId && known.has(column.parentId) ? column.parentId : null
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), column])
  }
  const depthOf = new Map<string, number>()
  const rowOf = new Map<string, number>()
  let nextRow = 0
  const place = (column: EnvironmentColumn, depth: number): number => {
    depthOf.set(column.id, depth)
    const children = childrenOf.get(column.id) ?? []
    const row = children.length
      ? children.reduce((sum, child) => sum + place(child, depth + 1), 0) / children.length
      : nextRow++
    rowOf.set(column.id, row)
    return row
  }
  for (const root of childrenOf.get(null) ?? []) place(root, 0)
  const maxDepth = Math.max(0, ...depthOf.values())
  const positions = new Map(
    columns.map((column) => [
      column.id,
      {
        x: (maxDepth - (depthOf.get(column.id) ?? 0)) * (NODE_WIDTH + COLUMN_GAP),
        y: (rowOf.get(column.id) ?? 0) * (NODE_HEIGHT + ROW_GAP),
      },
    ])
  )
  return {
    positions,
    width: (maxDepth + 1) * NODE_WIDTH + maxDepth * COLUMN_GAP,
    height: Math.max(1, nextRow) * NODE_HEIGHT + Math.max(0, nextRow - 1) * ROW_GAP,
  }
}

interface EnvironmentGraphProps {
  columns: readonly EnvironmentColumn[]
  /** The focused environment; the canvas zooms to it and the sheet describes it. */
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Forks the viewer can push to and pull from their parent. */
  syncableIds: ReadonlySet<string>
  onSync: (childId: string, direction: ForkDirection) => void
  /** Environments the viewer can fork. */
  forkableIds: ReadonlySet<string>
  onFork: (sourceId: string) => void
  /** Details of the selected environment, raised from the bottom of the canvas. */
  sheet: ReactNode
  /** Status shown over the canvas's top edge. */
  notice?: ReactNode
}

function Graph({
  columns,
  selectedId,
  onSelect,
  syncableIds,
  onSync,
  forkableIds,
  onFork,
  sheet,
  notice,
}: EnvironmentGraphProps) {
  const colorMode = useCanvasColorMode()
  const { fitView, setCenter } = useReactFlow()
  const [sheetElement, setSheetElement] = useState<HTMLDivElement | null>(null)
  const [sheetHeight, setSheetHeight] = useState(0)
  const { positions } = layout(columns)
  const byId = new Map(columns.map((column) => [column.id, column]))
  const selectedPosition = selectedId ? positions.get(selectedId) : undefined

  useEffect(() => {
    if (!sheetElement) return
    const observer = new ResizeObserver(([entry]) => setSheetHeight(entry.contentRect.height))
    observer.observe(sheetElement)
    return () => observer.disconnect()
  }, [sheetElement])

  /** Focus centers the environment in the space above the sheet; clearing it fits everything. */
  useEffect(() => {
    if (!selectedPosition) {
      void fitView({ padding: FIT_PADDING, maxZoom: 1, duration: VIEWPORT_DURATION_MS })
      return
    }
    void setCenter(
      selectedPosition.x + NODE_WIDTH / 2,
      selectedPosition.y + NODE_HEIGHT / 2 + sheetHeight / 2 / FOCUS_ZOOM,
      { zoom: FOCUS_ZOOM, duration: VIEWPORT_DURATION_MS }
    )
  }, [selectedPosition?.x, selectedPosition?.y, sheetHeight, fitView, setCenter])

  const nodes: EnvironmentNode[] = columns.map((column) => {
    const parent = column.parentId ? byId.get(column.parentId) : undefined
    return {
      id: column.id,
      type: 'environment',
      position: positions.get(column.id) ?? { x: 0, y: 0 },
      data: {
        column,
        hasForks: columns.some((candidate) => candidate.parentId === column.id),
        hasParent: Boolean(parent),
        selected: column.id === selectedId,
        sync:
          parent && syncableIds.has(column.id)
            ? {
                parentLabel: parent.label,
                onSync: (direction: ForkDirection) => onSync(column.id, direction),
              }
            : undefined,
        onFork: forkableIds.has(column.id) ? () => onFork(column.id) : undefined,
        pullInto: parent
          ? []
          : columns
              .filter(
                (candidate) => candidate.parentId === column.id && syncableIds.has(candidate.id)
              )
              .map((fork) => ({
                id: fork.id,
                label: fork.label,
                onSelect: () => onSync(fork.id, 'pull'),
              })),
      },
    }
  })
  const edges: LineageEdge[] = columns.flatMap((column) => {
    const parent = column.parentId ? byId.get(column.parentId) : undefined
    if (!parent) return []
    return [
      {
        id: `${column.id}->${parent.id}`,
        source: column.id,
        target: parent.id,
        type: 'lineage',
        data: { connectedToSelection: selectedId === column.id || selectedId === parent.id },
      },
    ]
  })

  return (
    <div className='relative h-full min-h-0 w-full overflow-hidden'>
      <ReactFlow
        colorMode={colorMode}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(event, node) => {
          if ((event.target as HTMLElement).closest('button, [role="menuitem"]')) return
          onSelect(node.id === selectedId ? null : node.id)
        }}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      />
      {notice ? <div className='absolute top-4 left-6'>{notice}</div> : null}
      <div
        ref={setSheetElement}
        aria-hidden={!selectedId}
        className={cn(
          'absolute inset-x-0 bottom-0 border-[var(--border)] border-t bg-[var(--bg)] transition-transform duration-300 ease-out motion-reduce:transition-none',
          selectedId ? 'translate-y-0' : 'pointer-events-none translate-y-full'
        )}
      >
        {sheet}
      </div>
    </div>
  )
}

/** The project's environments on a pannable canvas, each block wired into the one it was forked from. */
export function EnvironmentGraph(props: EnvironmentGraphProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  )
}
