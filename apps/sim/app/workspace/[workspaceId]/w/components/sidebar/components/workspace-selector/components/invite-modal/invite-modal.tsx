'use client'

import React, { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { HelpCircle, Loader2, Trash2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { validateAndNormalizeEmail } from '@/lib/email/utils'
import { createLogger } from '@/lib/logs/console-logger'
import type { PermissionType } from '@/lib/permissions/utils'
import { cn } from '@/lib/utils'
import {
  useUserPermissionsContext,
  useWorkspacePermissionsContext,
} from '@/app/workspace/[workspaceId]/w/components/providers/workspace-permissions-provider'
import type { WorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { API_ENDPOINTS } from '@/stores/constants'

const logger = createLogger('InviteModal')

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInviteMember?: (email: string) => void
}

interface EmailTagProps {
  email: string
  onRemove: () => void
  disabled?: boolean
  isInvalid?: boolean
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
  disabled?: boolean
  existingUserPermissionChanges: Record<string, Partial<UserPermissions>>
  isSaving?: boolean
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  pendingInvitations: UserPermissions[]
  isPendingInvitationsLoading: boolean
}

interface PendingInvitation {
  id: string
  workspaceId: string
  email: string
  permissions: PermissionType
  status: string
  createdAt: string
}

const EmailTag = React.memo<EmailTagProps>(({ email, onRemove, disabled, isInvalid }) => (
  <div
    className={`flex items-center ${isInvalid ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-gray-100 text-slate-700'} my-0 ml-0 w-auto gap-1 rounded-md border px-2 py-0.5 text-sm`}
  >
    <span className='max-w-[180px] truncate'>{email}</span>
    {!disabled && (
      <button
        type='button'
        onClick={onRemove}
        className={`${isInvalid ? 'text-red-400 hover:text-red-600' : 'text-gray-400 hover:text-gray-600'} flex-shrink-0 focus:outline-none`}
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
      <div className={cn('inline-flex rounded-md border border-input bg-background', className)}>
        {permissionOptions.map((option, index) => (
          <button
            key={option.value}
            type='button'
            onClick={() => !disabled && onChange(option.value)}
            disabled={disabled}
            className={cn(
              'px-3 py-1.5 font-medium text-sm transition-colors focus:outline-none',
              'first:rounded-l-md last:rounded-r-md',
              disabled && 'cursor-not-allowed opacity-50',
              value === option.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              index > 0 && 'border-input border-l'
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
  <div className='space-y-4'>
    <div className='flex items-center gap-2'>
      <h3 className='font-medium text-sm'>Member Permissions</h3>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
            type='button'
          >
            <HelpCircle className='h-4 w-4' />
            <span className='sr-only'>Member permissions help</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side='top' className='max-w-[320px]'>
          <p className='text-sm'>Loading permissions...</p>
        </TooltipContent>
      </Tooltip>
    </div>
    <div className='rounded-md border'>
      <div className='divide-y'>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className='flex items-center justify-between p-4'>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <Skeleton className='h-4 w-48' />
                {i === 1 && <Skeleton className='h-5 w-12 rounded-md' />}
              </div>
              <div className='mt-1 flex items-center gap-2'>
                {i > 0 && <Skeleton className='h-5 w-16 rounded-md' />}
              </div>
            </div>
            <div className='flex-shrink-0'>
              <Skeleton className='h-9 w-32 rounded-md' />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
))

PermissionsTableSkeleton.displayName = 'PermissionsTableSkeleton'

const getStatusBadgeStyles = (status: 'sent' | 'member' | 'modified'): string => {
  switch (status) {
    case 'sent':
      return 'inline-flex items-center rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    case 'member':
      return 'inline-flex items-center rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400'
    case 'modified':
      return 'inline-flex items-center rounded-md bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
    default:
      return 'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
}

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
      <div className='space-y-4'>
        <h3 className='font-medium text-sm'>Member Permissions</h3>
        <div className='rounded-md border bg-card'>
          <div className='flex items-center justify-center py-12'>
            <div className='flex items-center space-x-2 text-muted-foreground'>
              <Loader2 className='h-5 w-5 animate-spin' />
              <span className='font-medium text-sm'>Saving permission changes...</span>
            </div>
          </div>
        </div>
        <div className='flex min-h-[2rem] items-start'>
          <p className='text-muted-foreground text-xs'>
            Please wait while we update the permissions.
          </p>
        </div>
      </div>
    )
  }

  const currentUserIsAdmin = userPerms.canAdmin

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-2'>
        <h3 className='font-medium text-sm'>Member Permissions</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
              type='button'
            >
              <HelpCircle className='h-4 w-4' />
              <span className='sr-only'>Member permissions help</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side='top' className='max-w-[320px]'>
            <div className='space-y-2'>
              {userPerms.isLoading || permissionsLoading ? (
                <p className='text-sm'>Loading permissions...</p>
              ) : !currentUserIsAdmin ? (
                <p className='text-sm'>
                  Only administrators can invite new members and modify permissions.
                </p>
              ) : (
                <div className='space-y-1'>
                  <p className='text-sm'>Admin grants all permissions automatically.</p>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className='rounded-md border'>
        {allUsers.length > 0 && (
          <div className='divide-y'>
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
                <div key={uniqueKey} className='flex items-center justify-between p-4'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium text-card-foreground text-sm'>{user.email}</span>
                      {isPendingInvitation && (
                        <span className={getStatusBadgeStyles('sent')}>Sent</span>
                      )}
                      {/* Show remove button for existing workspace members (not current user, not pending) */}
                      {canShowRemoveButton && onRemoveMember && (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => onRemoveMember(user.userId!, user.email)}
                          disabled={disabled || isSaving}
                          className='h-6 w-6 rounded-md p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                          title={`Remove ${user.email} from workspace`}
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                          <span className='sr-only'>Remove {user.email}</span>
                        </Button>
                      )}
                      {/* Show remove button for pending invitations */}
                      {isPendingInvitation &&
                        currentUserIsAdmin &&
                        user.invitationId &&
                        onRemoveInvitation && (
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => onRemoveInvitation(user.invitationId!, user.email)}
                            disabled={disabled || isSaving}
                            className='h-6 w-6 rounded-md p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                            title={`Cancel invitation for ${user.email}`}
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                            <span className='sr-only'>Cancel invitation for {user.email}</span>
                          </Button>
                        )}
                    </div>
                    <div className='mt-1 flex items-center gap-2'>
                      {isExistingUser && !isCurrentUser && (
                        <span className={getStatusBadgeStyles('member')}>Member</span>
                      )}
                      {hasChanges && (
                        <span className={getStatusBadgeStyles('modified')}>Modified</span>
                      )}
                    </div>
                  </div>
                  <div className='flex-shrink-0'>
                    <PermissionSelector
                      value={user.permissionType}
                      onChange={(newPermission) =>
                        onPermissionChange(userIdentifier, newPermission)
                      }
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
    </div>
  )
}

export function InviteModal({ open, onOpenChange }: InviteModalProps) {
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
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: session } = useSession()
  const {
    workspacePermissions,
    permissionsLoading,
    updatePermissions,
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
    }
  }, [open, workspaceId, fetchPendingInvitations])

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

      const { isValid, normalized } = validateAndNormalizeEmail(email)

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
            setSuccessMessage(
              successCount === 1
                ? 'Invitation sent successfully!'
                : `${successCount} invitations sent successfully!`
            )

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
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) {
          resetState()
        }
        onOpenChange(newOpen)
      }}
    >
      <DialogContent
        className='flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
        hideCloseButton
      >
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <div className='flex items-center justify-between'>
            <DialogTitle className='font-medium text-lg'>Invite Members to Workspace</DialogTitle>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 p-0'
              onClick={() => onOpenChange(false)}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close</span>
            </Button>
          </div>
        </DialogHeader>

        <div className='max-h-[80vh] overflow-y-auto px-6 pt-4 pb-6'>
          <form onSubmit={handleSubmit}>
            <div className='space-y-4'>
              <div className='space-y-2'>
                <div className='flex items-center gap-2'>
                  <label htmlFor='emails' className='font-medium text-sm'>
                    Email Addresses
                  </label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-5 w-5 p-0 text-muted-foreground hover:text-foreground'
                        type='button'
                      >
                        <HelpCircle className='h-4 w-4' />
                        <span className='sr-only'>Email addresses help</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='top' className='max-w-[280px]'>
                      <p className='text-sm'>
                        Press Enter, comma, or space after each email address to add it to the list.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div
                  className={cn(
                    'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2'
                  )}
                >
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
                          : 'Enter email addresses'
                    }
                    className={cn(
                      'h-7 min-w-[180px] flex-1 border-none py-1 focus-visible:ring-0 focus-visible:ring-offset-0',
                      emails.length > 0 || invalidEmails.length > 0 ? 'pl-1' : 'pl-0'
                    )}
                    autoFocus={userPerms.canAdmin}
                    disabled={isSubmitting || !userPerms.canAdmin}
                  />
                </div>
                {(errorMessage || successMessage) && (
                  <p
                    className={cn(
                      'mt-1 text-xs',
                      errorMessage ? 'text-destructive' : 'text-green-600'
                    )}
                  >
                    {errorMessage || successMessage}
                  </p>
                )}
              </div>

              <PermissionsTable
                userPermissions={userPermissions}
                onPermissionChange={handlePermissionChange}
                onRemoveMember={handleRemoveMemberClick}
                onRemoveInvitation={handleRemoveInvitationClick}
                disabled={isSubmitting || isSaving || isRemovingMember || isRemovingInvitation}
                existingUserPermissionChanges={existingUserPermissionChanges}
                isSaving={isSaving}
                workspacePermissions={workspacePermissions}
                permissionsLoading={permissionsLoading}
                pendingInvitations={pendingInvitations}
                isPendingInvitationsLoading={isPendingInvitationsLoading}
              />

              <div className='flex justify-between'>
                {hasPendingChanges && userPerms.canAdmin && (
                  <div className='flex gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={isSaving || isSubmitting}
                      onClick={handleRestoreChanges}
                      className='gap-2 font-medium'
                    >
                      Restore Changes
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={isSaving || isSubmitting}
                      onClick={handleSaveChanges}
                      className='gap-2 font-medium'
                    >
                      {isSaving && <Loader2 className='h-4 w-4 animate-spin' />}
                      Save Changes
                    </Button>
                  </div>
                )}

                <Button
                  type='submit'
                  size='sm'
                  disabled={
                    !userPerms.canAdmin ||
                    !hasNewInvites ||
                    isSubmitting ||
                    isSaving ||
                    !workspaceId
                  }
                  className={cn(
                    'ml-auto gap-2 font-medium',
                    'bg-[#802FFF] hover:bg-[#7028E6]',
                    'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'text-white transition-all duration-200',
                    'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
                  )}
                >
                  {isSubmitting && <Loader2 className='h-4 w-4 animate-spin' />}
                  {!userPerms.canAdmin
                    ? 'Admin Access Required'
                    : showSent
                      ? 'Sent!'
                      : 'Send Invitations'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>

      {/* Remove Member Confirmation Dialog */}
      <Dialog open={!!memberToRemove} onOpenChange={handleRemoveMemberCancel}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
          </DialogHeader>
          <div className='py-4'>
            <p className='text-muted-foreground text-sm'>
              Are you sure you want to remove{' '}
              <span className='font-medium text-foreground'>{memberToRemove?.email}</span> from this
              workspace? This action cannot be undone.
            </p>
          </div>
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline'
              onClick={handleRemoveMemberCancel}
              disabled={isRemovingMember}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRemoveMemberConfirm}
              disabled={isRemovingMember}
              className='gap-2'
            >
              {isRemovingMember && <Loader2 className='h-4 w-4 animate-spin' />}
              Remove Member
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove Invitation Confirmation Dialog */}
      <Dialog open={!!invitationToRemove} onOpenChange={handleRemoveInvitationCancel}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Cancel Invitation</DialogTitle>
          </DialogHeader>
          <div className='py-4'>
            <p className='text-muted-foreground text-sm'>
              Are you sure you want to cancel the invitation for{' '}
              <span className='font-medium text-foreground'>{invitationToRemove?.email}</span>? This
              action cannot be undone.
            </p>
          </div>
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline'
              onClick={handleRemoveInvitationCancel}
              disabled={isRemovingInvitation}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRemoveInvitationConfirm}
              disabled={isRemovingInvitation}
              className='gap-2'
            >
              {isRemovingInvitation && <Loader2 className='h-4 w-4 animate-spin' />}
              Cancel Invitation
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
