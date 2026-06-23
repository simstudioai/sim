'use client'

import { useCallback, useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import {
  Chip,
  ChipDropdown,
  ChipInput,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoreHorizontal,
  Plus,
  Search,
  toast,
} from '@/components/emcn'
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
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <div />
        <div className='flex items-center'>
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
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <div className='flex flex-col gap-1'>
            <h1 className='font-medium text-[var(--text-body)] text-lg'>Teammates</h1>
            <p className='text-[var(--text-muted)] text-md'>
              Manage your teammates in this workspace.
            </p>
          </div>

          <div className='flex items-center gap-2'>
            <ChipInput
              icon={Search}
              placeholder='Search teammates...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='flex-1'
            />
          </div>

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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        aria-label='Teammate actions'
                        className={chipVariants({ flush: true })}
                      >
                        <MoreHorizontal className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onSelect={() => copyToClipboard(teammate.email)}>
                        Copy email
                      </DropdownMenuItem>
                      {canManage && teammate.isPending && (
                        <>
                          <DropdownMenuItem
                            onSelect={() => {
                              if (teammate.invitationId) {
                                resendInvitation.mutate({
                                  invitationId: teammate.invitationId,
                                  workspaceId,
                                })
                              }
                            }}
                          >
                            Resend invite
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              if (teammate.invitationId && teammate.token) {
                                copyToClipboard(
                                  buildInviteLink(teammate.invitationId, teammate.token)
                                )
                              }
                            }}
                          >
                            Copy invite link
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className='text-[var(--text-error)]'
                            onSelect={() => {
                              if (teammate.invitationId) {
                                cancelInvitation.mutate({
                                  invitationId: teammate.invitationId,
                                  workspaceId,
                                })
                              }
                            }}
                          >
                            Revoke invite
                          </DropdownMenuItem>
                        </>
                      )}
                      {canManage && !teammate.isPending && teammate.userId !== viewer?.userId && (
                        <DropdownMenuItem
                          className='text-[var(--text-error)]'
                          onSelect={() => {
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
                          }}
                        >
                          Remove
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            ))}
          </MemberSection>
        </div>
      </div>

      <InviteModal
        open={isInviteModalOpen}
        onOpenChange={setIsInviteModalOpen}
        workspaceName={activeWorkspace?.name ?? 'Workspace'}
        inviteDisabledReason={inviteDisabledReason}
        organizationId={activeWorkspace?.organizationId ?? null}
      />
    </div>
  )
}
