import { Avatar, cn } from '@sim/emcn'
import { Sim, Workflow, Zap } from '@sim/emcn/icons'
import type { Delegate, Person } from '@/app/playground/org/lib/types'

const DELEGATE_ICON = { agent: Zap, workflow: Workflow, sim: Sim } as const

interface DelegateAvatarProps {
  owner: Person
  delegate?: Delegate
  className?: string
}

/** Owner avatar; a delegated issue carries a small badge for the agent working it. */
export function DelegateAvatar({ owner, delegate, className }: DelegateAvatarProps) {
  const Icon = delegate ? DELEGATE_ICON[delegate.kind] : null
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar size='sm' name={owner.name} />
      {Icon && (
        <span className='-right-1 -bottom-1 absolute flex size-[14px] items-center justify-center rounded-full border border-[var(--bg)] bg-[var(--surface-inverted)]'>
          <Icon className='size-[9px] text-[var(--text-inverse)]' />
        </span>
      )}
    </span>
  )
}

export function delegateIcon(delegate: Delegate) {
  return DELEGATE_ICON[delegate.kind]
}
