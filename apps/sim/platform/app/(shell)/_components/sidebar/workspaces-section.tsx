'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type {
  ShellActions,
  ShellData,
  ShellWorkspace,
} from '@/platform/app/(shell)/_components/model'
import { SidebarSortMenu } from '@/platform/app/(shell)/_components/sidebar/collection-order'
import {
  openInNewTabAction,
  pinAction,
  readFormText,
} from '@/platform/app/(shell)/_components/sidebar/row-links'
import { SectionStatus } from '@/platform/app/(shell)/_components/sidebar/section-status'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar-collections.module.css'
import { useSidebarLayout } from '@/platform/app/(shell)/_components/sidebar/sidebar-layout'
import {
  ActionMenu,
  Chip,
  ContextActionMenu,
  Disclosure,
  Icon,
  IconButton,
  Modal,
  TextField,
} from '@/platform/design-system/components'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { platformHref } from '@/platform/design-system/navigation'

const WORKSPACE_NAME_MAX_LENGTH = 100
const CREATE_UNAVAILABLE = 'Workspace creation is unavailable.'

interface WorkspacesSectionProps {
  data: ShellData | null
  actions: ShellActions
  navigate: (href: string) => void
}

export function WorkspacesSection({ data, actions, navigate }: WorkspacesSectionProps) {
  const query = useSearchParams()
  const { workspacesOpen, setWorkspacesOpen, workspaceOrder, setWorkspaceOrder } =
    useSidebarLayout()
  const [visibleCount, setVisibleCount] = useState(data?.workspacePageSize)
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const workspaces = data?.workspaces ?? []
  const renaming = workspaces.find((workspace) => workspace.id === renamingId)
  const { create, rename, retry, setPinned } = actions.workspaces
  const policy = data?.workspaceCreation
  const canCreate = policy?.canCreate && policy.organizationId === data?.organization.id
  const pageSize = data?.workspacePageSize
  const hasMore = visibleCount !== undefined && workspaces.length > visibleCount

  function rowActions(item: ShellWorkspace): MenuAction[] {
    const href = item.href
    return [
      ...(href ? [openInNewTabAction(platformHref(href, query))] : []),
      ...(rename
        ? [
            {
              id: 'rename',
              label: 'Rename',
              icon: 'I036',
              disabled: item.permissions !== 'admin',
              onSelect: () => setRenamingId(item.id),
            } satisfies MenuAction,
          ]
        : []),
      pinAction(item, setPinned),
    ]
  }

  const addLabel = canCreate ? 'Add workspace' : (policy?.reason ?? CREATE_UNAVAILABLE)

  return (
    <>
      <Disclosure
        variant='navigation'
        label='Workspaces'
        open={workspacesOpen}
        onOpenChange={setWorkspacesOpen}
        actions={
          <>
            <SidebarSortMenu
              section='workspaces'
              order={workspaceOrder}
              onChange={setWorkspaceOrder}
            />
            {create && (
              <IconButton
                tooltip
                size='compact'
                label={addLabel}
                icon='I074'
                disabled={!canCreate}
                onClick={() => actions.requestLeave(() => setCreating(true))}
              />
            )}
          </>
        }
      >
        <div className={styles.group}>
          <SectionStatus
            status={data?.status?.workspaces}
            isEmpty={workspaces.length === 0}
            emptyLabel='No workspaces yet'
            failureLabel='Could not load workspaces'
            onRetry={retry}
          />
          {workspaces.slice(0, visibleCount).map((item) => {
            const rows = rowActions(item)
            return (
              <ContextActionMenu key={item.id} label={`Actions for ${item.name}`} actions={rows}>
                <Chip
                  href={platformHref(item.href ?? `/workspace/${item.id}`, query)}
                  status={item.isPinned && <Icon name='I131' label='Pinned' />}
                  replaceActionOnTouch={item.isPinned}
                  action={
                    <ActionMenu
                      label={`Actions for ${item.name}`}
                      tooltip={false}
                      icon='I108'
                      triggerSize='compact'
                      align='end'
                      actions={rows}
                    />
                  }
                >
                  {item.name}
                </Chip>
              </ContextActionMenu>
            )
          })}
          {pageSize !== undefined && workspaces.length > pageSize && (
            <Chip onClick={() => setVisibleCount(hasMore ? visibleCount + pageSize : pageSize)}>
              {hasMore ? 'See more' : 'See less'}
            </Chip>
          )}
        </div>
      </Disclosure>
      {create && (
        <Modal
          open={creating}
          onOpenChange={setCreating}
          title='Add workspace'
          confirmLabel='Create'
          onConfirm={async (values) => {
            const name = readFormText(values, 'name')
            if (!name) throw new Error('Enter a workspace name.')
            if (!canCreate) throw new Error(policy?.reason ?? CREATE_UNAVAILABLE)
            navigate(await create(name))
          }}
        >
          <TextField
            placeholder='Workspace name'
            label='Workspace name'
            name='name'
            required
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
          />
        </Modal>
      )}
      {renaming && rename && (
        <Modal
          open
          onOpenChange={() => setRenamingId(null)}
          title='Rename workspace'
          confirmLabel='Save'
          onConfirm={async (values) => {
            const name = readFormText(values, 'name')
            if (!name) throw new Error('Enter a workspace name.')
            if (name !== renaming.name) await rename(renaming.id, name)
          }}
        >
          <TextField
            placeholder='Workspace name'
            label='Workspace name'
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
