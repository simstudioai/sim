'use client'

import { type ReactNode, useState } from 'react'
import {
  ActionMenu,
  Avatar,
  ConfirmDialog,
  Select,
  StatusTag,
  Tooltip,
} from '@/platform/design-system/components'
import { useClipboard } from '@/platform/design-system/components/feedback/use-clipboard'
import type { MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/members/members.module.css'
import type { MembersActions } from '@/platform/embedded/lib/data/members'
import type {
  InvitationRowModel,
  MemberRowModel,
  WorkspaceInvitationRowModel,
  WorkspaceMemberRowModel,
  WorkspacePermission,
} from '@/platform/shared/members'
import { ORGANIZATION_ROLE_LABELS, ORGANIZATION_ROLE_OPTIONS } from '@/platform/shared/members'

const WORKSPACE_ROLES = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'admin', label: 'Admin' },
] as const

const toOrganizationRole = (value: string) => (value === 'admin' ? 'admin' : 'member')

function toPermission(value: string): WorkspacePermission {
  return value === 'admin' || value === 'read' ? value : 'write'
}

interface RowFrameProps {
  name: string
  email: string
  image?: string
  status: string
  control: ReactNode
  menuLabel: string
  actions: readonly MenuAction[]
  /** The row's own confirm, kept beside it so the row never renders one per roster. */
  dialog?: ReactNode
}

function RowFrame({
  name,
  email,
  image,
  status,
  control,
  menuLabel,
  actions,
  dialog,
}: RowFrameProps) {
  return (
    <SettingsRow
      label={name}
      description={
        <span className={styles.contact}>
          <span title={email}>{email}</span>
          <span aria-hidden='true' className={styles.separator}>
            {' · '}
          </span>
          <span>{status}</span>
        </span>
      }
      leading={<Avatar name={name} src={image} />}
    >
      <span className={styles.controls}>
        <span className={styles.role}>{control}</span>
        <ActionMenu label={menuLabel} icon='I108' align='end' actions={actions} />
        {dialog}
      </span>
    </SettingsRow>
  )
}

function useCopyEmail(email: string): MenuAction {
  const { copy } = useClipboard()
  return { id: 'copy', label: 'Copy email', onSelect: () => void copy(email) }
}

interface MemberRowProps {
  row: MemberRowModel
  actions: MembersActions
  onRemove: (row: MemberRowModel) => void
  onManageCredits: (row: MemberRowModel) => void
  onTransfer: () => void
}

export function MemberRow({ row, actions, onRemove, onManageCredits, onTransfer }: MemberRowProps) {
  const copyEmail = useCopyEmail(row.email)
  return (
    <RowFrame
      name={row.name}
      email={row.email}
      image={row.image}
      status={row.status}
      menuLabel={`Actions for ${row.name}`}
      control={
        row.canEditRole ? (
          <Select
            block
            variant='quiet'
            label={`Role for ${row.name}`}
            options={ORGANIZATION_ROLE_OPTIONS}
            value={row.role}
            disabled={actions.rolePending}
            onValueChange={(next) => void actions.changeRole(row.userId, toOrganizationRole(next))}
          />
        ) : (
          <StatusTag label={ORGANIZATION_ROLE_LABELS[row.role]} />
        )
      }
      actions={[
        copyEmail,
        ...(row.canManageCredits
          ? [{ id: 'credits', label: 'Manage credits', onSelect: () => onManageCredits(row) }]
          : []),
        ...(row.canTransfer
          ? [{ id: 'transfer', label: 'Transfer ownership and leave', onSelect: onTransfer }]
          : []),
        ...(row.canRemove
          ? [
              {
                id: 'remove',
                label: 'Remove',
                destructive: true,
                separatorBefore: true,
                onSelect: () => onRemove(row),
              },
            ]
          : []),
      ]}
    />
  )
}

interface InvitationRowProps {
  row: InvitationRowModel
  canManage: boolean
  actions: MembersActions
}

function useInvitationMenu(row: InvitationRowModel, canManage: boolean, actions: MembersActions) {
  const copyEmail = useCopyEmail(row.email)
  const [revoking, setRevoking] = useState(false)
  const manage: readonly MenuAction[] = canManage
    ? [
        {
          id: 'resend',
          label: 'Resend invite',
          onSelect: () => void actions.resendInvitation(row.id),
        },
        {
          id: 'revoke',
          label: 'Revoke invite',
          destructive: true,
          separatorBefore: true,
          onSelect: () => setRevoking(true),
        },
      ]
    : []
  return {
    menu: [copyEmail, ...manage],
    revokeDialog: (
      <ConfirmDialog
        target={revoking}
        onClose={() => setRevoking(false)}
        title='Revoke invite'
        description={`${row.email} will no longer be able to accept this invite.`}
        confirmLabel='Revoke'
        pendingLabel='Revoking…'
        onConfirm={() => actions.revokeInvitation(row.id)}
      />
    ),
  }
}

export function InvitationRow({ row, canManage, actions }: InvitationRowProps) {
  const { menu, revokeDialog } = useInvitationMenu(row, canManage, actions)
  return (
    <RowFrame
      dialog={revokeDialog}
      name={row.name}
      email={row.email}
      image={row.image}
      status='Invite pending'
      menuLabel={`Actions for ${row.email}`}
      actions={menu}
      control={
        row.isExternal || !canManage ? (
          <StatusTag label={row.isExternal ? 'External' : ORGANIZATION_ROLE_LABELS[row.role]} />
        ) : (
          <Select
            block
            variant='quiet'
            label={`Role for ${row.email}`}
            options={ORGANIZATION_ROLE_OPTIONS}
            value={row.role}
            disabled={actions.invitationPending}
            onValueChange={(next) =>
              void actions.changeInvitationRole(row.id, toOrganizationRole(next))
            }
          />
        )
      }
    />
  )
}

interface WorkspaceMemberRowProps {
  row: WorkspaceMemberRowModel
  workspaceId: string
  workspaceName: string
  actions: MembersActions
}

export function WorkspaceMemberRow({
  row,
  workspaceId,
  workspaceName,
  actions,
}: WorkspaceMemberRowProps) {
  const copyEmail = useCopyEmail(row.email)
  const [removing, setRemoving] = useState(false)
  const select = (
    <Select
      block
      variant='quiet'
      label={`Access to ${workspaceName} for ${row.name}`}
      options={WORKSPACE_ROLES}
      value={row.permission}
      disabled={!row.canEditPermission || actions.permissionPending}
      onValueChange={(next) =>
        void actions.changePermission(row.userId, workspaceId, toPermission(next))
      }
    />
  )
  return (
    <RowFrame
      name={row.name}
      email={row.email}
      image={row.image}
      status={row.status}
      dialog={
        <ConfirmDialog
          target={removing}
          onClose={() => setRemoving(false)}
          title='Remove from workspace'
          description={`${row.name} will lose access to ${workspaceName}.`}
          confirmLabel='Remove'
          pendingLabel='Removing…'
          onConfirm={() => actions.removeFromWorkspace(row.userId, workspaceId)}
        />
      }
      menuLabel={`Actions for ${row.name} in ${workspaceName}`}
      control={
        row.lockReason ? (
          <Tooltip label={row.lockReason}>
            <span className={styles.roleTooltip}>{select}</span>
          </Tooltip>
        ) : (
          select
        )
      }
      actions={[
        copyEmail,
        ...(row.canRemoveFromWorkspace
          ? [
              {
                id: 'remove',
                label: 'Remove from workspace',
                destructive: true,
                separatorBefore: true,
                onSelect: () => setRemoving(true),
              },
            ]
          : []),
      ]}
    />
  )
}

interface WorkspaceInvitationRowProps {
  row: WorkspaceInvitationRowModel
  workspaceId: string
  workspaceName: string
  canManage: boolean
  actions: MembersActions
}

export function WorkspaceInvitationRow({
  row,
  workspaceId,
  workspaceName,
  canManage,
  actions,
}: WorkspaceInvitationRowProps) {
  const { menu, revokeDialog } = useInvitationMenu(row, canManage, actions)
  return (
    <RowFrame
      dialog={revokeDialog}
      name={row.name}
      email={row.email}
      image={row.image}
      status='Invite pending'
      menuLabel={`Actions for ${row.email} in ${workspaceName}`}
      actions={menu}
      control={
        <Select
          block
          variant='quiet'
          label={`Access to ${workspaceName} for ${row.email}`}
          options={WORKSPACE_ROLES}
          value={row.permission}
          disabled={!canManage || actions.invitationPending}
          onValueChange={(next) =>
            void actions.changeInvitationPermission(row.id, workspaceId, toPermission(next))
          }
        />
      }
    />
  )
}
