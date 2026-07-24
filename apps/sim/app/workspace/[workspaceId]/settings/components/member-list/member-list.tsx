'use client'

import type { ReactNode } from 'react'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

const ROW_CLASSES = 'flex items-center gap-2.5 p-2'
const ROW_EMAIL_CLASSES = 'min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'
const ROW_STATUS_CLASSES = 'flex-shrink-0 text-[var(--text-muted)] text-caption'

interface MemberAvatarProps {
  name: string
  image: string | null
}

/**
 * 14px circular avatar used in member rows. Falls back to the first letter of
 * the member's name when no image is available.
 */
export function MemberAvatar({ name, image }: MemberAvatarProps) {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        referrerPolicy='no-referrer'
        className='size-[14px] flex-shrink-0 rounded-full border border-[var(--border)] object-cover'
      />
    )
  }

  return (
    <span className='flex size-[14px] flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

interface MemberRowProps {
  name: string
  email: string
  image: string | null
  /** Muted trailing text, e.g. "Joined 6/3/2026" or "Invite pending". */
  status: string
  /** Role control rendered before the actions menu (e.g. a `ChipDropdown`). */
  roleControl?: ReactNode
  /** Trailing actions menu (e.g. the `...` `DropdownMenu`). */
  menu?: ReactNode
}

/**
 * Single member row: avatar, email, status, an optional role control, and an
 * optional actions menu. Shared by the workspace Teammates page and the
 * Organization page so both render identical chrome.
 */
export function MemberRow({ name, email, image, status, roleControl, menu }: MemberRowProps) {
  return (
    <div role='group' aria-label={email} className={ROW_CLASSES}>
      <MemberAvatar name={name} image={image} />
      <span className={ROW_EMAIL_CLASSES}>{email}</span>
      <span className={ROW_STATUS_CLASSES}>{status}</span>
      {roleControl}
      {menu}
    </div>
  )
}

interface MemberSectionProps {
  /** Section label, e.g. "Teammates (3)" or a workspace name with a count. */
  label: string
  /** Stable accessible name when `label` includes a mutable count. */
  ariaLabel?: string
  /** Renders the empty state instead of the row group. */
  isEmpty?: boolean
  /** Copy shown when {@link isEmpty} is true. */
  emptyText?: string
  /** Member rows. */
  children: ReactNode
}

/**
 * Labeled section wrapping a group of {@link MemberRow}s. Matches the
 * Teammates section rhythm (label, divider, negative-margin row group).
 */
export function MemberSection({
  label,
  ariaLabel,
  isEmpty = false,
  emptyText = 'No members yet',
  children,
}: MemberSectionProps) {
  return (
    <SettingsSection label={label} ariaLabel={ariaLabel}>
      {isEmpty ? (
        <SettingsEmptyState variant='inline'>{emptyText}</SettingsEmptyState>
      ) : (
        <div className='-mx-2 flex flex-col gap-y-0.5'>{children}</div>
      )}
    </SettingsSection>
  )
}
