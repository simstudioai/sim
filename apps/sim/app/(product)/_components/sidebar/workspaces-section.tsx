'use client'

import { useState } from 'react'
import { Chip, IconButton } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { TextField } from '@sim/emcn/field'
import { Icon } from '@sim/emcn/icon'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { ActionMenu, ContextActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { WORKSPACES_PATH, workspaceEntry } from '@/lib/navigation/paths'
import { RenameDialog } from '@/app/(product)/_components/rename-dialog/rename-dialog'
import { SidebarSortMenu } from '@/app/(product)/_components/sidebar/collection-order'
import { pinAction } from '@/app/(product)/_components/sidebar/row-links'
import { SectionStatus } from '@/app/(product)/_components/sidebar/section-status'
import { useSeeMore } from '@/app/(product)/_components/sidebar/see-more'
import styles from '@/app/(product)/_components/sidebar/sidebar-collections.module.css'
import { useSidebarLayout } from '@/app/(product)/_components/sidebar/sidebar-layout'
import type { ShellActions, ShellData, ShellWorkspace } from '@/platform/lib/data/models/shell'
import { usePlatformHref } from '@/platform/lib/platform-href'
import { openInNewTabAction, readFormText } from '@/platform/shared/row-links'

const WORKSPACE_NAME_MAX_LENGTH = 100
const CREATE_UNAVAILABLE = 'Workspace creation is unavailable.'

interface WorkspacesSectionProps {
  data: ShellData | null
  actions: ShellActions
  /** The workspace whose page is open, marked current like any other destination. */
  activeWorkspace?: string
  navigate: (href: string) => void
}

export function WorkspacesSection({
  data,
  actions,
  activeWorkspace,
  navigate,
}: WorkspacesSectionProps) {
  const hrefFor = usePlatformHref()
  const { workspacesOpen, setWorkspacesOpen, workspaceOrder, setWorkspaceOrder } =
    useSidebarLayout()
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<ShellWorkspace | null>(null)
  const workspaces = data?.workspaces ?? []
  const renaming = workspaces.find((workspace) => workspace.id === renamingId)
  const { create, rename, leave, retry, setPinned } = actions.workspaces
  const policy = data?.workspaceCreation
  const canCreate = policy?.canCreate && policy.organizationId === data?.organization.id
  const page = useSeeMore(workspaces, data?.workspacePageSize)

  function rowActions(item: ShellWorkspace): MenuAction[] {
    const href = item.href
    return [
      ...(href ? [openInNewTabAction(hrefFor(href))] : []),
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
      ...(leave && item.canLeave
        ? [
            {
              id: 'leave',
              label: 'Leave',
              icon: 'I132',
              destructive: true,
              separatorBefore: true,
              onSelect: () => setLeaving(item),
            } satisfies MenuAction,
          ]
        : []),
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
            items='workspaces'
            onRetry={retry}
          />
          {page.visible.map((item) => {
            const rows = rowActions(item)
            return (
              <ContextActionMenu key={item.id} label={`Actions for ${item.name}`} actions={rows}>
                <Chip
                  href={hrefFor(item.href ?? workspaceEntry(item.id))}
                  selected={item.id === activeWorkspace}
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
          {page.control}
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
      {leave && (
        <ConfirmDialog
          target={leaving}
          onClose={() => setLeaving(null)}
          title='Leave workspace'
          description={({ name }) =>
            `You will lose access to ${name} until someone invites you back.`
          }
          confirmLabel='Leave'
          pendingLabel='Leaving…'
          onConfirm={async ({ id }) => {
            await leave(id)
            if (id === activeWorkspace) navigate(WORKSPACES_PATH)
          }}
        />
      )}
      {rename && (
        <RenameDialog
          target={renaming ?? null}
          noun='workspace'
          maxLength={WORKSPACE_NAME_MAX_LENGTH}
          onClose={() => setRenamingId(null)}
          onRename={rename}
        />
      )}
    </>
  )
}
