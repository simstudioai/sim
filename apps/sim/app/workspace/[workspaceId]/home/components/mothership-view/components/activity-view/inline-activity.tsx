'use client'

import { memo, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronDown,
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
  type ActivityItem,
  type ActivityModel,
  type ActivityState,
  type Actor,
  MOTHERSHIP_ACTOR_ID,
  type VerbFamily,
} from './activity-model'
import { agentIdentity } from './agent-identity'

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

function isActivityDone(state: ActivityState): boolean {
  return state !== 'generating' && state !== 'executing'
}

function ToolStatusIcon({ state, color }: { state: ActivityState; color: string }) {
  if (state === 'success') return <Check className='size-[13px]' style={{ color }} />
  if (state === 'error' || state === 'rejected')
    return <X className='size-[13px] text-[var(--text-tertiary)]' />
  if (state === 'cancelled' || state === 'skipped')
    return <X className='size-[13px] text-[var(--text-muted)]' />
  return <Loader className='size-[13px] animate-spin text-[var(--text-tertiary)]' />
}

const InlineToolRow = memo(function InlineToolRow({
  activity,
  color,
}: {
  activity: ActivityItem
  color: string
}) {
  const Icon = FAMILY_ICON[activity.family]
  return (
    <div className='flex animate-stream-fade-in items-center gap-[8px] pl-[26px]'>
      <Icon className='size-[13px] flex-shrink-0 text-[var(--text-tertiary)]' />
      <span className='truncate text-[13px] text-[var(--text-secondary)] leading-[20px]'>
        {activity.verb}
      </span>
      <span className='ml-auto flex-shrink-0'>
        <ToolStatusIcon state={activity.state} color={color} />
      </span>
    </div>
  )
})

const InlineAgentGroup = memo(function InlineAgentGroup({
  actor,
  activities,
}: {
  actor: Actor
  activities: ActivityItem[]
}) {
  const visible = activities.filter((a) => a.ownerActorId === actor.id && !a.hidden)
  const isActive = actor.state === 'active' || actor.state === 'delegating'
  const { icon: Glyph, color } = agentIdentity(actor.key)

  // Expanded while the agent works; collapses once it finishes (user can reopen).
  const [overrideOpen, setOverrideOpen] = useState<boolean | null>(null)
  const expanded = overrideOpen ?? isActive

  if (actor.id === MOTHERSHIP_ACTOR_ID && visible.length === 0) return null

  return (
    <div className='flex animate-slide-in-bottom flex-col gap-[6px]'>
      <button
        type='button'
        onClick={() => setOverrideOpen(!expanded)}
        className='flex items-center gap-[8px]'
      >
        <span
          className={cn(
            'flex size-[20px] flex-shrink-0 items-center justify-center rounded-[5px]',
            isActive && 'animate-pulse'
          )}
          style={{ backgroundColor: `${color}${isActive ? '24' : '14'}` }}
        >
          <Glyph className='size-[12px]' style={{ color }} />
        </span>
        <span
          className={cn(
            'text-[14px]',
            isActive ? 'text-[var(--text-body)]' : 'text-[var(--text-secondary)]'
          )}
        >
          {actor.label}
        </span>
        {actor.state === 'done' && <Check className='size-[13px]' style={{ color }} />}
        {visible.length > 0 && (
          <ChevronDown
            className={cn(
              'size-[14px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        )}
      </button>
      {expanded && visible.length > 0 && (
        <div className='flex flex-col gap-[5px] pb-[2px]'>
          {visible.map((activity) => (
            <InlineToolRow key={activity.toolCallId} activity={activity} color={color} />
          ))}
        </div>
      )}
    </div>
  )
})

interface ChatActivityProps {
  model: ActivityModel
}

/**
 * Inline-in-chat agent activity: the deployed agents and their tools, rendered
 * within an assistant message (chat width). Evolves the existing AgentGroup
 * with per-agent color identity + deploy-in motion. No artifact preview — the
 * artifact materializes in the right panel, not here.
 */
export const ChatActivity = memo(function ChatActivity({ model }: ChatActivityProps) {
  const lanes = model.actorOrder.map((id) => model.actors[id]).filter((a): a is Actor => !!a)
  const showThinking = model.phase === 'thinking' && model.activities.length === 0

  return (
    <div className='flex flex-col gap-[12px]'>
      {showThinking && (
        <div className='flex items-center gap-[8px]'>
          <Loader className='size-[14px] animate-spin text-[var(--text-icon)]' />
          <span className='text-[14px] text-[var(--text-secondary)]'>Thinking…</span>
        </div>
      )}
      {lanes.map((actor) => (
        <InlineAgentGroup key={actor.id} actor={actor} activities={model.activities} />
      ))}
    </div>
  )
})
