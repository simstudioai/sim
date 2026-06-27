'use client'

import { useCallback, useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { Chip, ChipDropdown, Plus, toast } from '@/components/emcn'
import {
  RoleLockTooltip,
  type WorkspaceRoleSource,
  workspaceRoleLockReason,
} from '@/components/permissions'
import type { WorkspacePermission } from '@/lib/api/contracts/workspaces'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import {
  MemberRow,
  MemberSection,
} from '@/app/workspace/[workspaceId]/settings/components/member-list'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { InviteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/invite-modal'
import {
  useCancelWorkspaceInvitation,
  usePendingInvitations,
  useRemoveWorkspaceMember,
  useResendWorkspaceInvitation,
  useUpdateWorkspacePermissions,
} from '@/hooks/queries/invitations'
import { prefetchUpgradeBillingData } from '@/hooks/queries/subscription'
import {
  prefetchWorkspaceSettings,
  useWorkspacePermissionsQuery,
  useWorkspacesQuery,
} from '@/hooks/queries/workspace'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const ROLE_OPTIONS = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'admin', label: 'Admin' },
] as const

interface Teammate {
  key: string
  email: string
  name: string
  image: string | null
  role: WorkspacePermission
  status: string
  isPending: boolean
  userId?: string
  invitationId?: string
  token?: string
  roleSource?: WorkspaceRoleSource
}

function formatJoinedDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US')
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text)
}

function buildInviteLink(invitationId: string, token: string) {
  return `${window.location.origin}/invite/${invitationId}?token=${token}`
}

export function Teammates() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const [searchTerm, setSearchTerm] = useState('')
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)

  const { data: permissions, isPending: permissionsLoading } =
    useWorkspacePermissionsQuery(workspaceId)
  const { data: invitations } = usePendingInvitations(workspaceId)
  const { data: workspaces } = useWorkspacesQuery()

  const router = useRouter()
  const queryClient = useQueryClient()
  const { isInvitationsDisabled: isInvitationsDisabledByConfig } = usePermissionConfig()

  const resendInvitation = useResendWorkspaceInvitation()
  const cancelInvitation = useCancelWorkspaceInvitation()
  const removeMember = useRemoveWorkspaceMember()
  const updatePermissions = useUpdateWorkspacePermissions()

  const viewer = permissions?.viewer
  const canManage = Boolean(viewer?.isAdmin)

  const activeWorkspace = workspaces?.find((workspace) => workspace.id === workspaceId)
  const inviteDisabledReason = activeWorkspace?.inviteDisabledReason ?? null
  const isInvitationsDisabled = isInvitationsDisabledByConfig || inviteDisabledReason !== null

  const upgradeHref = buildUpgradeHref(workspaceId, 'seats')

  /**
   * Warm the Upgrade route bundle and the queries it gates on, so a gated
   * invite click lands on cached data instead of a loading state.
   */
  const prefetchUpgrade = useCallback(() => {
    router.prefetch(upgradeHref)
    prefetchUpgradeBillingData(queryClient)
    prefetchWorkspaceSettings(queryClient, workspaceId)
  }, [router, queryClient, upgradeHref, workspaceId])

  const handleInvite = () => {
    if (isInvitationsDisabled) {
      if (isBillingEnabled) router.push(upgradeHref)
      return
    }
    setIsInviteModalOpen(true)
  }

  const teammates = useMemo<Teammate[]>(() => {
    const members: Teammate[] = (permissions?.users ?? []).map((member) => ({
      key: member.userId,
      email: member.email,
      name: member.name ?? member.email,
      image: member.image,
      role: member.permissionType,
      status: `Joined ${formatJoinedDate(member.joinedAt)}`,
      isPending: false,
      userId: member.userId,
      roleSource: member.roleSource,
    }))

    const pending: Teammate[] = (invitations ?? []).map((invitation) => ({
      key: invitation.invitationId ?? invitation.email,
      email: invitation.email,
      name: invitation.email,
      image: null,
      role: invitation.permissionType,
      status: 'Invite pending',
      isPending: true,
      invitationId: invitation.invitationId,
      token: invitation.token,
    }))

    return [...members, ...pending]
  }, [permissions, invitations])

  const filteredTeammates = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return teammates
    return teammates.filter(
      (teammate) =>
        teammate.email.toLowerCase().includes(query) || teammate.name.toLowerCase().includes(query)
    )
  }, [teammates, searchTerm])

  const showNoResults = !permissionsLoading && filteredTeammates.length === 0

  const handleRoleChange = (teammate: Teammate, role: WorkspacePermission) => {
    if (!teammate.userId || role === teammate.role) return
    updatePermissions.mutate({
      workspaceId,
      updates: [{ userId: teammate.userId, permissions: role }],
    })
  }

  return (
    <>
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search teammates...',
        }}
        actions={
          <Chip
            leftIcon={Plus}
            variant='primary'
            onClick={handleInvite}
            onMouseEnter={isInvitationsDisabled ? prefetchUpgrade : undefined}
            onFocus={isInvitationsDisabled ? prefetchUpgrade : undefined}
            title={inviteDisabledReason ?? undefined}
          >
            Invite
          </Chip>
        }
      >
        <MemberSection
          label={`Teammates (${teammates.length})`}
          isEmpty={showNoResults}
          emptyText={
            searchTerm.trim() ? `No teammates found matching “${searchTerm}”` : 'No teammates yet'
          }
        >
          {filteredTeammates.map((teammate) => (
            <MemberRow
              key={teammate.key}
              name={teammate.name}
              email={teammate.email}
              image={teammate.image}
              status={teammate.status}
              roleControl={(() => {
                const lockReason = teammate.isPending
                  ? null
                  : workspaceRoleLockReason(teammate.roleSource)
                return (
                  <RoleLockTooltip reason={lockReason}>
                    <ChipDropdown
                      value={teammate.role}
                      onChange={(role) => handleRoleChange(teammate, role as WorkspacePermission)}
                      options={ROLE_OPTIONS}
                      matchTriggerWidth={false}
                      disabled={
                        teammate.isPending ||
                        !canManage ||
                        teammate.userId === viewer?.userId ||
                        lockReason !== null
                      }
                    />
                  </RoleLockTooltip>
                )
              })()}
              menu={
                <RowActionsMenu
                  label='Teammate actions'
                  actions={[
                    {
                      label: 'Copy email',
                      onSelect: () => copyToClipboard(teammate.email),
                    },
                    ...(canManage && teammate.isPending
                      ? [
                          {
                            label: 'Resend invite',
                            onSelect: () => {
                              if (teammate.invitationId) {
                                resendInvitation.mutate({
                                  invitationId: teammate.invitationId,
                                  workspaceId,
                                })
                              }
                            },
                          },
                          {
                            label: 'Copy invite link',
                            onSelect: () => {
                              if (teammate.invitationId && teammate.token) {
                                copyToClipboard(
                                  buildInviteLink(teammate.invitationId, teammate.token)
                                )
                              }
                            },
                          },
                          {
                            label: 'Revoke invite',
                            destructive: true,
                            onSelect: () => {
                              if (teammate.invitationId) {
                                cancelInvitation.mutate({
                                  invitationId: teammate.invitationId,
                                  workspaceId,
                                })
                              }
                            },
                          },
                        ]
                      : []),
                    ...(canManage && !teammate.isPending && teammate.userId !== viewer?.userId
                      ? [
                          {
                            label: 'Remove',
                            destructive: true,
                            onSelect: () => {
                              if (teammate.userId) {
                                removeMember.mutate(
                                  { userId: teammate.userId, workspaceId },
                                  {
                                    onError: (error) => {
                                      toast.error("Couldn't remove teammate", {
                                        description: getErrorMessage(
                                          error,
                                          'Please try again in a moment.'
                                        ),
                                      })
                                    },
                                  }
                                )
                              }
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />
          ))}
        </MemberSection>
      </SettingsPanel>

      <InviteModal
        open={isInviteModalOpen}
        onOpenChange={setIsInviteModalOpen}
        workspaceName={activeWorkspace?.name ?? 'Workspace'}
        inviteDisabledReason={inviteDisabledReason}
        organizationId={activeWorkspace?.organizationId ?? null}
      />
    </>
  )
}
