'use client'

import { Avatar, Chip, ChipDropdown, cn, OverflowText } from '@sim/emcn'
import type { MemberRole } from './member-role-options'
import { RoleLockTooltip } from './role-lock'

/** The row's trailing chip: Remove for a manager, Leave on the viewer's own row. */
export interface MemberRowAction {
  label: string
  disabled: boolean
  /** Why the action is disabled, shown on hover. */
  disabledReason?: string | null
  onSelect: () => void
}

export interface MemberRowMember<TRole extends string = MemberRole> {
  userId: string
  userName: string | null
  userEmail: string | null
  userImage: string | null
  role: TRole
}

interface MemberRowProps<TRole extends string = MemberRole> {
  member: MemberRowMember<TRole>
  /** Why the role is fixed (derived access); null when editable. */
  lockReason: string | null
  /** Whether the list reserves a trailing action column; the same for every row. */
  showActions: boolean
  action: MemberRowAction | null
  roleDisabled: boolean
  /**
   * Role choices for the dropdown. A surface whose membership is binary
   * (skills) passes its own single option and always sets `roleDisabled`.
   */
  roleOptions: readonly { value: TRole; label: string }[]
  /** Omitted on surfaces with nothing to switch between (the role stays disabled). */
  onRoleChange?: (role: TRole) => void
}

/**
 * One member row of a shared-resource member list: avatar + identity, a role
 * dropdown (wrapped in a lock tooltip when the role is derived), and an
 * optional trailing action. Consumers own the policy (who is locked/disabled);
 * this row owns the chrome.
 */
export function MemberRow<TRole extends string = MemberRole>({
  member,
  lockReason,
  showActions,
  action,
  roleDisabled,
  roleOptions,
  onRoleChange,
}: MemberRowProps<TRole>) {
  return (
    <div
      className={cn(
        'grid items-center gap-2',
        showActions ? 'grid-cols-[1fr_120px_72px]' : 'grid-cols-[1fr_200px]'
      )}
    >
      <div className='flex min-w-0 items-center gap-2.5'>
        <Avatar
          size='xs'
          name={member.userName || member.userEmail || '?'}
          src={member.userImage}
          aria-hidden
        />
        <div className='flex min-w-0 flex-col'>
          <OverflowText
            label={member.userName || member.userEmail || member.userId}
            className='text-[var(--text-body)] text-sm'
          />
          <OverflowText
            label={member.userEmail || member.userId}
            className='text-[var(--text-muted)] text-caption'
          />
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
      {action && (
        <RoleLockTooltip reason={action.disabled ? (action.disabledReason ?? null) : null}>
          <Chip onClick={action.onSelect} disabled={action.disabled} className='justify-self-end'>
            {action.label}
          </Chip>
        </RoleLockTooltip>
      )}
    </div>
  )
}
