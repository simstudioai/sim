'use client'

import { memo } from 'react'
import {
  BookOpen,
  Check,
  Database,
  File as FileIcon,
  Loader,
  Lock,
  Search,
  Wrench,
  X,
} from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  type ActivityArtifact,
  type ActivityItem,
  type ActivityModel,
  type ActivityState,
  type Actor,
  isTurnInFlight,
  MOTHERSHIP_ACTOR_ID,
  type SceneKind,
  type VerbFamily,
} from './activity-model'
import { agentIdentity, artifactIcon, SCENE_ACCENT } from './agent-identity'

const SCENE_STATUS: Record<SceneKind, string> = {
  idle: 'Idle',
  thinking: 'Thinking…',
  'workflow-build': 'Building workflow…',
  deploy: 'Deploying…',
  authoring: 'Writing…',
  research: 'Researching…',
  data: 'Working with data…',
  knowledge: 'Building knowledge…',
  execution: 'Running…',
  debug: 'Debugging…',
  connect: 'Connecting…',
  code: 'Writing code…',
  'tool-build': 'Building a tool…',
  job: 'Running a job…',
  composite: 'Working on several things…',
}

const FAMILY_ICON: Record<VerbFamily, React.ComponentType<{ className?: string }>> = {
  search: Search,
  read: BookOpen,
  write: FileIcon,
  execute: Wrench,
  data: Database,
  connect: Lock,
  memory: BookOpen,
  housekeeping: Wrench,
  agent: Wrench,
  other: Wrench,
}

/** 6-digit hex + alpha suffix → rgba-ish tint without a color lib. */
function tint(hex: string, alpha: string): string {
  return `${hex}${alpha}`
}

function ActivityStateIcon({ state, color }: { state: ActivityState; color: string }) {
  if (state === 'success') {
    return <Check className='size-[12px]' style={{ color }} />
  }
  if (state === 'error' || state === 'rejected') {
    return <X className='size-[12px] text-[var(--text-error,var(--text-icon))]' />
  }
  if (state === 'cancelled' || state === 'skipped') {
    return <X className='size-[12px] text-[var(--text-muted)]' />
  }
  return <Loader className='size-[12px] animate-spin text-[var(--text-icon)]' />
}

function isActivityDone(state: ActivityState): boolean {
  return state !== 'generating' && state !== 'executing'
}

const ActivityChip = memo(function ActivityChip({
  activity,
  color,
}: {
  activity: ActivityItem
  color: string
}) {
  const Icon = FAMILY_ICON[activity.family]
  const done = isActivityDone(activity.state)
  return (
    <div className='flex animate-stream-fade-in items-center gap-[8px] py-[3px] pl-[30px]'>
      <Icon className='size-[12px] flex-shrink-0 text-[var(--text-icon)]' />
      <span
        className={cn(
          'flex-1 truncate text-[13px]',
          done ? 'text-[var(--text-secondary)]' : 'text-[var(--text-body)]'
        )}
      >
        {activity.verb}
      </span>
      <ActivityStateIcon state={activity.state} color={color} />
    </div>
  )
})

/** Shimmering placeholder shaped to the artifact kind, shown while it builds. */
function ArtifactSkeleton({ type }: { type: ActivityArtifact['type'] }) {
  if (type === 'table') {
    return (
      <div className='flex flex-col gap-[4px]'>
        {[0, 1, 2].map((r) => (
          <div key={r} className='flex gap-[4px]'>
            {[0, 1, 2].map((c) => (
              <div
                key={c}
                className='h-[10px] flex-1 animate-pulse rounded-[2px] bg-[var(--surface-5)]'
                style={{ animationDelay: `${(r + c) * 80}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className='flex flex-col gap-[5px]'>
      {['90%', '100%', '75%', '85%'].map((w, i) => (
        <div
          key={i}
          className='h-[8px] animate-pulse rounded-[2px] bg-[var(--surface-5)]'
          style={{ width: w, animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  )
}

const ArtifactPreview = memo(function ArtifactPreview({
  artifact,
  building,
}: {
  artifact: ActivityArtifact
  building: boolean
}) {
  const Icon = artifactIcon(artifact.type)
  const showSkeleton = building && artifact.state !== 'ready'
  return (
    <div className='mt-[4px] ml-[30px] animate-stream-fade-in overflow-hidden rounded-[8px] border border-[var(--divider)]'>
      <div className='flex items-center gap-[6px] border-[var(--divider)] border-b bg-[var(--surface-4)] px-[10px] py-[6px]'>
        <Icon className='size-[12px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='flex-1 truncate text-[12px] text-[var(--text-secondary)]'>
          {artifact.title}
        </span>
        {showSkeleton && <span className='text-[11px] text-[var(--text-muted)]'>building…</span>}
      </div>
      <div className='px-[10px] py-[8px]'>
        <ArtifactSkeleton type={artifact.type} />
      </div>
    </div>
  )
})

const ActorLane = memo(function ActorLane({
  actor,
  activities,
  artifacts,
  building,
}: {
  actor: Actor
  activities: ActivityItem[]
  artifacts: ActivityArtifact[]
  building: boolean
}) {
  const visible = activities.filter((a) => a.ownerActorId === actor.id && !a.hidden)
  const owned = artifacts.filter((a) => a.ownerActorId === actor.id && a.state !== 'removed')
  const isMothership = actor.id === MOTHERSHIP_ACTOR_ID
  if (isMothership && visible.length === 0 && owned.length === 0) return null

  const { icon: Glyph, color } = agentIdentity(actor.key)
  const isActive = actor.state === 'active' || actor.state === 'delegating'

  return (
    <div
      className='flex animate-slide-in-bottom flex-col'
      style={{ paddingLeft: actor.depth > 1 ? (actor.depth - 1) * 14 : 0 }}
    >
      <div className='flex items-center gap-[8px] py-[3px]'>
        <span
          className={cn(
            'relative flex size-[22px] flex-shrink-0 items-center justify-center rounded-[6px]',
            isActive && 'animate-pulse'
          )}
          style={{ backgroundColor: tint(color, isActive ? '24' : '14') }}
        >
          <Glyph className='size-[13px]' style={{ color }} />
        </span>
        <span
          className={cn(
            'flex-1 font-[500] text-[13px]',
            isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          )}
        >
          {actor.label}
        </span>
        {actor.state === 'done' ? (
          <Check className='size-[13px]' style={{ color }} />
        ) : isActive ? (
          <Loader className='size-[13px] animate-spin text-[var(--text-icon)]' />
        ) : null}
      </div>
      {visible.map((activity) => (
        <ActivityChip key={activity.toolCallId} activity={activity} color={color} />
      ))}
      {owned.map((artifact) => (
        <ArtifactPreview key={artifact.resourceId} artifact={artifact} building={building} />
      ))}
    </div>
  )
})

interface ActivityViewProps {
  model: ActivityModel
  className?: string
}

/**
 * Characterful agent-lane visualizer: each deployed agent gets a colored glyph
 * lane that animates in, shows its tools ticking through, and previews the
 * artifact it's building underneath. The parent promotes the finished artifact
 * to the full panel on completion.
 */
export const ActivityView = memo(function ActivityView({ model, className }: ActivityViewProps) {
  const accent = SCENE_ACCENT[model.scene]
  const inFlight = isTurnInFlight(model)
  const artifacts = Object.values(model.artifacts)
  const lanes = model.actorOrder.map((id) => model.actors[id]).filter((a): a is Actor => !!a)

  return (
    <div className={cn('flex h-full flex-col overflow-y-auto px-[20px] py-[18px]', className)}>
      <div className='mb-[16px] flex items-center gap-[8px]'>
        <span className='truncate font-[600] text-[14px] text-[var(--text-primary)]'>
          {model.title ?? 'Mothership'}
        </span>
        <span className='flex items-center gap-[6px]'>
          {inFlight && (
            <span
              className='size-[6px] animate-pulse rounded-full'
              style={{ backgroundColor: accent }}
            />
          )}
          <span className='text-[13px]' style={{ color: inFlight ? accent : 'var(--text-muted)' }}>
            {SCENE_STATUS[model.scene]}
          </span>
        </span>
      </div>

      {model.attention && (
        <div
          className='mb-[16px] rounded-[8px] border px-[12px] py-[10px]'
          style={{ borderColor: tint(accent, '40') }}
        >
          <p className='text-[13px] text-[var(--text-body)]'>
            {model.attention.kind === 'confirmation'
              ? 'Waiting for your confirmation…'
              : model.attention.kind === 'credential'
                ? `Connect ${model.attention.provider ?? 'an account'} to continue`
                : model.attention.kind === 'usage-limit'
                  ? 'Usage limit reached'
                  : (model.attention.message ?? 'Something went wrong')}
          </p>
        </div>
      )}

      <div className='flex flex-col gap-[12px]'>
        {lanes.map((actor) => (
          <ActorLane
            key={actor.id}
            actor={actor}
            activities={model.activities}
            artifacts={artifacts}
            building={inFlight}
          />
        ))}
      </div>
    </div>
  )
})
