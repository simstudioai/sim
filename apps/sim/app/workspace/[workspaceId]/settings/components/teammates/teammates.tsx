'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Chip,
  ChipDropdown,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoreHorizontal,
  Plus,
} from '@/components/emcn'
import type { WorkspacePermission } from '@/lib/api/contracts/workspaces'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
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

const ROW_CLASSES = 'flex items-center gap-2.5 p-2'
const ROW_EMAIL_CLASSES = 'min-w-0 flex-1 truncate text-[14px] text-[var(--text-body)]'
const ROW_STATUS_CLASSES = 'flex-shrink-0 text-[12px] text-[var(--text-muted)]'

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

function TeammateAvatar({ name, image }: { name: string; image: string | null }) {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        referrerPolicy='no-referrer'
        className='size-[14px] flex-shrink-0 rounded-full border border-[var(--border)] object-cover'
      />
    )
  }

  return (
    <span className='flex size-[14px] flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
      {name.charAt(0).toUpperCase()}
    </span>
  )
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

  const upgradeHref = `/workspace/${workspaceId}/upgrade`

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
            <div className='flex h-[30px] flex-1 items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 dark:bg-[var(--surface-4)]'>
              <Search className='size-[14px] flex-shrink-0 text-[var(--text-muted)]' />
              <input
                placeholder='Search teammates...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className='h-full w-full bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
              />
            </div>
          </div>

          <SettingsSection label={`Teammates (${teammates.length})`}>
            {showNoResults ? (
              <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                {searchTerm.trim()
                  ? `No teammates found matching “${searchTerm}”`
                  : 'No teammates yet'}
              </div>
            ) : (
              <div className='-mx-2 flex flex-col gap-y-0.5'>
                {filteredTeammates.map((teammate) => (
                  <div key={teammate.key} className={ROW_CLASSES}>
                    <TeammateAvatar name={teammate.name} image={teammate.image} />
                    <span className={ROW_EMAIL_CLASSES}>{teammate.email}</span>
                    <span className={ROW_STATUS_CLASSES}>{teammate.status}</span>
                    <ChipDropdown
                      value={teammate.role}
                      onChange={(role) => handleRoleChange(teammate, role as WorkspacePermission)}
                      options={ROLE_OPTIONS}
                      matchTriggerWidth={false}
                      disabled={
                        teammate.isPending || !canManage || teammate.userId === viewer?.userId
                      }
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type='button'
                          aria-label='Teammate actions'
                          className={chipVariants({ variant: 'ghost', flush: true })}
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
                                removeMember.mutate({ userId: teammate.userId, workspaceId })
                              }
                            }}
                          >
                            Remove
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>
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
