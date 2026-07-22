'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChipDropdown, Plus, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import {
  RoleLockTooltip,
  type WorkspaceRoleSource,
  workspaceRoleLockReason,
} from '@/components/permissions'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import type { WorkspacePermission } from '@/lib/api/contracts/workspaces'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import {
  MemberRow,
  MemberSection,
} from '@/app/workspace/[workspaceId]/settings/components/member-list'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { resolveTeammatesDataState } from '@/app/workspace/[workspaceId]/settings/components/teammates/teammates-state'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
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

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text)
}

function buildInviteLink(invitationId: string, token: string) {
  return `${window.location.origin}/invite/${invitationId}?token=${token}`
}

export function Teammates() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)

  const {
    data: permissions,
    isPending: permissionsLoading,
    isError: permissionsError,
    isPlaceholderData: permissionsPlaceholder,
  } = useWorkspacePermissionsQuery(workspaceId)
  const {
    data: invitations,
    isPending: invitationsLoading,
    isError: invitationsError,
    isPlaceholderData: invitationsPlaceholder,
  } = usePendingInvitations(workspaceId)
  const {
    data: workspaces,
    isPending: workspacesLoading,
    isError: workspacesError,
    isPlaceholderData: workspacesPlaceholder,
  } = useWorkspacesQuery()

  const router = useRouter()
  const queryClient = useQueryClient()
  const {
    isInvitationsDisabled: isInvitationsDisabledByConfig,
    isLoading: permissionConfigLoading,
    isError: permissionConfigError,
  } = usePermissionConfig()

  const resendInvitation = useResendWorkspaceInvitation()
  const cancelInvitation = useCancelWorkspaceInvitation()
  const removeMember = useRemoveWorkspaceMember()
  const updatePermissions = useUpdateWorkspacePermissions()

  const activeWorkspace = workspaces?.find((workspace) => workspace.id === workspaceId)
  const queryDataState = resolveTeammatesDataState({
    permissionsError,
    invitationsError,
    workspacesError,
    permissionConfigError,
    permissionsLoading,
    permissionsPlaceholder,
    invitationsLoading,
    invitationsPlaceholder,
    workspacesLoading,
    workspacesPlaceholder,
    permissionConfigLoading,
  })
  const dataState = queryDataState === 'ready' && !activeWorkspace ? 'error' : queryDataState
  const hasLoadError = dataState === 'error'
  const isLoading = dataState === 'loading'

  const viewer = permissions?.viewer
  const canManage =
    canMutateWorkspaceSettingsSection('teammates', {
      canEdit: viewer?.permissionType === 'write' || viewer?.permissionType === 'admin',
      canAdmin: Boolean(viewer?.isAdmin),
    }) && dataState === 'ready'

  useEffect(() => {
    if (!canManage) setIsInviteModalOpen(false)
  }, [canManage])

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
      status: `Joined ${formatDate(new Date(member.joinedAt))}`,
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

  const showNoResults = dataState === 'ready' && filteredTeammates.length === 0

  const handleRoleChange = (teammate: Teammate, role: WorkspacePermission) => {
    if (!teammate.userId || role === teammate.role) return
    updatePermissions.mutate({
      workspaceId,
      organizationId: activeWorkspace?.organizationId ?? undefined,
      updates: [{ userId: teammate.userId, permissions: role }],
    })
  }

  return (
    <>
      <section
        aria-label='Workspace teammates'
        aria-busy={isLoading}
        data-teammates-state={dataState}
      >
        <SettingsPanel
          search={{
            value: searchTerm,
            onChange: setSearchTerm,
            placeholder: 'Search teammates...',
          }}
          actions={
            canManage
              ? [
                  {
                    text: 'Invite',
                    icon: Plus,
                    variant: 'primary',
                    onSelect: handleInvite,
                    tooltip: inviteDisabledReason ?? undefined,
                    onPrefetch: isInvitationsDisabled ? prefetchUpgrade : undefined,
                  },
                ]
              : []
          }
        >
          {hasLoadError ? (
            <SettingsEmptyState>Unable to load teammates</SettingsEmptyState>
          ) : isLoading ? null : (
            <MemberSection
              label={`Teammates (${teammates.length})`}
              ariaLabel='Teammates'
              isEmpty={showNoResults}
              emptyText={
                searchTerm.trim()
                  ? `No teammates found matching “${searchTerm}”`
                  : 'No teammates yet'
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
                          onChange={(role) =>
                            handleRoleChange(teammate, role as WorkspacePermission)
                          }
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
                                      organizationId: activeWorkspace?.organizationId ?? undefined,
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
                                      organizationId: activeWorkspace?.organizationId ?? undefined,
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
                                      {
                                        userId: teammate.userId,
                                        workspaceId,
                                        organizationId:
                                          activeWorkspace?.organizationId ?? undefined,
                                      },
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
          )}
        </SettingsPanel>
      </section>

      {canManage && (
        <InviteModal
          open={isInviteModalOpen}
          onOpenChange={setIsInviteModalOpen}
          workspaceName={activeWorkspace?.name ?? 'Workspace'}
          inviteDisabledReason={inviteDisabledReason}
          organizationId={activeWorkspace?.organizationId ?? null}
        />
      )}
    </>
  )
}
