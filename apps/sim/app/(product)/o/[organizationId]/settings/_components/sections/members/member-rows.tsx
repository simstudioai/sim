'use client'

import type { ReactNode } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import type { MenuAction } from '@sim/emcn/menu/action-menu'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SettingsRow } from '@sim/emcn/settings-section'
import { StatusTag } from '@sim/emcn/status'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/members.module.css'
import type { MembersActions } from '@/platform/lib/data/members'
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
}

function RowFrame({ name, email, image, status, control, menuLabel, actions }: RowFrameProps) {
  return (
    <SettingsRow
      label={name}
      description={`${email} · ${status}`}
      leading={<Avatar name={name} src={image} />}
    >
      <span className={styles.controls}>
        {control}
        <ActionMenu label={menuLabel} icon='I108' align='end' actions={actions} />
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
          <ChoiceMenu
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
          onSelect: () => void actions.revokeInvitation(row.id),
        },
      ]
    : []
  return [copyEmail, ...manage]
}

export function InvitationRow({ row, canManage, actions }: InvitationRowProps) {
  const menu = useInvitationMenu(row, canManage, actions)
  return (
    <RowFrame
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
          <ChoiceMenu
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
  actions: MembersActions
}

export function WorkspaceMemberRow({ row, workspaceId, actions }: WorkspaceMemberRowProps) {
  const copyEmail = useCopyEmail(row.email)
  const select = (
    <ChoiceMenu
      label={`Workspace access for ${row.name}`}
      options={WORKSPACE_ROLES}
      value={row.permission}
      disabled={!row.canEditPermission || actions.permissionPending}
      disabledReason={row.lockReason ?? undefined}
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
      menuLabel={`Actions for ${row.name}`}
      control={select}
      actions={[
        copyEmail,
        ...(row.canRemoveFromWorkspace
          ? [
              {
                id: 'remove',
                label: 'Remove from workspace',
                destructive: true,
                separatorBefore: true,
                onSelect: () => void actions.removeFromWorkspace(row.userId, workspaceId),
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
  canManage: boolean
  actions: MembersActions
}

export function WorkspaceInvitationRow({
  row,
  workspaceId,
  canManage,
  actions,
}: WorkspaceInvitationRowProps) {
  const menu = useInvitationMenu(row, canManage, actions)
  return (
    <RowFrame
      name={row.name}
      email={row.email}
      image={row.image}
      status='Invite pending'
      menuLabel={`Actions for ${row.email}`}
      actions={menu}
      control={
        <ChoiceMenu
          label={`Workspace access for ${row.email}`}
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
