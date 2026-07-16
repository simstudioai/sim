'use client'

import { Avatar, AvatarFallback, Chip, ChipDropdown, cn } from '@sim/emcn'
import { getUserColor } from '@/lib/workspaces/colors'
import { MEMBER_ROLE_OPTIONS, type MemberRole } from './member-role-options'
import { RoleLockTooltip } from './role-lock'

export interface MemberRowMember {
  userId: string
  userName: string | null
  userEmail: string | null
  role: MemberRole
}

interface MemberRowProps {
  member: MemberRowMember
  /** Why the role is fixed (derived access); null when editable. */
  lockReason: string | null
  /** Whether the viewer can act on rows (shows the Remove column). */
  canManage: boolean
  roleDisabled: boolean
  removeDisabled: boolean
  onRoleChange: (role: MemberRole) => void
  onRemove: () => void
}

/**
 * One member row of a shared-resource member list: avatar + identity, a role
 * dropdown (wrapped in a lock tooltip when the role is derived), and a remove
 * action for managers. Consumers own the policy (who is locked/disabled); this
 * row owns the chrome.
 */
export function MemberRow({
  member,
  lockReason,
  canManage,
  roleDisabled,
  removeDisabled,
  onRoleChange,
  onRemove,
}: MemberRowProps) {
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
          <span className='truncate text-[14px] text-[var(--text-body)]'>
            {member.userName || member.userEmail || member.userId}
          </span>
          <span className='truncate text-[12px] text-[var(--text-muted)]'>
            {member.userEmail || member.userId}
          </span>
        </div>
      </div>
      <RoleLockTooltip reason={lockReason}>
        <ChipDropdown
          options={MEMBER_ROLE_OPTIONS}
          value={member.role}
          placeholder='Role'
          disabled={roleDisabled}
          onChange={(role) => onRoleChange(role as MemberRole)}
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
