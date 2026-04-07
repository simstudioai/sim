import { useMemo, useRef } from 'react'
import { Loader2, RotateCw, X } from 'lucide-react'
import { Badge, Button, Skeleton, Tooltip } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import type { PermissionType } from '@/lib/workspaces/permissions/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { WorkspacePermissions } from '@/hooks/queries/workspace'
import { PermissionSelector } from './permission-selector'
import type { UserPermissions } from './types'

const PermissionsTableSkeleton = () => (
  <div className='scrollbar-hide max-h-[300px] overflow-y-auto'>
    <div className='flex items-center justify-between gap-2 py-2'>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <Skeleton className='h-[14px] w-40 rounded-sm' />
        </div>
      </div>
      <div className='flex flex-shrink-0 items-center'>
        <div className='inline-flex gap-0.5'>
          <Skeleton className='h-[28px] w-[44px] rounded-[5px]' />
          <Skeleton className='h-[28px] w-[44px] rounded-[5px]' />
          <Skeleton className='h-[28px] w-[44px] rounded-[5px]' />
        </div>
      </div>
    </div>
  </div>
)

export interface PermissionsTableProps {
  userPermissions: UserPermissions[]
  onPermissionChange: (userId: string, permissionType: PermissionType) => void
  onRemoveMember?: (userId: string, email: string) => void
  onRemoveInvitation?: (invitationId: string, email: string) => void
  onResendInvitation?: (invitationId: string) => void
  disabled?: boolean
  existingUserPermissionChanges: Record<string, Partial<UserPermissions>>
  isSaving?: boolean
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  pendingInvitations: UserPermissions[]
  isPendingInvitationsLoading: boolean
  resendingInvitationIds?: Record<string, boolean>
  resentInvitationIds?: Record<string, boolean>
  resendCooldowns?: Record<string, number>
}

export const PermissionsTable = ({
  userPermissions,
  onPermissionChange,
  onRemoveMember,
  onRemoveInvitation,
  disabled,
  existingUserPermissionChanges,
  isSaving,
  workspacePermissions,
  permissionsLoading,
  pendingInvitations,
  isPendingInvitationsLoading,
  onResendInvitation,
  resendingInvitationIds,
  resentInvitationIds,
  resendCooldowns,
}: PermissionsTableProps) => {
  const { data: session } = useSession()
  const userPerms = useUserPermissionsContext()
  const hasLoadedOnceRef = useRef(false)

  if (
    !hasLoadedOnceRef.current &&
    !permissionsLoading &&
    !userPerms.isLoading &&
    !isPendingInvitationsLoading
  ) {
    hasLoadedOnceRef.current = true
  }

  const hasLoadedOnce = hasLoadedOnceRef.current

  const existingUsers: UserPermissions[] = useMemo(
    () =>
      workspacePermissions?.users?.map((user) => {
        const changes = existingUserPermissionChanges[user.userId] || {}
        const permissionType = user.permissionType || 'read'

        return {
          userId: user.userId,
          email: user.email,
          permissionType:
            changes.permissionType !== undefined ? changes.permissionType : permissionType,
          isCurrentUser: user.email === session?.user?.email,
        }
      }) || [],
    [workspacePermissions?.users, existingUserPermissionChanges, session?.user?.email]
  )

  const currentUser: UserPermissions | null = useMemo(
    () =>
      session?.user?.email
        ? existingUsers.find((user) => user.isCurrentUser) || {
            email: session.user.email,
            permissionType: 'admin',
            isCurrentUser: true,
          }
        : null,
    [session?.user?.email, existingUsers]
  )

  const filteredExistingUsers = useMemo(
    () => existingUsers.filter((user) => !user.isCurrentUser),
    [existingUsers]
  )

  const allUsers: UserPermissions[] = useMemo(() => {
    const existingUserEmails = new Set([
      ...(currentUser ? [currentUser.email] : []),
      ...filteredExistingUsers.map((user) => user.email),
    ])

    const filteredPendingInvitations = pendingInvitations.filter(
      (invitation) => !existingUserEmails.has(invitation.email)
    )

    return [
      ...(currentUser ? [currentUser] : []),
      ...filteredExistingUsers,
      ...userPermissions,
      ...filteredPendingInvitations,
    ]
  }, [currentUser, filteredExistingUsers, userPermissions, pendingInvitations])

  const shouldShowSkeleton =
    !hasLoadedOnce && (permissionsLoading || userPerms.isLoading || isPendingInvitationsLoading)

  if (shouldShowSkeleton) {
    return <PermissionsTableSkeleton />
  }

  if (userPermissions.length === 0 && !session?.user?.email && !workspacePermissions?.users?.length)
    return null

  if (isSaving) {
    return (
      <div className='space-y-3'>
        <h3 className='font-medium text-[var(--text-primary)] text-sm'>Member Permissions</h3>
        <div className='rounded-lg border border-[var(--border-1)] bg-[var(--surface-3)]'>
          <div className='flex items-center justify-center py-12'>
            <div className='flex items-center gap-2 text-[var(--text-secondary)]'>
              <Loader2 className='h-[16px] w-[16px] animate-spin' />
              <span className='font-medium text-small'>Saving permission changes...</span>
            </div>
          </div>
        </div>
        <p className='flex min-h-[2rem] items-start text-[var(--text-tertiary)] text-caption'>
          Please wait while we update the permissions.
        </p>
      </div>
    )
  }

  const currentUserIsAdmin = userPerms.canAdmin

  return (
    <div className='scrollbar-hide max-h-[300px] overflow-y-auto'>
      {allUsers.length > 0 && (
        <div>
          {allUsers.map((user) => {
            const isCurrentUser = user.isCurrentUser === true
            const isPendingInvitation = user.isPendingInvitation === true
            const userIdentifier = user.userId || user.email
            const originalPermission = workspacePermissions?.users?.find(
              (eu) => eu.userId === user.userId
            )?.permissionType
            const currentPermission =
              existingUserPermissionChanges[userIdentifier]?.permissionType ?? user.permissionType
            const hasChanges = originalPermission && currentPermission !== originalPermission
            const isWorkspaceMember = workspacePermissions?.users?.some(
              (eu) => eu.email === user.email && eu.userId
            )
            const canShowRemoveButton =
              isWorkspaceMember &&
              !isCurrentUser &&
              !isPendingInvitation &&
              currentUserIsAdmin &&
              user.userId

            const uniqueKey = user.userId
              ? `existing-${user.userId}`
              : isPendingInvitation
                ? `pending-${user.email}`
                : `new-${user.email}`

            return (
              <div key={uniqueKey} className='flex items-center justify-between gap-2 py-2'>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <span className='truncate font-medium text-[var(--text-primary)] text-small'>
                      {user.email}
                    </span>
                    {isPendingInvitation && (
                      <Badge variant='default' className='gap-1 text-caption'>
                        {resendingInvitationIds &&
                        user.invitationId &&
                        resendingInvitationIds[user.invitationId] ? (
                          <span>Sending...</span>
                        ) : resentInvitationIds &&
                          user.invitationId &&
                          resentInvitationIds[user.invitationId] ? (
                          <span>Resent</span>
                        ) : (
                          <span>Sent</span>
                        )}
                      </Badge>
                    )}
                    {hasChanges && (
                      <Badge variant='default' className='text-caption'>
                        Modified
                      </Badge>
                    )}

                    {isPendingInvitation &&
                      currentUserIsAdmin &&
                      user.invitationId &&
                      onResendInvitation && (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <span className='inline-flex'>
                              <Button
                                variant='ghost'
                                onClick={() => onResendInvitation(user.invitationId!)}
                                disabled={
                                  disabled ||
                                  isSaving ||
                                  resendingInvitationIds?.[user.invitationId!] ||
                                  (resendCooldowns && resendCooldowns[user.invitationId!] > 0)
                                }
                                className='h-[16px] w-[16px] p-0'
                              >
                                {resendingInvitationIds?.[user.invitationId!] ? (
                                  <Loader2 className='h-[12px] w-[12px] animate-spin' />
                                ) : (
                                  <RotateCw className='h-[12px] w-[12px]' />
                                )}
                                <span className='sr-only'>Resend invite</span>
                              </Button>
                            </span>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            <p>
                              {resendCooldowns?.[user.invitationId!]
                                ? `Resend in ${resendCooldowns[user.invitationId!]}s`
                                : 'Resend invite'}
                            </p>
                          </Tooltip.Content>
                        </Tooltip.Root>
                      )}
                    {((canShowRemoveButton && onRemoveMember) ||
                      (isPendingInvitation &&
                        currentUserIsAdmin &&
                        user.invitationId &&
                        onRemoveInvitation)) && (
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            onClick={() => {
                              if (canShowRemoveButton && onRemoveMember) {
                                onRemoveMember(user.userId!, user.email)
                              } else if (
                                isPendingInvitation &&
                                user.invitationId &&
                                onRemoveInvitation
                              ) {
                                onRemoveInvitation(user.invitationId, user.email)
                              }
                            }}
                            disabled={disabled || isSaving}
                            className='h-[16px] w-[16px] p-0'
                          >
                            <X className='h-[14px] w-[14px]' />
                            <span className='sr-only'>
                              {isPendingInvitation ? 'Revoke invite' : 'Remove member'}
                            </span>
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          <p>{isPendingInvitation ? 'Revoke invite' : 'Remove member'}</p>
                        </Tooltip.Content>
                      </Tooltip.Root>
                    )}
                  </div>
                </div>

                <div className='flex flex-shrink-0 items-center'>
                  <PermissionSelector
                    value={user.permissionType}
                    onChange={(newPermission) => onPermissionChange(userIdentifier, newPermission)}
                    disabled={
                      disabled ||
                      !currentUserIsAdmin ||
                      isPendingInvitation ||
                      (isCurrentUser && user.permissionType === 'admin')
                    }
                    className='w-auto'
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

PermissionsTable.displayName = 'PermissionsTable'
