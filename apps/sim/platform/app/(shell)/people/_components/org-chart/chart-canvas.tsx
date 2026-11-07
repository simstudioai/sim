'use client'

import { type MouseEvent, type ReactNode, useMemo } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { IconButton } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { PageColumn } from '@sim/emcn-platform/page-column'
import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import Link from 'next/link'
import styles from '@/platform/app/(shell)/people/_components/org-chart/org-chart.module.css'
import { usePeoplePath } from '@/platform/lib/data/people'
import { type ChartBranch, type PersonSummary, personHref } from '@/platform/shared/people'
import { plural } from '@/platform/shared/plural'

import '@xyflow/react/dist/style.css'

type ChartFocus = (memberId: string, event: MouseEvent<HTMLButtonElement>) => void

interface PersonCardData extends Record<string, unknown> {
  person: PersonSummary
  footer: string
  focused: boolean
  compact: boolean
  hasManagerLine: boolean
  hasReportLine: boolean
  profileHref: string
  onFocus: ChartFocus
}

type PersonCardNode = Node<PersonCardData, 'person'>

const CARD_WIDTH = 224
const CARD_HEIGHT = 184
const COMPACT_WIDTH = 310
const COMPACT_HEIGHT = 76
const COLUMN_STEP = 240
const MANAGER_GAP = 32
const REPORT_GAP = 52
const REPORT_BUS_DROP = 28
const LINE_RADIUS = 8
const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.6
const FIT = { padding: 0.08, minZoom: 0.45, maxZoom: 1 }

function PersonCard({ data }: NodeProps<PersonCardNode>) {
  const { person, footer, focused, compact, hasManagerLine, hasReportLine } = data
  const copy = (
    <span className={styles.names}>
      <span data-type='T042'>
        <OverflowText text={person.name}>{person.name}</OverflowText>
      </span>
      <span className={styles.secondary} data-type={compact ? 'T050' : 'T043'}>
        <OverflowText text={person.title || person.email}>
          {person.title || person.email}
        </OverflowText>
      </span>
    </span>
  )
  const lines = (
    <>
      {hasManagerLine && <Handle type='target' position={Position.Top} className={styles.port} />}
      {hasReportLine && <Handle type='source' position={Position.Bottom} className={styles.port} />}
    </>
  )
  const exploreLabel = `Explore ${person.name}`
  const explore = (event: MouseEvent<HTMLButtonElement>) => data.onFocus(person.memberId, event)
  if (compact)
    return (
      <>
        {lines}
        <button
          type='button'
          aria-label={exploreLabel}
          onClick={explore}
          className={`${styles.compactCard} nodrag nopan`}
        >
          <Avatar name={person.name} src={person.image ?? undefined} size='row' />
          {copy}
          <Icon name='I032' />
        </button>
      </>
    )
  const body = (
    <>
      <Avatar name={person.name} src={person.image ?? undefined} size='card' />
      {copy}
    </>
  )
  return (
    <div className={styles.card} data-centered={focused || undefined}>
      {lines}
      {focused ? (
        <div className={styles.cardBody}>{body}</div>
      ) : (
        <button
          type='button'
          aria-label={exploreLabel}
          onClick={explore}
          className={`${styles.cardBody} nodrag nopan`}
        >
          {body}
        </button>
      )}
      <div className={styles.cardFooter} data-type='T050'>
        <span className={styles.cardMeta}>
          <Icon name='I133' />
          {footer}
        </span>
        <Link
          href={data.profileHref}
          prefetch={false}
          className={`${styles.profileLink} nodrag nopan`}
          aria-label={`View profile for ${person.name}`}
        >
          Profile
          <Icon name='I032' />
        </Link>
      </div>
    </div>
  )
}

function ReportingLine({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const direction = Math.sign(targetX - sourceX)
  const busY = sourceY + REPORT_BUS_DROP
  const path =
    direction === 0
      ? `M ${sourceX} ${sourceY} V ${targetY}`
      : `M ${sourceX} ${sourceY} V ${busY - LINE_RADIUS} Q ${sourceX} ${busY} ${sourceX + direction * LINE_RADIUS} ${busY} H ${targetX - direction * LINE_RADIUS} Q ${targetX} ${busY} ${targetX} ${busY + LINE_RADIUS} V ${targetY}`
  return <BaseEdge path={path} interactionWidth={0} />
}

const NODE_TYPES = { person: PersonCard }
const EDGE_TYPES = { reporting: ReportingLine }

interface ChartControlsProps {
  compact: boolean
}

function ChartControls({ compact }: ChartControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((state) => state.transform[2])
  return (
    <div className={styles.controls} data-material='floating' data-elevation='control'>
      {!compact && (
        <>
          <IconButton
            label='Zoom out'
            icon='I134'
            disabled={zoom <= MIN_ZOOM}
            onClick={() => void zoomOut()}
          />
          <span className={styles.zoomLevel} data-type='T005'>
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            label='Zoom in'
            icon='I074'
            disabled={zoom >= MAX_ZOOM}
            onClick={() => void zoomIn()}
          />
          <span className={styles.controlsRule} aria-hidden='true' />
        </>
      )}
      <IconButton label='Fit chart' icon='I060' onClick={() => void fitView(FIT)} />
    </div>
  )
}

function chartGraph(
  { person, chain, reports, totalReports }: ChartBranch,
  peoplePath: string,
  profileQuery: string,
  compact: boolean,
  onFocus: ChartFocus
) {
  const nodes: PersonCardNode[] = []
  const edges: Edge[] = []
  const add = (
    member: PersonSummary,
    footer: string,
    x: number,
    y: number,
    lines: Pick<PersonCardData, 'focused' | 'compact' | 'hasManagerLine' | 'hasReportLine'>
  ) => {
    const width = lines.compact ? COMPACT_WIDTH : CARD_WIDTH
    nodes.push({
      id: member.memberId,
      type: 'person',
      position: { x: x - width / 2, y },
      width,
      height: lines.compact ? COMPACT_HEIGHT : CARD_HEIGHT,
      data: {
        person: member,
        footer,
        ...lines,
        profileHref: personHref(peoplePath, member.memberId, profileQuery),
        onFocus,
      },
    })
  }
  const connect = (source: string, target: string) =>
    edges.push({ id: `${source}/${target}`, source, target, type: 'reporting' })

  const [manager] = chain
  if (manager) {
    const height = compact ? COMPACT_HEIGHT : CARD_HEIGHT
    add(manager, 'Manager', 0, -(height + MANAGER_GAP), {
      focused: false,
      compact,
      hasManagerLine: false,
      hasReportLine: true,
    })
    connect(manager.memberId, person.memberId)
  }
  add(person, totalReports ? plural(totalReports, 'report') : 'No reports', 0, 0, {
    focused: true,
    compact: false,
    hasManagerLine: Boolean(manager),
    hasReportLine: reports.length > 0,
  })
  reports.forEach((report, index) => {
    add(
      report,
      report.reportCount ? plural(report.reportCount, 'report') : 'No reports',
      (index - (reports.length - 1) / 2) * COLUMN_STEP,
      CARD_HEIGHT + REPORT_GAP,
      { focused: false, compact: false, hasManagerLine: true, hasReportLine: false }
    )
    connect(person.memberId, report.memberId)
  })
  return { nodes, edges }
}

interface ChartCanvasProps {
  branch: ChartBranch
  profileQuery: string
  compact: boolean
  onFocus: ChartFocus
  /** The report pager, between the canvas and its controls. */
  pager?: ReactNode
}

/**
 * The manager, the person in focus and a page of their reports, on a canvas a viewer can pan and
 * zoom. Remount it per branch: the first fit is what centers each new set of cards.
 */
export function ChartCanvas({ branch, profileQuery, compact, onFocus, pager }: ChartCanvasProps) {
  const peoplePath = usePeoplePath()
  const { nodes, edges } = useMemo(
    () => chartGraph(branch, peoplePath, profileQuery, compact, onFocus),
    [branch, peoplePath, profileQuery, compact, onFocus]
  )
  return (
    <ReactFlowProvider>
      <div className={styles.canvas}>
        <div className={styles.flowFrame}>
          <ReactFlow
            className={styles.flow}
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
          />
        </div>
      </div>
      <PageColumn>
        <div className={styles.footer}>
          {pager}
          <ChartControls compact={compact} />
        </div>
      </PageColumn>
    </ReactFlowProvider>
  )
}
