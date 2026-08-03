'use client'

import type { ReactNode } from 'react'
import { MemberAvatar } from '@/components/permissions/member-avatar'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { RESOURCE_LIST_STACK } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

const ROW_CLASSES = '-mx-2 flex items-center gap-2.5 rounded-lg p-2'
const ROW_EMAIL_CLASSES = 'min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'
const ROW_STATUS_CLASSES = 'flex-shrink-0 text-[var(--text-muted)] text-caption'

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
    <div className={ROW_CLASSES}>
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
  isEmpty = false,
  emptyText = 'No members yet',
  children,
}: MemberSectionProps) {
  return (
    <SettingsSection label={label}>
      {isEmpty ? (
        <SettingsEmptyState variant='inline'>{emptyText}</SettingsEmptyState>
      ) : (
        <div className={RESOURCE_LIST_STACK}>{children}</div>
      )}
    </SettingsSection>
  )
}
