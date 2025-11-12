'use client'

import React, { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCw, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Badge, Button, Input, Modal, ModalContent, Tooltip } from '@/components/emcn'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'
import { quickValidateEmail } from '@/lib/email/validation'
import { createLogger } from '@/lib/logs/console/logger'
import type { PermissionType } from '@/lib/permissions/utils'
import { cn } from '@/lib/utils'
import {
  useUserPermissionsContext,
  useWorkspacePermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { WorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { API_ENDPOINTS } from '@/stores/constants'

const logger = createLogger('InviteModal')

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInviteMember?: (email: string) => void
  workspaceName?: string
}

interface EmailTagProps {
  email: string
  onRemove: () => void
  disabled?: boolean
  isInvalid?: boolean
  isSent?: boolean
}

interface UserPermissions {
  userId?: string
  email: string
  permissionType: PermissionType
  isCurrentUser?: boolean
  isPendingInvitation?: boolean
  invitationId?: string
}

interface PermissionsTableProps {
  userPermissions: UserPermissions[]
  onPermissionChange: (userId: string, permissionType: PermissionType) => void
  onRemoveMember?: (userId: string, email: string) => void
  onRemoveInvitation?: (invitationId: string, email: string) => void
  onResendInvitation?: (invitationId: string, email: string) => void
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

interface PendingInvitation {
  id: string
  workspaceId: string
  email: string
  permissions: PermissionType
  status: string
  createdAt: string
}

const EmailTag = React.memo<EmailTagProps>(({ email, onRemove, disabled, isInvalid, isSent }) => (
  <div
    className={cn(
      'flex w-auto items-center gap-[4px] rounded-[4px] border px-[8px] py-[4px] text-[12px]',
      isInvalid
        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
        : 'border-[var(--surface-11)] bg-[var(--surface-5)] text-[var(--text-secondary)] dark:bg-[var(--surface-5)] dark:text-[var(--text-secondary)]'
    )}
  >
    <span className='max-w-[200px] truncate'>{email}</span>
    {isSent && (
      <span className='text-[11px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
        sent
      </span>
    )}
    {!disabled && !isSent && (
      <button
        type='button'
        onClick={onRemove}
        className={cn(
          'flex-shrink-0 transition-colors focus:outline-none',
          isInvalid
            ? 'text-red-400 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] dark:text-[var(--text-tertiary)] dark:hover:text-[var(--text-primary)]'
        )}
        aria-label={`Remove ${email}`}
      >
        <X className='h-3 w-3' />
      </button>
    )}
  </div>
))

EmailTag.displayName = 'EmailTag'

interface PermissionSelectorProps {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
}

const PermissionSelector = React.memo<PermissionSelectorProps>(
  ({ value, onChange, disabled = false, className = '' }) => {
    const permissionOptions = useMemo(
      () => [
        { value: 'read' as PermissionType, label: 'Read' },
        { value: 'write' as PermissionType, label: 'Write' },
        { value: 'admin' as PermissionType, label: 'Admin' },
      ],
      []
    )

    return (
      <div
        className={cn(
          'inline-flex rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] dark:bg-[var(--surface-9)]',
          className
        )}
      >
        {permissionOptions.map((option, index) => (
          <button
            key={option.value}
            type='button'
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            className={cn(
              'px-[8px] py-[4px] font-medium text-[12px] transition-colors focus:outline-none',
              'first:rounded-l-[4px] last:rounded-r-[4px]',
              disabled && 'cursor-not-allowed opacity-50',
              value === option.value
                ? 'bg-[var(--surface-9)] text-[var(--text-primary)] dark:bg-[var(--surface-5)] dark:text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-8)] hover:text-[var(--text-primary)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--surface-8)] dark:hover:text-[var(--text-primary)]',
              index > 0 && 'border-[var(--surface-11)] border-l'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    )
  }
)

PermissionSelector.displayName = 'PermissionSelector'

const PermissionsTableSkeleton = React.memo(() => (
  <div className='scrollbar-hide max-h-[300px] overflow-y-auto'>
    {Array.from({ length: 5 }).map((_, idx) => (
      <div key={idx} className='flex items-center justify-between gap-[8px] py-[8px]'>
        <Skeleton className='h-[14px] w-40 rounded-[4px]' />
        <div className='flex items-center gap-[8px]'>
          <Skeleton className='h-[28px] w-32 flex-shrink-0 rounded-[4px]' />
          <div className='flex w-10 items-center gap-[4px] sm:w-12'>
            <Skeleton className='h-4 w-4 rounded-[4px]' />
            <Skeleton className='h-4 w-4 rounded-[4px]' />
          </div>
        </div>
      </div>
    ))}
  </div>
))

PermissionsTableSkeleton.displayName = 'PermissionsTableSkeleton'

const PermissionsTable = ({
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
    // Get emails of existing users to filter out duplicate invitations
    const existingUserEmails = new Set([
      ...(currentUser ? [currentUser.email] : []),
      ...filteredExistingUsers.map((user) => user.email),
    ])

    // Filter out pending invitations for users who are already members
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

  if (permissionsLoading || userPerms.isLoading || isPendingInvitationsLoading) {
    return <PermissionsTableSkeleton />
  }

  if (userPermissions.length === 0 && !session?.user?.email && !workspacePermissions?.users?.length)
    return null

  if (isSaving) {
    return (
      <div className='space-y-[12px]'>
        <h3 className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
          Member Permissions
        </h3>
        <div className='rounded-[8px] border border-[var(--surface-11)] bg-[var(--surface-3)] dark:bg-[var(--surface-3)]'>
          <div className='flex items-center justify-center py-[48px]'>
            <div className='flex items-center gap-[8px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
              <Loader2 className='h-5 w-5 animate-spin' />
              <span className='font-medium text-[13px]'>Saving permission changes...</span>
            </div>
          </div>
        </div>
        <p className='flex min-h-[2rem] items-start text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
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
            const isExistingUser = filteredExistingUsers.some((eu) => eu.email === user.email)
            const isPendingInvitation = user.isPendingInvitation === true
            const userIdentifier = user.userId || user.email
            // Check if current permission is different from original permission
            const originalPermission = workspacePermissions?.users?.find(
              (eu) => eu.userId === user.userId
            )?.permissionType
            const currentPermission =
              existingUserPermissionChanges[userIdentifier]?.permissionType ?? user.permissionType
            const hasChanges = originalPermission && currentPermission !== originalPermission
            // Check if user is in workspace permissions directly
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
              <div key={uniqueKey} className='flex items-center justify-between gap-[8px] py-[8px]'>
                {/* Email and status badges */}
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-[8px]'>
                    <span className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                      {user.email}
                    </span>
                    {isPendingInvitation && (
                      <Badge variant='default' className='gap-[4px]'>
                        {resendingInvitationIds &&
                        user.invitationId &&
                        resendingInvitationIds[user.invitationId] ? (
                          <>
                            <Loader2 className='h-3.5 w-3.5 animate-spin' />
                            <span>Sending...</span>
                          </>
                        ) : resentInvitationIds &&
                          user.invitationId &&
                          resentInvitationIds[user.invitationId] ? (
                          <span>Resent</span>
                        ) : (
                          <span>Sent</span>
                        )}
                      </Badge>
                    )}
                    {hasChanges && <Badge variant='default'>Modified</Badge>}
                  </div>
                </div>

                {/* Permission selector and fixed-width action area to keep rows aligned */}
                <div className='flex flex-shrink-0 items-center gap-[8px]'>
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

                  {/* Fixed-width action area so selector stays inline across rows */}
                  <div className='flex h-4 w-10 items-center justify-center gap-[4px] sm:w-12'>
                    {isPendingInvitation &&
                      currentUserIsAdmin &&
                      user.invitationId &&
                      onResendInvitation && (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <span className='inline-flex'>
                              <Button
                                variant='ghost'
                                onClick={() => onResendInvitation(user.invitationId!, user.email)}
                                disabled={
                                  disabled ||
                                  isSaving ||
                                  resendingInvitationIds?.[user.invitationId!] ||
                                  (resendCooldowns && resendCooldowns[user.invitationId!] > 0)
                                }
                                className='h-4 w-4 p-0'
                              >
                                {resendingInvitationIds?.[user.invitationId!] ? (
                                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                                ) : (
                                  <RotateCw className='h-3.5 w-3.5' />
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
                            className='h-4 w-4 p-0'
                          >
                            <X className='h-3.5 w-3.5' />
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function InviteModal({ open, onOpenChange, workspaceName }: InviteModalProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [inputValue, setInputValue] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [invalidEmails, setInvalidEmails] = useState<string[]>([])
  const [userPermissions, setUserPermissions] = useState<UserPermissions[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<UserPermissions[]>([])
  const [isPendingInvitationsLoading, setIsPendingInvitationsLoading] = useState(false)
  const [existingUserPermissionChanges, setExistingUserPermissionChanges] = useState<
    Record<string, Partial<UserPermissions>>
  >({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showSent, setShowSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [memberToRemove, setMemberToRemove] = useState<{ userId: string; email: string } | null>(
    null
  )
  const [isRemovingMember, setIsRemovingMember] = useState(false)
  const [invitationToRemove, setInvitationToRemove] = useState<{
    invitationId: string
    email: string
  } | null>(null)
  const [isRemovingInvitation, setIsRemovingInvitation] = useState(false)
  const [resendingInvitationIds, setResendingInvitationIds] = useState<Record<string, boolean>>({})
  const [resendCooldowns, setResendCooldowns] = useState<Record<string, number>>({})
  const [resentInvitationIds, setResentInvitationIds] = useState<Record<string, boolean>>({})
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: session } = useSession()
  const {
    workspacePermissions,
    permissionsLoading,
    updatePermissions,
    refetchPermissions,
    userPermissions: userPerms,
  } = useWorkspacePermissionsContext()

  const hasPendingChanges = Object.keys(existingUserPermissionChanges).length > 0
  const hasNewInvites = emails.length > 0 || inputValue.trim()

  const fetchPendingInvitations = useCallback(async () => {
    if (!workspaceId) return

    setIsPendingInvitationsLoading(true)
    try {
      const response = await fetch('/api/workspaces/invitations')
      if (response.ok) {
        const data = await response.json()
        const workspacePendingInvitations =
          data.invitations
            ?.filter(
              (inv: PendingInvitation) =>
                inv.status === 'pending' && inv.workspaceId === workspaceId
            )
            .map((inv: PendingInvitation) => ({
              email: inv.email,
              permissionType: inv.permissions,
              isPendingInvitation: true,
              invitationId: inv.id,
            })) || []

        setPendingInvitations(workspacePendingInvitations)
      }
    } catch (error) {
      logger.error('Error fetching pending invitations:', error)
    } finally {
      setIsPendingInvitationsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (open && workspaceId) {
      fetchPendingInvitations()
      refetchPermissions()
    }
  }, [open, workspaceId, fetchPendingInvitations, refetchPermissions])

  // Clear errors when modal opens
  useEffect(() => {
    if (open) {
      setErrorMessage(null)
      setSuccessMessage(null)
    }
  }, [open])

  const addEmail = useCallback(
    (email: string) => {
      if (!email.trim()) return false

      const normalized = email.trim().toLowerCase()
      const validation = quickValidateEmail(normalized)
      const isValid = validation.isValid

      if (emails.includes(normalized) || invalidEmails.includes(normalized)) {
        return false
      }

      const hasPendingInvitation = pendingInvitations.some((inv) => inv.email === normalized)
      if (hasPendingInvitation) {
        setErrorMessage(`${normalized} already has a pending invitation`)
        setInputValue('')
        return false
      }

      const isExistingMember = workspacePermissions?.users?.some(
        (user) => user.email === normalized
      )
      if (isExistingMember) {
        setErrorMessage(`${normalized} is already a member of this workspace`)
        setInputValue('')
        return false
      }

      if (session?.user?.email && session.user.email.toLowerCase() === normalized) {
        setErrorMessage('You cannot invite yourself')
        setInputValue('')
        return false
      }

      if (!isValid) {
        setInvalidEmails((prev) => [...prev, normalized])
        setInputValue('')
        return false
      }

      setErrorMessage(null)
      setEmails((prev) => [...prev, normalized])

      setUserPermissions((prev) => [
        ...prev,
        {
          email: normalized,
          permissionType: 'read',
        },
      ])

      setInputValue('')
      return true
    },
    [emails, invalidEmails, pendingInvitations, workspacePermissions?.users, session?.user?.email]
  )

  const removeEmail = useCallback(
    (index: number) => {
      const emailToRemove = emails[index]
      setEmails((prev) => prev.filter((_, i) => i !== index))
      setUserPermissions((prev) => prev.filter((user) => user.email !== emailToRemove))
    },
    [emails]
  )

  const removeInvalidEmail = useCallback((index: number) => {
    setInvalidEmails((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handlePermissionChange = useCallback(
    (identifier: string, permissionType: PermissionType) => {
      const existingUser = workspacePermissions?.users?.find((user) => user.userId === identifier)

      if (existingUser) {
        setExistingUserPermissionChanges((prev) => {
          const newChanges = { ...prev }

          // If the new permission matches the original, remove the change entry
          if (existingUser.permissionType === permissionType) {
            delete newChanges[identifier]
          } else {
            // Otherwise, track the change
            newChanges[identifier] = { permissionType }
          }

          return newChanges
        })
      } else {
        setUserPermissions((prev) =>
          prev.map((user) => (user.email === identifier ? { ...user, permissionType } : user))
        )
      }
    },
    [workspacePermissions?.users]
  )

  const handleSaveChanges = useCallback(async () => {
    if (!userPerms.canAdmin || !hasPendingChanges || !workspaceId) return

    setIsSaving(true)
    setErrorMessage(null)

    try {
      const updates = Object.entries(existingUserPermissionChanges).map(([userId, changes]) => ({
        userId,
        permissions: changes.permissionType || 'read',
      }))

      const response = await fetch(API_ENDPOINTS.WORKSPACE_PERMISSIONS(workspaceId), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update permissions')
      }

      if (data.users && data.total !== undefined) {
        updatePermissions({ users: data.users, total: data.total })
      }

      setExistingUserPermissionChanges({})

      setSuccessMessage(
        `Permission changes saved for ${updates.length} user${updates.length !== 1 ? 's' : ''}!`
      )
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (error) {
      logger.error('Error saving permission changes:', error)
      const errorMsg =
        error instanceof Error
          ? error.message
          : 'Failed to save permission changes. Please try again.'
      setErrorMessage(errorMsg)
    } finally {
      setIsSaving(false)
    }
  }, [
    userPerms.canAdmin,
    hasPendingChanges,
    workspaceId,
    existingUserPermissionChanges,
    updatePermissions,
  ])

  const handleRestoreChanges = useCallback(() => {
    if (!userPerms.canAdmin || !hasPendingChanges) return

    setExistingUserPermissionChanges({})
    setSuccessMessage('Changes restored to original permissions!')

    setTimeout(() => setSuccessMessage(null), 3000)
  }, [userPerms.canAdmin, hasPendingChanges])

  const handleRemoveMemberClick = useCallback((userId: string, email: string) => {
    setMemberToRemove({ userId, email })
  }, [])

  const handleRemoveMemberConfirm = useCallback(async () => {
    if (!memberToRemove || !workspaceId || !userPerms.canAdmin) return

    setIsRemovingMember(true)
    setErrorMessage(null)

    try {
      // Verify the user exists in workspace permissions
      const userRecord = workspacePermissions?.users?.find(
        (user) => user.userId === memberToRemove.userId
      )

      if (!userRecord) {
        throw new Error('User is not a member of this workspace')
      }

      const response = await fetch(`/api/workspaces/members/${memberToRemove.userId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove member')
      }

      // Update the workspace permissions to remove the user
      if (workspacePermissions) {
        const updatedUsers = workspacePermissions.users.filter(
          (user) => user.userId !== memberToRemove.userId
        )
        updatePermissions({
          users: updatedUsers,
          total: workspacePermissions.total - 1,
        })
      }

      // Clear any pending changes for this user
      setExistingUserPermissionChanges((prev) => {
        const updated = { ...prev }
        delete updated[memberToRemove.userId]
        return updated
      })

      setSuccessMessage(`${memberToRemove.email} has been removed from the workspace`)
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (error) {
      logger.error('Error removing member:', error)
      const errorMsg =
        error instanceof Error ? error.message : 'Failed to remove member. Please try again.'
      setErrorMessage(errorMsg)
    } finally {
      setIsRemovingMember(false)
      setMemberToRemove(null)
    }
  }, [memberToRemove, workspaceId, userPerms.canAdmin, workspacePermissions, updatePermissions])

  const handleRemoveMemberCancel = useCallback(() => {
    setMemberToRemove(null)
  }, [])

  const handleRemoveInvitationClick = useCallback((invitationId: string, email: string) => {
    setInvitationToRemove({ invitationId, email })
  }, [])

  const handleRemoveInvitationConfirm = useCallback(async () => {
    if (!invitationToRemove || !workspaceId || !userPerms.canAdmin) return

    setIsRemovingInvitation(true)
    setErrorMessage(null)

    try {
      const response = await fetch(
        `/api/workspaces/invitations/${invitationToRemove.invitationId}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel invitation')
      }

      // Remove the invitation from the pending invitations list
      setPendingInvitations((prev) =>
        prev.filter((inv) => inv.invitationId !== invitationToRemove.invitationId)
      )

      setSuccessMessage(`Invitation for ${invitationToRemove.email} has been cancelled`)
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (error) {
      logger.error('Error cancelling invitation:', error)
      const errorMsg =
        error instanceof Error ? error.message : 'Failed to cancel invitation. Please try again.'
      setErrorMessage(errorMsg)
    } finally {
      setIsRemovingInvitation(false)
      setInvitationToRemove(null)
    }
  }, [invitationToRemove, workspaceId, userPerms.canAdmin])

  const handleRemoveInvitationCancel = useCallback(() => {
    setInvitationToRemove(null)
  }, [])

  const handleResendInvitation = useCallback(
    async (invitationId: string, email: string) => {
      if (!workspaceId || !userPerms.canAdmin) return

      const secondsLeft = resendCooldowns[invitationId]
      if (secondsLeft && secondsLeft > 0) return

      setResendingInvitationIds((prev) => ({ ...prev, [invitationId]: true }))
      setErrorMessage(null)

      try {
        const response = await fetch(`/api/workspaces/invitations/${invitationId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to resend invitation')
        }

        setSuccessMessage(`Invitation resent to ${email}`)
        setTimeout(() => setSuccessMessage(null), 3000)

        setResentInvitationIds((prev) => ({ ...prev, [invitationId]: true }))
        setTimeout(() => {
          setResentInvitationIds((prev) => {
            const next = { ...prev }
            delete next[invitationId]
            return next
          })
        }, 4000)
      } catch (error) {
        logger.error('Error resending invitation:', error)
        const errorMsg =
          error instanceof Error ? error.message : 'Failed to resend invitation. Please try again.'
        setErrorMessage(errorMsg)
      } finally {
        setResendingInvitationIds((prev) => {
          const next = { ...prev }
          delete next[invitationId]
          return next
        })
        // Start 60s cooldown
        setResendCooldowns((prev) => ({ ...prev, [invitationId]: 60 }))
        const interval = setInterval(() => {
          setResendCooldowns((prev) => {
            const current = prev[invitationId]
            if (current === undefined) return prev
            if (current <= 1) {
              const next = { ...prev }
              delete next[invitationId]
              clearInterval(interval)
              return next
            }
            return { ...prev, [invitationId]: current - 1 }
          })
        }, 1000)
      }
    },
    [workspaceId, userPerms.canAdmin, resendCooldowns]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (['Enter', ',', ' '].includes(e.key) && inputValue.trim()) {
        e.preventDefault()
        addEmail(inputValue)
      }

      if (e.key === 'Backspace' && !inputValue) {
        if (invalidEmails.length > 0) {
          removeInvalidEmail(invalidEmails.length - 1)
        } else if (emails.length > 0) {
          removeEmail(emails.length - 1)
        }
      }
    },
    [inputValue, addEmail, invalidEmails, emails, removeInvalidEmail, removeEmail]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault()
      const pastedText = e.clipboardData.getData('text')
      const pastedEmails = pastedText.split(/[\s,;]+/).filter(Boolean)

      let addedCount = 0
      pastedEmails.forEach((email) => {
        if (addEmail(email)) {
          addedCount++
        }
      })

      if (addedCount === 0 && pastedEmails.length === 1) {
        setInputValue(inputValue + pastedEmails[0])
      }
    },
    [addEmail, inputValue]
  )

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (inputValue.trim()) {
        addEmail(inputValue)
      }

      // Clear messages at start of submission
      setErrorMessage(null)
      setSuccessMessage(null)

      if (emails.length === 0 || !workspaceId) {
        return
      }

      setIsSubmitting(true)

      try {
        const failedInvites: string[] = []

        const results = await Promise.all(
          emails.map(async (email) => {
            try {
              const userPermission = userPermissions.find((up) => up.email === email)
              const permissionType = userPermission?.permissionType || 'read'

              const response = await fetch('/api/workspaces/invitations', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  workspaceId,
                  email: email,
                  role: 'member',
                  permission: permissionType,
                }),
              })

              const data = await response.json()

              if (!response.ok) {
                if (!invalidEmails.includes(email)) {
                  failedInvites.push(email)
                }

                if (data.error) {
                  setErrorMessage(data.error)
                }

                return false
              }

              return true
            } catch {
              if (!invalidEmails.includes(email)) {
                failedInvites.push(email)
              }
              return false
            }
          })
        )

        const successCount = results.filter(Boolean).length

        if (successCount > 0) {
          fetchPendingInvitations()
          setInputValue('')

          if (failedInvites.length > 0) {
            setEmails(failedInvites)
            setUserPermissions((prev) => prev.filter((user) => failedInvites.includes(user.email)))
          } else {
            setEmails([])
            setUserPermissions([])

            setTimeout(() => {
              onOpenChange(false)
            }, 1500)
          }

          setInvalidEmails([])
          setShowSent(true)

          setTimeout(() => {
            setShowSent(false)
          }, 4000)
        }
      } catch (err) {
        logger.error('Error inviting members:', err)
        const errorMessage =
          err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
        setErrorMessage(errorMessage)
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      inputValue,
      addEmail,
      emails,
      workspaceId,
      userPermissions,
      invalidEmails,
      fetchPendingInvitations,
      onOpenChange,
    ]
  )

  const resetState = useCallback(() => {
    // Batch state updates using React's automatic batching in React 18+
    setInputValue('')
    setEmails([])
    setInvalidEmails([])
    setUserPermissions([])
    setPendingInvitations([])
    setIsPendingInvitationsLoading(false)
    setExistingUserPermissionChanges({})
    setIsSubmitting(false)
    setIsSaving(false)
    setShowSent(false)
    setErrorMessage(null)
    setSuccessMessage(null)
    setMemberToRemove(null)
    setIsRemovingMember(false)
    setInvitationToRemove(null)
    setIsRemovingInvitation(false)
  }, [])

  return (
    <Modal
      open={open}
      onOpenChange={(newOpen: boolean) => {
        if (!newOpen) {
          resetState()
        }
        onOpenChange(newOpen)
      }}
    >
      <ModalContent className='flex max-h-[80vh] w-full max-w-[560px] flex-col gap-[12px]'>
        <div className='flex flex-col gap-[8px]'>
          <h2 className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
            Invite members to {workspaceName || 'Workspace'}
          </h2>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className='mt-[8px]'>
          <div className='space-y-[8px]'>
            <label
              htmlFor='emails'
              className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'
            >
              Email Addresses
            </label>
            <div className='scrollbar-hide flex max-h-32 min-h-9 flex-wrap items-center gap-x-[8px] gap-y-[4px] overflow-y-auto rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[8px] py-[6px] focus-within:outline-none dark:bg-[var(--surface-9)]'>
              {invalidEmails.map((email, index) => (
                <EmailTag
                  key={`invalid-${index}`}
                  email={email}
                  onRemove={() => removeInvalidEmail(index)}
                  disabled={isSubmitting || !userPerms.canAdmin}
                  isInvalid={true}
                />
              ))}
              {emails.map((email, index) => (
                <EmailTag
                  key={`valid-${index}`}
                  email={email}
                  onRemove={() => removeEmail(index)}
                  disabled={isSubmitting || !userPerms.canAdmin}
                />
              ))}
              <Input
                id='emails'
                type='text'
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onBlur={() => inputValue.trim() && addEmail(inputValue)}
                placeholder={
                  !userPerms.canAdmin
                    ? 'Only administrators can invite new members'
                    : emails.length > 0 || invalidEmails.length > 0
                      ? 'Add another email'
                      : 'Enter emails'
                }
                className={cn(
                  'h-6 min-w-[180px] flex-1 border-none bg-transparent p-0 text-[13px] focus-visible:ring-0 focus-visible:ring-offset-0',
                  emails.length > 0 || invalidEmails.length > 0 ? 'pl-[4px]' : 'pl-[4px]'
                )}
                autoFocus={userPerms.canAdmin}
                disabled={isSubmitting || !userPerms.canAdmin}
              />
            </div>
            {errorMessage && (
              <p className='mt-[4px] text-[12px] text-[var(--text-error)] dark:text-[var(--text-error)]'>
                {errorMessage}
              </p>
            )}
          </div>

          {/* Line separator */}
          <div className='mt-[16px] mb-[12px] border-[var(--surface-11)] border-t' />

          <PermissionsTable
            userPermissions={userPermissions}
            onPermissionChange={handlePermissionChange}
            onRemoveMember={handleRemoveMemberClick}
            onRemoveInvitation={handleRemoveInvitationClick}
            onResendInvitation={handleResendInvitation}
            disabled={isSubmitting || isSaving || isRemovingMember || isRemovingInvitation}
            existingUserPermissionChanges={existingUserPermissionChanges}
            isSaving={isSaving}
            workspacePermissions={workspacePermissions}
            permissionsLoading={permissionsLoading}
            pendingInvitations={pendingInvitations}
            isPendingInvitationsLoading={isPendingInvitationsLoading}
            resendingInvitationIds={resendingInvitationIds}
            resentInvitationIds={resentInvitationIds}
            resendCooldowns={resendCooldowns}
          />
        </form>

        {/* Consistent spacing below user list to match spacing above */}
        <div className='mb-[12px]' />

        <div className='flex justify-between gap-[8px]'>
          {hasPendingChanges && userPerms.canAdmin && (
            <>
              <Button
                type='button'
                variant='default'
                disabled={isSaving || isSubmitting}
                onClick={handleRestoreChanges}
                className='h-[32px] gap-[8px] px-[12px] font-medium'
              >
                Restore Changes
              </Button>
              <Button
                type='button'
                variant='default'
                disabled={isSaving || isSubmitting}
                onClick={handleSaveChanges}
                className='h-[32px] gap-[8px] px-[12px] font-medium'
              >
                {isSaving && <Loader2 className='h-4 w-4 animate-spin' />}
                Save Changes
              </Button>
            </>
          )}

          <button
            type='button'
            onClick={() => formRef.current?.requestSubmit()}
            disabled={
              !userPerms.canAdmin || isSubmitting || isSaving || !workspaceId || !hasNewInvites
            }
            className={cn(
              'ml-auto flex h-[32px] items-center justify-center gap-[8px] rounded-[8px] px-[12px] font-medium text-[13px] transition-all duration-200',
              'bg-[var(--brand-primary-hex)] text-white shadow-[0_0_0_0_var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
              'disabled:opacity-50 disabled:hover:bg-[var(--brand-primary-hex)] disabled:hover:shadow-none'
            )}
          >
            {isSubmitting && <Loader2 className='h-4 w-4 animate-spin' />}
            {!userPerms.canAdmin ? 'Admin Access Required' : 'Send Invite'}
          </button>
        </div>
      </ModalContent>

      {/* Remove Member Confirmation Dialog */}
      <Modal open={!!memberToRemove} onOpenChange={handleRemoveMemberCancel}>
        <ModalContent>
          <div className='flex flex-col gap-[8px]'>
            <h2 className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              Remove Member
            </h2>
            <p className='text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
              Are you sure you want to remove{' '}
              <span className='font-medium text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                {memberToRemove?.email}
              </span>{' '}
              from this workspace?{' '}
              <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                This action cannot be undone.
              </span>
            </p>
          </div>
          <div className='flex justify-between gap-[8px]'>
            <Button
              variant='default'
              className='h-[32px] w-full px-[12px]'
              onClick={handleRemoveMemberCancel}
              disabled={isRemovingMember}
            >
              Cancel
            </Button>
            <button
              onClick={handleRemoveMemberConfirm}
              disabled={isRemovingMember}
              className='h-[32px] w-full gap-[8px] rounded-[8px] bg-[var(--text-error)] px-[12px] font-medium text-[13px] text-white transition-all duration-200 hover:bg-[var(--text-error)] disabled:opacity-50 dark:bg-[var(--text-error)] dark:hover:bg-[var(--text-error)]'
            >
              {isRemovingMember && <Loader2 className='mr-1 h-4 w-4 animate-spin' />}
              Remove Member
            </button>
          </div>
        </ModalContent>
      </Modal>

      {/* Remove Invitation Confirmation Dialog */}
      <Modal open={!!invitationToRemove} onOpenChange={handleRemoveInvitationCancel}>
        <ModalContent>
          <div className='flex flex-col gap-[8px]'>
            <h2 className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
              Cancel Invitation
            </h2>
            <p className='text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
              Are you sure you want to cancel the invitation for{' '}
              <span className='font-medium text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                {invitationToRemove?.email}
              </span>
              ?{' '}
              <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                This action cannot be undone.
              </span>
            </p>
          </div>
          <div className='flex justify-between gap-[8px]'>
            <Button
              variant='default'
              className='h-[32px] w-full px-[12px]'
              onClick={handleRemoveInvitationCancel}
              disabled={isRemovingInvitation}
            >
              Cancel
            </Button>
            <button
              onClick={handleRemoveInvitationConfirm}
              disabled={isRemovingInvitation}
              className='h-[32px] w-full gap-[8px] rounded-[8px] bg-[var(--text-error)] px-[12px] font-medium text-[13px] text-white transition-all duration-200 hover:bg-[var(--text-error)] disabled:opacity-50 dark:bg-[var(--text-error)] dark:hover:bg-[var(--text-error)]'
            >
              {isRemovingInvitation && <Loader2 className='mr-1 h-4 w-4 animate-spin' />}
              Cancel Invitation
            </button>
          </div>
        </ModalContent>
      </Modal>
    </Modal>
  )
}
