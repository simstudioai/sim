'use client'

import { useState } from 'react'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import type {
  ShellActions,
  ShellData,
  ShellWorkspace,
} from '@/platform/app/(shell)/_components/model'
import { RailFlyout } from '@/platform/app/(shell)/_components/sidebar/rail-flyout'
import {
  openInNewTabAction,
  readFormText,
} from '@/platform/app/(shell)/_components/sidebar/row-links'
import { SectionStatus } from '@/platform/app/(shell)/_components/sidebar/section-status'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar-collections.module.css'
import {
  ActionMenu,
  Avatar,
  Chip,
  ContextActionMenu,
  Disclosure,
  Icon,
  IconButton,
  MenuItem,
  Modal,
  TextField,
} from '@/platform/design-system/components'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'

const PAGE_SIZE = 5
const WORKSPACE_NAME_MAX_LENGTH = 100
const CREATE_UNAVAILABLE = 'Workspace creation is unavailable.'

interface WorkspacesSectionProps {
  data: ShellData
  actions: ShellActions
  collapsed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspacesSection({
  data,
  actions,
  collapsed,
  open,
  onOpenChange,
}: WorkspacesSectionProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const { workspaces, workspaceCreation: policy } = data
  const workspaceActions = actions.workspaces
  const renaming = workspaces.find((workspace) => workspace.id === renamingId)
  const canCreate = policy?.canCreate && policy.organizationId === data.organization.id
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
    if (canCreate) actions.requestLeave(() => setCreating(true))
  }

  function renderRows(rows: readonly ShellWorkspace[], hold?: (held: boolean) => void) {
    return (
      <>
        <SectionStatus
          status={data.status.workspaces}
          isEmpty={workspaces.length === 0}
          emptyLabel='No workspaces yet'
          failureLabel='Could not load workspaces'
          onRetry={workspaceActions.retry}
        />
        {rows.map((item) => {
          const menu = rowActions(item)
          return (
            <ContextActionMenu
              key={item.id}
              label={`Actions for ${item.name}`}
              actions={menu}
              onOpenChange={hold}
            >
              <div className={styles.row}>
                <ControlRow
                  label={item.name}
                  leading={
                    <Avatar
                      name={item.name}
                      src={item.logoUrl ?? undefined}
                      organization
                      size='inline'
                    />
                  }
                  status={
                    item.isPinned && (
                      <span className={styles.indicator} role='img' aria-label='Pinned'>
                        <Icon name='I131' />
                      </span>
                    )
                  }
                  action={
                    <ActionMenu
                      label={`Options for ${item.name}`}
                      tooltip={false}
                      icon='I108'
                      triggerSize='compact'
                      align='end'
                      actions={menu}
                      onOpenChange={hold}
                    />
                  }
                  render={<SettingsGuardedLink href={item.href} />}
                />
              </div>
            </ContextActionMenu>
          )
        })}
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
              label={canCreate ? 'New workspace' : (policy?.reason ?? CREATE_UNAVAILABLE)}
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
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title='Create workspace'
        confirmLabel='Create'
        onConfirm={async (values) => {
          const name = readFormText(values, 'name')
          if (!name) throw new Error('Enter a workspace name.')
          if (!canCreate) throw new Error(policy?.reason ?? CREATE_UNAVAILABLE)
          actions.navigate(await workspaceActions.create(name))
        }}
      >
        <TextField label='Name' name='name' required maxLength={WORKSPACE_NAME_MAX_LENGTH} />
      </Modal>
      {renaming && (
        <Modal
          open
          onOpenChange={() => setRenamingId(null)}
          title='Rename workspace'
          confirmLabel='Save'
          onConfirm={async (values) => {
            const name = readFormText(values, 'name')
            if (!name) throw new Error('Enter a workspace name.')
            if (name !== renaming.name) await workspaceActions.rename(renaming.id, name)
          }}
        >
          <TextField
            label='Name'
            name='name'
            required
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            defaultValue={renaming.name}
          />
        </Modal>
      )}
    </>
  )
}
