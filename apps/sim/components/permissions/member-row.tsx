'use client'

import { Avatar, AvatarFallback, Chip, ChipDropdown, cn } from '@sim/emcn'
import { getUserColor } from '@/lib/workspaces/colors'
import type { MemberRole } from './member-role-options'
import { RoleLockTooltip } from './role-lock'

export interface MemberRowMember<TRole extends string = MemberRole> {
  userId: string
  userName: string | null
  userEmail: string | null
  role: TRole
}

interface MemberRowProps<TRole extends string = MemberRole> {
  member: MemberRowMember<TRole>
  /** Why the role is fixed (derived access); null when editable. */
  lockReason: string | null
  /** Whether the viewer can act on rows (shows the Remove column). */
  canManage: boolean
  roleDisabled: boolean
  removeDisabled: boolean
  /**
   * Role choices for the dropdown. A surface whose membership is binary
   * (skills) passes its own single option and always sets `roleDisabled`.
   */
  roleOptions: readonly { value: TRole; label: string }[]
  /** Omitted on surfaces with nothing to switch between (the role stays disabled). */
  onRoleChange?: (role: TRole) => void
  onRemove: () => void
}

/**
 * One member row of a shared-resource member list: avatar + identity, a role
 * dropdown (wrapped in a lock tooltip when the role is derived), and a remove
 * action for managers. Consumers own the policy (who is locked/disabled); this
 * row owns the chrome.
 */
export function MemberRow<TRole extends string = MemberRole>({
  member,
  lockReason,
  canManage,
  roleDisabled,
  removeDisabled,
  roleOptions,
  onRoleChange,
  onRemove,
}: MemberRowProps<TRole>) {
  return (
    <div
      className={cn(
        'grid items-center gap-2',
        canManage ? 'grid-cols-[1fr_120px_72px]' : 'grid-cols-[1fr_200px]'
      )}
    >
      <div className='flex min-w-0 items-center gap-2.5'>
        <Avatar className='size-9 flex-shrink-0'>
          <AvatarFallback
            style={{ background: getUserColor(member.userId || member.userEmail || '') }}
            className='border border-[var(--border-1)] text-small text-white'
          >
            {(member.userName || member.userEmail || '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className='flex min-w-0 flex-col'>
          <span className='truncate text-[var(--text-body)] text-sm'>
            {member.userName || member.userEmail || member.userId}
          </span>
          <span className='truncate text-[var(--text-muted)] text-caption'>
            {member.userEmail || member.userId}
          </span>
        </div>
      </div>
      <RoleLockTooltip reason={lockReason}>
        <ChipDropdown
          options={roleOptions}
          value={member.role}
          placeholder='Role'
          disabled={roleDisabled}
          onChange={(role) => onRoleChange?.(role as TRole)}
        />
      </RoleLockTooltip>
      {canManage && (
        <Chip onClick={onRemove} disabled={removeDisabled} flush className='justify-self-end'>
          Remove
        </Chip>
      )}
    </div>
  )
}
