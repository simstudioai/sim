import { Chip, cn } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { EmptyState } from '@/components/empty-state/empty-state'
import { HAIRLINE } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/hairline'
import { MASK_NO_REPEAT } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/mask'

/**
 * Skeleton ink — see the `INK` note in `tables-empty-state.tsx` for why not the surface
 * ramp. `mark` is the tables selection ring's opaque mix, so the release moving through
 * the pipeline reads as the one drawn thing rather than more placeholder.
 */
const INK = {
  title: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  detail: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
  mark: 'color-mix(in srgb, var(--text-secondary) 46%, var(--bg))',
} as const

/** The logs feed's falloff — each stage's deploy history is the same repeating structure. */
const PIPELINE_FADE =
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_50%,transparent_100%)] [mask-image:linear-gradient(to_bottom,#000_50%,transparent_100%)]'

interface Stage {
  x: number
  title: number
  /** Whether the newest release has reached this stage yet. */
  current: boolean
  history: readonly number[]
}

/** Dev and staging carry the newest release; production still runs the one before it. */
const STAGES: readonly Stage[] = [
  { x: 0.5, title: 30, current: true, history: [44, 36, 50] },
  { x: 103, title: 42, current: true, history: [38, 48, 34] },
  { x: 205.5, title: 50, current: false, history: [46, 40, 52] },
] as const

/** The release is held at the furthest stage it has reached. */
const HELD_INDEX = STAGES.map((stage) => stage.current).lastIndexOf(true)

const CARD_TOP = 8
const CARD_WIDTH = 80
const CARD_HEIGHT = 54
const CONNECTOR_Y = CARD_TOP + CARD_HEIGHT / 2
const HISTORY_TOP = 80
const HISTORY_PITCH = 20

interface ConnectorProps {
  from: number
  to: number
  promoted: boolean
}

/** A promotion between stages: solid once the release has crossed it, dashed while it waits. */
function Connector({ from, to, promoted }: ConnectorProps) {
  const x1 = from + 5
  const x2 = to - 5
  const stroke = promoted ? INK.mark : INK.title
  return (
    <g stroke={stroke} strokeWidth={1.4} strokeLinecap='round' strokeLinejoin='round'>
      <path d={`M ${x1} ${CONNECTOR_Y} H ${x2}`} strokeDasharray={promoted ? undefined : '2 3'} />
      <path
        d={`M ${x2 - 3.5} ${CONNECTOR_Y - 3.5} L ${x2} ${CONNECTOR_Y} L ${x2 - 3.5} ${CONNECTOR_Y + 3.5}`}
      />
    </g>
  )
}

interface StageCardProps {
  stage: Stage
  isHeld: boolean
}

function StageCard({ stage, isHeld }: StageCardProps) {
  const { x } = stage
  return (
    <g>
      <rect
        x={x}
        y={CARD_TOP}
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        rx='8'
        fill='var(--surface-2)'
        {...(isHeld ? { stroke: INK.mark, strokeWidth: 1.5 } : HAIRLINE)}
      />
      <circle cx={x + 13} cy={CARD_TOP + 14} r='3' fill={stage.current ? INK.mark : INK.title} />
      <rect x={x + 22} y={CARD_TOP + 11} width={stage.title} height='6' rx='3' fill={INK.title} />
      <rect
        x={x + 10}
        y={CARD_TOP + 28}
        width='40'
        height='14'
        rx='7'
        fill={stage.current ? 'var(--surface-2)' : INK.detail}
        stroke={stage.current ? INK.mark : 'none'}
        strokeWidth={1.3}
      />
      <rect
        x={x + 18}
        y={CARD_TOP + 33}
        width='24'
        height='4'
        rx='2'
        fill={stage.current ? INK.mark : INK.title}
      />
      {stage.history.map((width, index) => {
        const y = HISTORY_TOP + index * HISTORY_PITCH
        return (
          <g key={y}>
            <circle cx={x + 13} cy={y + 2} r='2' fill={INK.title} />
            <rect x={x + 22} y={y} width={width} height='4' rx='2' fill={INK.detail} />
          </g>
        )
      })}
    </g>
  )
}

/**
 * A release pipeline: dev → staging → production, the newest release held at staging
 * with its promotion to production still pending.
 */
function EnvironmentsGraphic() {
  return (
    <svg
      viewBox='0 0 286 148'
      width={286}
      height={148}
      fill='none'
      aria-hidden='true'
      focusable='false'
      className={cn('block max-w-none shrink-0', PIPELINE_FADE, MASK_NO_REPEAT)}
    >
      {STAGES.slice(1).map((stage, index) => (
        <Connector
          key={stage.x}
          from={STAGES[index].x + CARD_WIDTH}
          to={stage.x}
          promoted={stage.current}
        />
      ))}
      {STAGES.map((stage, index) => (
        <StageCard key={stage.x} stage={stage} isHeld={index === HELD_INDEX} />
      ))}
    </svg>
  )
}

interface EnvironmentsEmptyStateProps {
  /** Creates an environment — the same action the header's primary chip runs. */
  onCreate: () => void
  /** Mirrors the header chip's disabled state: no edit rights, or a create already in flight. */
  createDisabled?: boolean
}

/** Empty state for a workspace with no deployment environments yet. */
export function EnvironmentsEmptyState({ onCreate, createDisabled }: EnvironmentsEmptyStateProps) {
  return (
    <EmptyState
      graphic={<EnvironmentsGraphic />}
      title='Environments'
      description='Promote each deployment from one environment to the next.'
      action={
        <Chip variant='primary' onClick={onCreate} disabled={createDisabled} leftIcon={Plus}>
          New environment
        </Chip>
      }
    />
  )
}
