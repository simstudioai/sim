'use client'

import { type MouseEvent, useMemo } from 'react'
import { Avatar, cn, OverflowText, Tooltip } from '@sim/emcn'
import { ArrowUpRight, ChevronRight, Minus, Plus } from '@sim/emcn/icons'
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
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import Link from 'next/link'
import { CanvasToolbar, CanvasToolbarButton } from '@/components/canvas-toolbar'
import type { ChartBranch, PersonSummary } from '@/lib/api/contracts/people'
import { organizationRoutes } from '@/lib/navigation/paths'

import '@xyflow/react/dist/style.css'

type CardData = {
  person: PersonSummary
  relation: 'Manager' | 'In focus' | 'Direct report'
  department?: string | null
  reportCount?: number
  ports: WorkflowBorderPort[]
  profileUrl: string
  onFocus: (id: string, event: MouseEvent<HTMLButtonElement>) => void
}
type CardNode = Node<CardData, 'person'>
const PORT_POSITIONS = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
} as const
const WIDTH = BLOCK_DIMENSIONS.FIXED_WIDTH
const HEIGHT = BLOCK_DIMENSIONS.MIN_HEIGHT
const LEVEL = HEIGHT + 48
const COLUMN = WIDTH / 2 + 32

function PersonCard({ data }: NodeProps<CardNode>) {
  const { person, relation, reportCount, department, onFocus, profileUrl, ports } = data
  const focused = relation === 'In focus'
  const contents = (
    <>
      <WorkflowBlockBorder
        ports={ports}
        hasRing={false}
        ringStyles=''
        isSelected={focused}
        width={WIDTH}
        height={HEIGHT}
        bodyFill='var(--person-card-fill)'
        cursorSwellEnabled={false}
      />
      <span className='relative flex flex-1 items-center gap-2.5 px-3'>
        <Avatar size='md' name={person.name} src={person.image} aria-hidden />
        <span className={cn('flex min-w-0 flex-col gap-0.5', !focused && 'pr-5')}>
          <OverflowText
            label={person.name}
            focusTarget='nearest-interactive'
            className='font-medium text-[var(--text-primary)] text-base'
          />
          <OverflowText
            label={person.title || person.email}
            className='text-[var(--text-secondary)] text-small'
          />
        </span>
      </span>
      <span className='relative mx-3 flex h-8 min-w-0 shrink-0 items-center justify-between gap-2 border-[var(--border)] border-t text-[var(--text-secondary)] text-caption'>
        <OverflowText label={focused ? department || relation : relation} />
        <span className='flex shrink-0 items-center gap-1 text-[var(--text-body)]'>
          {focused ? (
            <>
              View profile
              <ArrowUpRight className='size-3.5' />
            </>
          ) : (
            <>
              {reportCount === undefined
                ? 'Explore team'
                : `${reportCount} report${reportCount === 1 ? '' : 's'}`}
              <ChevronRight className='size-3.5' />
            </>
          )}
        </span>
      </span>
    </>
  )
  const actionClass =
    'nodrag nopan pointer-events-auto relative flex size-full cursor-pointer flex-col rounded-2xl bg-[var(--person-card-fill)] text-left outline-offset-2 [--person-card-fill:var(--surface-2)] hover-hover:[--person-card-fill:var(--surface-1)] focus-visible:outline-2 focus-visible:outline-[var(--brand-secondary)] [&_[data-workflow-block-border]_path]:pointer-events-none'
  return (
    <>
      {ports.map((port) => (
        <Handle
          key={port.id}
          type={port.side === Position.Bottom ? 'source' : 'target'}
          position={PORT_POSITIONS[port.side]}
          style={{ [port.side]: -CONNECTION_KNOB_PEAK_PX }}
          className='pointer-events-none size-0! min-h-0! min-w-0! border-0! opacity-0'
        />
      ))}
      {focused ? (
        <Link
          href={profileUrl}
          className={actionClass}
          aria-label={`View profile for ${person.name}`}
        >
          {contents}
        </Link>
      ) : (
        <>
          <button
            type='button'
            className={actionClass}
            onClick={(event) => onFocus(person.memberId, event)}
            aria-label={`Explore ${person.name}`}
          >
            {contents}
          </button>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Link
                href={profileUrl}
                className='nodrag nopan pointer-events-auto absolute top-2 right-2 flex pointer-coarse:size-11 size-6 items-center justify-center rounded-sm text-[var(--text-icon)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand-secondary)]'
                prefetch={false}
                aria-label={`Open ${person.name}’s profile`}
              >
                <ArrowUpRight className='size-[14px]' />
              </Link>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>View profile</Tooltip.Content>
          </Tooltip.Root>
        </>
      )}
    </>
  )
}

function ReportingLine({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const direction = Math.sign(targetX - sourceX)
  const radius = Math.min(9, Math.abs(targetX - sourceX), Math.abs(targetY - sourceY))
  const path =
    direction === 0
      ? `M ${sourceX} ${sourceY} V ${targetY}`
      : `M ${sourceX} ${sourceY} V ${targetY - radius} Q ${sourceX} ${targetY} ${sourceX + direction * radius} ${targetY} H ${targetX}`
  return (
    <BaseEdge
      path={path}
      className='stroke-[1.5]! stroke-[var(--text-placeholder)]!'
      interactionWidth={0}
    />
  )
}

const NODE_TYPES = { person: PersonCard }
const EDGE_TYPES = { reporting: ReportingLine }
const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.6
const FIT = { padding: 0.22, minZoom: 0.45, maxZoom: 1 }

function ChartControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((state) => state.transform[2])
  return (
    <CanvasToolbar fitLabel='Fit chart' onFit={() => void fitView(FIT)}>
      <CanvasToolbarButton
        label='Zoom out'
        icon={Minus}
        disabled={zoom <= MIN_ZOOM}
        onClick={() => void zoomOut()}
      />
      <CanvasToolbarButton
        label='Zoom in'
        icon={Plus}
        disabled={zoom >= MAX_ZOOM}
        onClick={() => void zoomIn()}
      />
    </CanvasToolbar>
  )
}

interface ChartCanvasProps {
  profileQuery: string
  organizationId: string
  branch: ChartBranch
  onFocus: CardData['onFocus']
}

export function ChartCanvas({ organizationId, branch, onFocus, profileQuery }: ChartCanvasProps) {
  const colorMode = useCanvasColorMode()
  const { person, reports, chain } = branch
  const { nodes, edges } = useMemo(() => {
    const routes = organizationRoutes(organizationId)
    const nodes: CardNode[] = []
    const edges: Edge[] = []
    function addCard(
      member: PersonSummary,
      relation: CardData['relation'],
      x: number,
      y: number,
      sides: Position[],
      reportCount?: number,
      department?: string | null
    ) {
      nodes.push({
        id: member.memberId,
        type: 'person',
        position: { x: x - WIDTH / 2, y },
        width: WIDTH,
        height: HEIGHT,
        data: {
          person: member,
          relation,
          ports: sides.map((side) => ({
            id: side,
            side,
            position: 'center',
            plateau: 14,
            hoverAmplitude: 1,
            magnetizable: false,
          })),
          profileUrl: `${routes.person(member.memberId)}${profileQuery}`,
          reportCount,
          department,
          onFocus,
        },
      })
    }
    function connect(source: string, target: string) {
      edges.push({ id: `${source}/${target}`, source, target, type: 'reporting' })
    }
    const manager = chain[0]
    if (manager) {
      addCard(manager, 'Manager', 0, -LEVEL, [Position.Bottom])
      connect(manager.memberId, person.memberId)
    }
    const focusPorts = [
      ...(manager ? [Position.Top] : []),
      ...(reports.length ? [Position.Bottom] : []),
    ]
    addCard(person, 'In focus', 0, 0, focusPorts, undefined, person.department)
    reports.forEach((report, i) => {
      const single = reports.length === 1
      const left = i % 2 === 0
      addCard(
        report,
        'Direct report',
        single ? 0 : left ? -COLUMN : COLUMN,
        LEVEL + Math.floor(i / 2) * (HEIGHT + 24),
        [single ? Position.Top : left ? Position.Right : Position.Left],
        report.reportCount
      )
      connect(person.memberId, report.memberId)
    })
    return { nodes, edges }
  }, [organizationId, person, chain, reports, profileQuery, onFocus])

  return (
    <div className='relative min-h-0 flex-1 bg-[var(--bg)]'>
      <ReactFlow
        colorMode={colorMode}
        className='[--xy-background-color:var(--bg)]'
        aria-label='Organization chart'
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        proOptions={{ hideAttribution: true }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        fitView
        fitViewOptions={FIT}
        panOnScroll
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
      >
        <ChartControls />
      </ReactFlow>
    </div>
  )
}
