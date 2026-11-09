'use client'

import { useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/section-registry'
import { InviteTeammatesModal } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/teammates/invite-teammates-modal'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/teammates/teammates.module.css'
import {
  useCancelWorkspaceInvitation,
  useDeploymentShape,
  usePendingInvitations,
  useRemoveWorkspaceMember,
  useResendWorkspaceInvitation,
  useSettingsSearch,
  useUpdateWorkspacePermissions,
  useWorkspaceInvitePolicy,
  useWorkspacePermissionsQuery,
  useWorkspacesQuery,
  type WorkspacePermission,
  workspaceRoleLockReason,
} from '@/platform/lib/data/teammates'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { platformHref } from '@/platform/lib/navigation'
import { formatInstantDate } from '@/platform/shared/time'
import { toast } from '@/platform/shared/toast'

const ROLE_OPTIONS = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'admin', label: 'Admin' },
] as const

function toPermission(value: string): WorkspacePermission {
  return value === 'admin' || value === 'read' ? value : 'write'
}

/**
 * Why a member cannot be removed, which differs from why their role is fixed: organization admins
 * hold the workspace through their organization role, and the billing account must be reassigned.
 */
function removalLockReason(member: {
  isOrgAdmin?: boolean
  isBilledAccount?: boolean
}): string | null {
  if (member.isOrgAdmin)
    return 'Organization admins are automatically workspace admins. Change their organization role to remove them.'
  if (member.isBilledAccount)
    return 'Reassign billing before removing the workspace billing account'
  return null
}

/** Membership outside the workspace's organization is a separate axis from the permission. */
function withExternalLabel(status: string, isExternal: boolean): string {
  return isExternal ? `${status} · External` : status
}

/** Shows a failed row action: the row has no dialog of its own to hold the error. */
async function reportFailure(work: Promise<unknown>, message: string) {
  try {
    await work
  } catch (error) {
    toast.error(message, { description: getErrorMessage(error, 'Please try again in a moment.') })
  }
}

interface Teammate {
  key: string
  email: string
  name: string
  image?: string
  role: WorkspacePermission
  status: string
  /** Set for a member; absent for a pending invitation. */
  userId?: string
  invitationId?: string
  token?: string
  lockReason: string | null
  removalLockReason: string | null
}

/** The workspace's members and pending invitations, their permissions, and the invite entry. */
export default function TeammatesSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { hostContext, canMutate: canManage } = useWorkspaceSettingsSection(
    workspaceId,
    'teammates'
  )
  const router = useRouter()
  const search = useSearchParams()
  const { copy } = useClipboard()
  const { billingEnabled } = useDeploymentShape()
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [inviting, setInviting] = useState(false)
  const permissions = useWorkspacePermissionsQuery(workspaceId)
  const invitations = usePendingInvitations(workspaceId)
  const { data: workspaces } = useWorkspacesQuery()
  const { inviteDisabledReason, isInvitationsDisabled } = useWorkspaceInvitePolicy(workspaceId)
  const resendInvitation = useResendWorkspaceInvitation()
  const cancelInvitation = useCancelWorkspaceInvitation()
  const removeMember = useRemoveWorkspaceMember()
  const updatePermissions = useUpdateWorkspacePermissions()

  const viewerId = permissions.data?.viewer?.userId
  const workspace = workspaces?.find((candidate) => candidate.id === workspaceId)
  const organizationId = workspace?.organizationId ?? null

  const teammates: Teammate[] = [
    ...(permissions.data?.users ?? []).map((member) => ({
      key: member.userId,
      email: member.email,
      name: member.name ?? member.email,
      image: member.image ?? undefined,
      role: member.permissionType,
      status: withExternalLabel(`Joined ${formatInstantDate(member.joinedAt)}`, member.isExternal),
      userId: member.userId,
      lockReason: workspaceRoleLockReason(member.roleSource, {
        isBilledAccount: member.isBilledAccount,
      }),
      removalLockReason: removalLockReason(member),
    })),
    ...(invitations.data ?? []).map((invitation) => ({
      key: invitation.invitationId ?? invitation.email,
      email: invitation.email,
      name: invitation.email,
      role: invitation.permissionType,
      status: withExternalLabel('Invite pending', invitation.isExternal),
      invitationId: invitation.invitationId,
      token: invitation.token,
      lockReason: null,
      removalLockReason: null,
    })),
  ]
  const term = searchTerm.trim().toLowerCase()
  const visible = term
    ? teammates.filter(
        (teammate) =>
          teammate.email.toLowerCase().includes(term) || teammate.name.toLowerCase().includes(term)
      )
    : teammates

  const handleInvite = () => {
    if (isInvitationsDisabled) {
      if (billingEnabled) router.push(platformHref('/settings/billing/plans?reason=seats', search))
      return
    }
    setInviting(true)
  }

  const rowActions = (teammate: Teammate): MenuAction[] => {
    const { invitationId, token, userId } = teammate
    const actions: MenuAction[] = [
      { id: 'copy-email', label: 'Copy email', onSelect: () => void copy(teammate.email) },
    ]
    if (canManage && invitationId) {
      actions.push(
        {
          id: 'resend',
          label: 'Resend invite',
          onSelect: () =>
            void reportFailure(
              resendInvitation.mutateAsync({ invitationId, workspaceId }),
              "Couldn't resend the invite"
            ),
        },
        {
          id: 'copy-link',
          label: 'Copy invite link',
          disabled: !token,
          onSelect: () => {
            if (token) void copy(`${window.location.origin}/invite/${invitationId}?token=${token}`)
          },
        },
        {
          id: 'revoke',
          label: 'Revoke invite',
          destructive: true,
          separatorBefore: true,
          onSelect: () =>
            void reportFailure(
              cancelInvitation.mutateAsync({ invitationId, workspaceId }),
              "Couldn't revoke the invite"
            ),
        }
      )
    }
    if (canManage && userId && userId !== viewerId) {
      actions.push({
        id: 'remove',
        label: 'Remove',
        destructive: true,
        separatorBefore: true,
        disabled: teammate.removalLockReason !== null,
        disabledReason: teammate.removalLockReason ?? undefined,
        onSelect: () =>
          void reportFailure(
            removeMember.mutateAsync({ userId, workspaceId }),
            "Couldn't remove teammate"
          ),
      })
    }
    return actions
  }

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search teammates'
            placeholder='Search teammates...'
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        }
      >
        {canManage && (
          <Tooltip label={inviteDisabledReason ?? ''} enabled={Boolean(inviteDisabledReason)}>
            <span>
              <Button variant='primary' size='compact' icon='I074' onClick={handleInvite}>
                Invite
              </Button>
            </span>
          </Tooltip>
        )}
      </SectionToolbar>
      {permissions.isPending ? (
        <SettingsSection title='Teammates' />
      ) : permissions.isError ? (
        <FailureNotice
          message={getErrorMessage(permissions.error, 'Failed to load teammates')}
          retrying={permissions.isFetching}
          onRetry={() => void permissions.refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={term ? `No teammates found matching “${searchTerm}”` : 'No teammates yet'}
        />
      ) : (
        <SettingsSection title={`Teammates ${teammates.length}`}>
          {visible.map((teammate) => (
            <SettingsRow
              key={teammate.key}
              label={teammate.name}
              description={`${teammate.email} · ${teammate.status}`}
              leading={<Avatar name={teammate.name} src={teammate.image} />}
            >
              <span className={styles.controls}>
                <ChoiceMenu
                  label={`Workspace access for ${teammate.name}`}
                  options={ROLE_OPTIONS}
                  value={teammate.role}
                  disabled={
                    !teammate.userId ||
                    !canManage ||
                    teammate.userId === viewerId ||
                    teammate.lockReason !== null
                  }
                  disabledReason={teammate.lockReason ?? undefined}
                  onValueChange={(next) => {
                    const role = toPermission(next)
                    if (!teammate.userId || role === teammate.role) return
                    void reportFailure(
                      updatePermissions.mutateAsync({
                        workspaceId,
                        updates: [{ userId: teammate.userId, permissions: role }],
                      }),
                      "Couldn't change workspace access"
                    )
                  }}
                />
                <ActionMenu
                  label={`Actions for ${teammate.name}`}
                  icon='I108'
                  align='end'
                  actions={rowActions(teammate)}
                />
              </span>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}
      {canManage && (
        <InviteTeammatesModal
          open={inviting}
          onOpenChange={setInviting}
          workspaceId={workspaceId}
          workspaceName={workspace?.name ?? 'Workspace'}
          organizationId={organizationId}
          inviteDisabledReason={inviteDisabledReason}
          isOrganizationAdmin={Boolean(
            organizationId &&
              hostContext?.hostOrganizationId === organizationId &&
              hostContext.viewer.isHostOrganizationAdmin
          )}
        />
      )}
    </SectionStack>
  )
}
