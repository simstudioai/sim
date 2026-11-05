'use client'

import { type MouseEvent, type ReactNode, useMemo } from 'react'
import { useCanvasColorMode } from '@sim/workflow-renderer'
import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import Link from 'next/link'
import styles from '@/platform/app/(shell)/people/_components/org-chart/org-chart.module.css'
import { Avatar, Icon, IconButton, OverflowText } from '@/platform/design-system/components'
import { type ChartBranch, type PersonSummary, personHref } from '@/platform/lib/data/people'
import { plural } from '@/platform/lib/plural'

import '@xyflow/react/dist/style.css'

type ChartFocus = (memberId: string, event: MouseEvent<HTMLButtonElement>) => void

interface CardData extends Record<string, unknown> {
  person: PersonSummary
  relation: 'Manager' | 'In focus' | 'Direct report'
  reportCount?: number
  department?: string | null
  sides: readonly Position[]
  profileUrl: string
  onFocus: ChartFocus
}
type CardNode = Node<CardData, 'person'>

const CARD_WIDTH = 250
const CARD_HEIGHT = 100
const LEVEL = CARD_HEIGHT + 48
const COLUMN = CARD_WIDTH / 2 + 32
const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.6
const FIT = { padding: 0.22, minZoom: 0.45, maxZoom: 1 }

interface CardCopyProps {
  person: PersonSummary
  footer: string
  action: ReactNode
}

function CardCopy({ person, footer, action }: CardCopyProps) {
  return (
    <>
      <span className={styles.identity}>
        <Avatar name={person.name} src={person.image ?? undefined} decorative />
        <span className={styles.names}>
          <span data-type='T059'>
            <OverflowText text={person.name}>{person.name}</OverflowText>
          </span>
          <span className={styles.secondary} data-type='T050'>
            <OverflowText text={person.title || person.email}>
              {person.title || person.email}
            </OverflowText>
          </span>
        </span>
      </span>
      <span className={styles.cardFooter} data-type='T050'>
        <OverflowText text={footer}>{footer}</OverflowText>
        <span className={styles.cardAction}>{action}</span>
      </span>
    </>
  )
}

function PersonCard({ data }: NodeProps<CardNode>) {
  const { person, relation, reportCount, department, sides, profileUrl, onFocus } = data
  const focused = relation === 'In focus'
  return (
    <div className={styles.card} data-focus-card={focused || undefined}>
      {sides.map((side) => (
        <Handle
          key={side}
          type={side === Position.Bottom ? 'source' : 'target'}
          position={side}
          className={styles.handle}
        />
      ))}
      {focused ? (
        <Link
          href={profileUrl}
          className={`nodrag nopan ${styles.cardTarget}`}
          aria-label={`View profile for ${person.name}`}
        >
          <CardCopy
            person={person}
            footer={department || relation}
            action={
              <>
                View profile
                <Icon name='I037' />
              </>
            }
          />
        </Link>
      ) : (
        <>
          <button
            type='button'
            className={`nodrag nopan ${styles.cardTarget}`}
            aria-label={`Explore ${person.name}`}
            onClick={(event) => onFocus(person.memberId, event)}
          >
            <CardCopy
              person={person}
              footer={relation}
              action={
                <>
                  {reportCount === undefined ? 'Explore team' : plural(reportCount, 'report')}
                  <Icon name='I032' />
                </>
              }
            />
          </button>
          <span className={`nodrag nopan ${styles.profileLink}`}>
            <IconButton
              tooltip
              render={<Link href={profileUrl} prefetch={false} />}
              label={`Open ${person.name}’s profile`}
              icon='I037'
            />
          </span>
        </>
      )}
    </div>
  )
}

function ReportingLine({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const direction = Math.sign(targetX - sourceX)
  const radius = Math.min(9, Math.abs(targetX - sourceX), Math.abs(targetY - sourceY))
  const path =
    direction === 0
      ? `M ${sourceX} ${sourceY} V ${targetY}`
      : `M ${sourceX} ${sourceY} V ${targetY - radius} Q ${sourceX} ${targetY} ${sourceX + direction * radius} ${targetY} H ${targetX}`
  return <BaseEdge path={path} interactionWidth={0} />
}

const NODE_TYPES = { person: PersonCard }
const EDGE_TYPES = { reporting: ReportingLine }

function ChartControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((state) => state.transform[2])
  return (
    <Panel position='bottom-right' className={styles.controls}>
      <IconButton
        tooltip
        variant='floating'
        label='Zoom out'
        icon='I138'
        disabled={zoom <= MIN_ZOOM}
        onClick={() => void zoomOut()}
      />
      <IconButton
        tooltip
        variant='floating'
        label='Zoom in'
        icon='I074'
        disabled={zoom >= MAX_ZOOM}
        onClick={() => void zoomIn()}
      />
      <IconButton
        tooltip
        variant='floating'
        label='Fit chart'
        icon='I060'
        onClick={() => void fitView(FIT)}
      />
    </Panel>
  )
}

interface ChartCanvasProps {
  organizationId: string
  branch: ChartBranch
  profileQuery: string
  onFocus: ChartFocus
}

/** The branch on a pannable, zoomable canvas: the manager, the person in focus, a page of reports. */
export function ChartCanvas({ organizationId, branch, profileQuery, onFocus }: ChartCanvasProps) {
  const colorMode = useCanvasColorMode()
  const { person, reports, chain } = branch
  const { nodes, edges } = useMemo(() => {
    const nodes: CardNode[] = []
    const edges: Edge[] = []
    const addCard = (
      member: PersonSummary,
      relation: CardData['relation'],
      x: number,
      y: number,
      sides: readonly Position[],
      reportCount?: number,
      department?: string | null
    ) => {
      nodes.push({
        id: member.memberId,
        type: 'person',
        position: { x: x - CARD_WIDTH / 2, y },
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        data: {
          person: member,
          relation,
          reportCount,
          department,
          sides,
          profileUrl: personHref(organizationId, member.memberId, profileQuery),
          onFocus,
        },
      })
    }
    const connect = (source: string, target: string) =>
      edges.push({ id: `${source}/${target}`, source, target, type: 'reporting' })
    const manager = chain[0]
    if (manager) {
      addCard(manager, 'Manager', 0, -LEVEL, [Position.Bottom])
      connect(manager.memberId, person.memberId)
    }
    addCard(
      person,
      'In focus',
      0,
      0,
      [...(manager ? [Position.Top] : []), ...(reports.length ? [Position.Bottom] : [])],
      undefined,
      person.department
    )
    reports.forEach((report, index) => {
      const single = reports.length === 1
      const left = index % 2 === 0
      addCard(
        report,
        'Direct report',
        single ? 0 : left ? -COLUMN : COLUMN,
        LEVEL + Math.floor(index / 2) * (CARD_HEIGHT + 24),
        [single ? Position.Top : left ? Position.Right : Position.Left],
        report.reportCount
      )
      connect(person.memberId, report.memberId)
    })
    return { nodes, edges }
  }, [organizationId, person, chain, reports, profileQuery, onFocus])

  return (
    <div className={styles.canvas}>
      <div className={styles.flow}>
        <ReactFlow
          colorMode={colorMode}
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
    </div>
  )
}
