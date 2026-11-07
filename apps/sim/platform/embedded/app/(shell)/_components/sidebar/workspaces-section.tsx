'use client'

import { useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Chip, IconButton } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { type MenuAction, MenuItem } from '@sim/emcn/menu/action-menu'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import { NameModal } from '@/platform/embedded/app/(shell)/_components/sidebar/name-modal'
import { RailFlyout } from '@/platform/embedded/app/(shell)/_components/sidebar/rail-flyout'
import {
  PinnedIndicator,
  SectionRow,
} from '@/platform/embedded/app/(shell)/_components/sidebar/section-row'
import { SectionStatus } from '@/platform/embedded/app/(shell)/_components/sidebar/section-status'
import styles from '@/platform/embedded/app/(shell)/_components/sidebar/sidebar-collections.module.css'
import type {
  ShellActions,
  ShellData,
  ShellWorkspace,
} from '@/platform/embedded/lib/data/shell-view'
import { useWorkspaceActions } from '@/platform/embedded/lib/data/workspaces'
import { openInNewTabAction } from '@/platform/embedded/lib/row-links'

const PAGE_SIZE = 5
const WORKSPACE_NAME_MAX_LENGTH = 100
const CREATE_UNAVAILABLE = 'Workspace creation is unavailable.'

interface WorkspacesSectionProps {
  data: ShellData
  actions: ShellActions
  onRetry: () => void
  collapsed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspacesSection({
  data,
  actions,
  onRetry,
  collapsed,
  open,
  onOpenChange,
}: WorkspacesSectionProps) {
  const workspaceActions = useWorkspaceActions()
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const { workspaces } = data
  const { canCreate, reason } = data.workspaceCreation
  const renaming = workspaces.find((workspace) => workspace.id === renamingId)
  const hasMore = workspaces.length > visibleCount

  function rowActions(item: ShellWorkspace): MenuAction[] {
    return [
      openInNewTabAction(item.href),
      {
        id: 'pin',
        label: item.isPinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => workspaceActions.setPinned(item.id, !item.isPinned),
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: 'I036',
        disabled: item.permissions !== 'admin',
        onSelect: () => setRenamingId(item.id),
      },
    ]
  }

  function startCreating() {
    actions.requestLeave(() => setCreating(true))
  }

  function renderRows(rows: readonly ShellWorkspace[], hold?: (held: boolean) => void) {
    return (
      <>
        <SectionStatus
          status={data.status.workspaces}
          isEmpty={workspaces.length === 0}
          emptyLabel='No workspaces yet'
          failureLabel='Could not load workspaces'
          onRetry={onRetry}
        />
        {rows.map((item) => (
          <SectionRow
            key={item.id}
            label={item.name}
            actions={() => rowActions(item)}
            onMenuOpenChange={hold}
            leading={
              <Avatar
                name={item.name}
                src={item.logoUrl ?? undefined}
                organization
                size='inline'
                decorative
              />
            }
            status={item.isPinned && <PinnedIndicator />}
            render={<SettingsGuardedLink href={item.href} />}
          />
        ))}
      </>
    )
  }

  return (
    <>
      {collapsed ? (
        <RailFlyout label='Workspaces' icon='I025'>
          {(hold) => (
            <div className={styles.group}>
              {canCreate && <MenuItem label='New workspace' icon='I074' onSelect={startCreating} />}
              {renderRows(workspaces, hold)}
            </div>
          )}
        </RailFlyout>
      ) : (
        <Disclosure
          variant='section'
          label='Workspaces'
          open={open}
          onOpenChange={onOpenChange}
          actions={
            <IconButton
              tooltip
              size='compact'
              label={canCreate ? 'New workspace' : (reason ?? CREATE_UNAVAILABLE)}
              icon='I074'
              disabled={!canCreate}
              onClick={startCreating}
            />
          }
        >
          <div className={styles.group}>
            {renderRows(workspaces.slice(0, visibleCount))}
            {workspaces.length > PAGE_SIZE && (
              <Chip onClick={() => setVisibleCount(hasMore ? visibleCount + PAGE_SIZE : PAGE_SIZE)}>
                {hasMore ? 'See more' : 'See less'}
              </Chip>
            )}
          </div>
        </Disclosure>
      )}
      {creating && (
        <NameModal
          title='Create workspace'
          confirmLabel='Create'
          fieldLabel='Name'
          emptyMessage='Enter a workspace name.'
          maxLength={WORKSPACE_NAME_MAX_LENGTH}
          onSubmit={async (name) => actions.navigate(await workspaceActions.create(name))}
          onClose={() => setCreating(false)}
        />
      )}
      {renaming && (
        <NameModal
          title='Rename workspace'
          confirmLabel='Save'
          fieldLabel='Name'
          emptyMessage='Enter a workspace name.'
          maxLength={WORKSPACE_NAME_MAX_LENGTH}
          initial={renaming.name}
          onSubmit={(name) => workspaceActions.rename(renaming.id, name)}
          onClose={() => setRenamingId(null)}
        />
      )}
    </>
  )
}
