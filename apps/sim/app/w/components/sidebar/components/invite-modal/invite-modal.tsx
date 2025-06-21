'use client'

import { type KeyboardEvent, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSession } from '@/lib/auth-client'
import type { PermissionType } from '@/lib/permissions/utils'
import { cn } from '@/lib/utils'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import {
  useWorkspacePermissions,
  type WorkspacePermissions,
} from '@/hooks/use-workspace-permissions'
import { API_ENDPOINTS } from '@/stores/constants'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
}

interface PermissionsTableProps {
  userPermissions: UserPermissions[]
  onPermissionChange: (userId: string, permissionType: PermissionType) => void
  disabled?: boolean
  existingUserPermissionChanges: Record<string, Partial<UserPermissions>>
  isSaving?: boolean
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
}

const EmailTag = ({ email, onRemove, disabled, isInvalid }: EmailTagProps) => (
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
)

const PermissionSelector = ({
  value,
  onChange,
  disabled = false,
  className = '',
}: {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
}) => {
  const permissionOptions = [
    { value: 'read' as PermissionType, label: 'Read' },
    { value: 'write' as PermissionType, label: 'Write' },
    { value: 'admin' as PermissionType, label: 'Admin' },
  ]

  return (
    <div className={cn('inline-flex rounded-md border border-input bg-background', className)}>
      {permissionOptions.map((option, index) => (
        <button
          key={option.value}
          type='button'
          onClick={() => !disabled && onChange(option.value)}
          disabled={disabled}
          className={cn(
            'px-3 py-1.5 font-medium text-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
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

const PermissionsTable = ({
  userPermissions,
  onPermissionChange,
  disabled,
  existingUserPermissionChanges,
  isSaving,
  workspacePermissions,
  permissionsLoading,
}: PermissionsTableProps) => {
  const { data: session } = useSession()
  const { activeWorkspaceId } = useWorkflowRegistry()
  const userPerms = useUserPermissions(activeWorkspaceId)

  if (userPermissions.length === 0 && !session?.user?.email && !workspacePermissions?.users?.length)
    return null

  // Show loading state during save operations to prevent UI inconsistencies
  if (isSaving) {
    return (
      <div className='space-y-2'>
        <h3 className='font-medium text-foreground text-sm'>Member Permissions</h3>
        <div className='rounded-lg border border-border bg-card'>
          <div className='flex items-center justify-center py-12'>
            <div className='flex items-center space-x-2 text-muted-foreground'>
              <Loader2 className='h-5 w-5 animate-spin' />
              <span className='font-medium text-sm'>Saving permission changes...</span>
            </div>
          </div>
        </div>
        <p className='text-muted-foreground text-xs'>
          Please wait while we update the permissions.
        </p>
      </div>
    )
  }

  // Convert workspace users to UserPermissions format, merging with pending changes
  const existingUsers: UserPermissions[] =
    workspacePermissions?.users?.map((user) => {
      const changes = existingUserPermissionChanges[user.userId] || {}

      // Use the single permissionType directly
      const permissionType = user.permissionType || 'read'

      return {
        userId: user.userId,
        email: user.email,
        permissionType:
          changes.permissionType !== undefined ? changes.permissionType : permissionType,
        isCurrentUser: user.email === session?.user?.email,
      }
    }) || []

  // Find current user from existing users or create fallback
  const currentUser: UserPermissions | null = session?.user?.email
    ? existingUsers.find((user) => user.isCurrentUser) || {
        email: session.user.email,
        permissionType: 'admin', // Fallback if not found in workspace users
        isCurrentUser: true,
      }
    : null

  // Use the useUserPermissions hook for admin check instead of manual checking
  const currentUserIsAdmin = userPerms.canAdmin

  // Filter out current user from existing users to avoid duplication
  const filteredExistingUsers = existingUsers.filter((user) => !user.isCurrentUser)

  // Combine current user, existing users, and new invites
  const allUsers: UserPermissions[] = [
    ...(currentUser ? [currentUser] : []),
    ...filteredExistingUsers,
    ...userPermissions,
  ]

  return (
    <div className='space-y-2'>
      <h3 className='font-medium text-foreground text-sm'>Member Permissions</h3>
      <div className='rounded-lg border border-border bg-card'>
        <div className='max-h-64 overflow-y-auto'>
          <table className='w-full text-sm'>
            <thead className='sticky top-0 z-10 border-border border-b bg-card'>
              <tr>
                <th className='bg-card px-4 py-3 text-left font-medium text-muted-foreground'>
                  Email
                </th>
                <th className='bg-card px-4 py-3 text-center font-medium text-muted-foreground'>
                  Permission Level
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-border'>
              {permissionsLoading && (
                <tr>
                  <td colSpan={2} className='px-4 py-3 text-center text-muted-foreground'>
                    <Loader2 className='mr-2 inline-block h-4 w-4 animate-spin' />
                    Loading workspace members...
                  </td>
                </tr>
              )}
              {allUsers.map((user, index) => {
                const isCurrentUser = user.isCurrentUser === true
                const isExistingUser = filteredExistingUsers.some((eu) => eu.email === user.email)
                const isNewInvite = userPermissions.some((up) => up.email === user.email)
                const userIdentifier = user.userId || user.email // Use userId for existing users, email for new invites
                const hasChanges = existingUserPermissionChanges[userIdentifier] !== undefined

                return (
                  <tr
                    key={user.email}
                    className={cn(
                      'transition-colors hover:bg-muted/50',
                      index % 2 === 0 ? 'bg-card' : 'bg-muted/20',
                      isCurrentUser && 'border-primary/20 bg-primary/5'
                    )}
                  >
                    <td className='max-w-[200px] truncate px-4 py-3 font-medium text-card-foreground'>
                      {user.email}
                      {isCurrentUser && (
                        <span className='ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs'>
                          You
                        </span>
                      )}
                      {isExistingUser && !isCurrentUser && (
                        <span className='ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 text-xs dark:bg-green-900/30 dark:text-green-400'>
                          Member
                        </span>
                      )}
                      {isNewInvite && (
                        <span className='ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 text-xs dark:bg-blue-900/30 dark:text-blue-400'>
                          New Invite
                        </span>
                      )}
                      {hasChanges && (
                        <span className='ml-2 inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-700 text-xs dark:bg-orange-900/30 dark:text-orange-400'>
                          Modified
                        </span>
                      )}
                    </td>
                    <td className='px-4 py-3 text-center'>
                      <div className='flex justify-center'>
                        <PermissionSelector
                          value={user.permissionType}
                          onChange={(newPermissionType) =>
                            onPermissionChange(userIdentifier, newPermissionType)
                          }
                          disabled={
                            disabled ||
                            !currentUserIsAdmin ||
                            (isCurrentUser && user.permissionType === 'admin')
                          }
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className='text-muted-foreground text-xs'>
        {!currentUserIsAdmin
          ? 'Only administrators can invite new members and modify permissions.'
          : 'Admin grants all permissions automatically. Modified permissions are highlighted and require saving.'}
      </p>
    </div>
  )
}

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function InviteModal({ open, onOpenChange }: InviteModalProps) {
  const [inputValue, setInputValue] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [invalidEmails, setInvalidEmails] = useState<string[]>([])
  const [userPermissions, setUserPermissions] = useState<UserPermissions[]>([])
  const [existingUserPermissionChanges, setExistingUserPermissionChanges] = useState<
    Record<string, Partial<UserPermissions>>
  >({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showSent, setShowSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const { activeWorkspaceId } = useWorkflowRegistry()
  const { data: session } = useSession()
  const {
    permissions: workspacePermissions,
    loading: permissionsLoading,
    updatePermissions,
  } = useWorkspacePermissions(activeWorkspaceId)
  const userPerms = useUserPermissions(activeWorkspaceId)

  // Check if there are pending changes to existing users
  const hasPendingChanges = Object.keys(existingUserPermissionChanges).length > 0

  // Check if there are new invites to send
  const hasNewInvites = emails.length > 0 || inputValue.trim()

  const addEmail = (email: string) => {
    // Normalize by trimming and converting to lowercase
    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) return false

    // Check for duplicates
    if (emails.includes(normalizedEmail) || invalidEmails.includes(normalizedEmail)) {
      return false
    }

    // Validate email format
    if (!isValidEmail(normalizedEmail)) {
      setInvalidEmails([...invalidEmails, normalizedEmail])
      setInputValue('')
      return false
    }

    // Add to emails array
    setEmails([...emails, normalizedEmail])

    // Add to permissions table with default permissions
    setUserPermissions((prev) => [
      ...prev,
      {
        email: normalizedEmail,
        permissionType: 'read', // Default: read access
      },
    ])

    setInputValue('')
    return true
  }

  const removeEmail = (index: number) => {
    const emailToRemove = emails[index]
    const newEmails = [...emails]
    newEmails.splice(index, 1)
    setEmails(newEmails)

    // Remove from permissions table
    setUserPermissions((prev) => prev.filter((user) => user.email !== emailToRemove))
  }

  const removeInvalidEmail = (index: number) => {
    const newInvalidEmails = [...invalidEmails]
    newInvalidEmails.splice(index, 1)
    setInvalidEmails(newInvalidEmails)
  }

  const handlePermissionChange = (identifier: string, permissionType: PermissionType) => {
    // Check if this is an existing user by looking for userId in workspace permissions
    const existingUser = workspacePermissions?.users?.find((user) => user.userId === identifier)

    if (existingUser) {
      // Handle existing user permission changes using userId
      setExistingUserPermissionChanges((prev) => ({
        ...prev,
        [identifier]: { permissionType },
      }))
    } else {
      // Handle new invites (using email as identifier)
      setUserPermissions((prev) =>
        prev.map((user) => (user.email === identifier ? { ...user, permissionType } : user))
      )
    }
  }

  const handleSaveChanges = async () => {
    if (!userPerms.canAdmin || !hasPendingChanges || !activeWorkspaceId) return

    setIsSaving(true)
    setErrorMessage(null)

    try {
      // Convert existingUserPermissionChanges to the API format using userId
      const updates = Object.entries(existingUserPermissionChanges).map(([userId, changes]) => ({
        userId,
        permissions: changes.permissionType || 'read',
      }))

      const response = await fetch(API_ENDPOINTS.WORKSPACE_PERMISSIONS(activeWorkspaceId), {
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

      // Use the updated permissions from the API response - updated structure
      if (data.users && data.total !== undefined) {
        updatePermissions({ users: data.users, total: data.total })
      }

      // Clear staged changes now that we have fresh data
      setExistingUserPermissionChanges({})

      setSuccessMessage(
        `Permission changes saved for ${updates.length} user${updates.length !== 1 ? 's' : ''}!`
      )
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (error) {
      console.error('Error saving permission changes:', error)
      const errorMsg =
        error instanceof Error
          ? error.message
          : 'Failed to save permission changes. Please try again.'
      setErrorMessage(errorMsg)
    } finally {
      setIsSaving(false)
    }
  }

  const handleRestoreChanges = () => {
    if (!userPerms.canAdmin || !hasPendingChanges) return

    // Clear all pending changes to revert to original permissions
    setExistingUserPermissionChanges({})
    setSuccessMessage('Changes restored to original permissions!')

    setTimeout(() => setSuccessMessage(null), 3000)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Add email on Enter, comma, or space
    if (['Enter', ',', ' '].includes(e.key) && inputValue.trim()) {
      e.preventDefault()
      addEmail(inputValue)
    }

    // Remove the last email on Backspace if input is empty
    if (e.key === 'Backspace' && !inputValue) {
      if (invalidEmails.length > 0) {
        removeInvalidEmail(invalidEmails.length - 1)
      } else if (emails.length > 0) {
        removeEmail(emails.length - 1)
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    const pastedEmails = pastedText
      .split(/[\s,;]+/) // Split by space, comma, or semicolon
      .filter(Boolean) // Remove empty strings

    const validEmails = pastedEmails.filter((email) => {
      return addEmail(email)
    })

    // If we didn't add any emails, keep the current input value
    if (validEmails.length === 0 && pastedEmails.length === 1) {
      setInputValue(inputValue + pastedEmails[0])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Add current input as an email if it's valid
    if (inputValue.trim()) {
      addEmail(inputValue)
    }

    // Clear any previous error or success messages
    setErrorMessage(null)
    setSuccessMessage(null)

    // Don't proceed if no emails or no workspace
    if (emails.length === 0 || !activeWorkspaceId) {
      return
    }

    setIsSubmitting(true)

    try {
      // Track failed invitations
      const failedInvites: string[] = []

      // Send invitations in parallel
      const results = await Promise.all(
        emails.map(async (email) => {
          try {
            // Find permissions for this email
            const userPermission = userPermissions.find((up) => up.email === email)
            const permissionType = userPermission?.permissionType || 'read'

            const response = await fetch('/api/workspaces/invitations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                workspaceId: activeWorkspaceId,
                email: email,
                role: 'member', // Default role for invited members (kept for compatibility)
                permission: permissionType, // Single permission type - changed from 'permissions' to 'permission'
              }),
            })

            const data = await response.json()

            if (!response.ok) {
              // Don't add to invalid emails if it's already in the valid emails array
              if (!invalidEmails.includes(email)) {
                failedInvites.push(email)
              }

              // Display the error message from the API if it exists
              if (data.error) {
                setErrorMessage(data.error)
              }

              return false
            }

            return true
          } catch (_err) {
            // Don't add to invalid emails if it's already in the valid emails array
            if (!invalidEmails.includes(email)) {
              failedInvites.push(email)
            }
            return false
          }
        })
      )

      const successCount = results.filter(Boolean).length

      if (successCount > 0) {
        // Clear everything on success, but keep track of failed emails
        setInputValue('')

        // Only keep emails that failed in the emails array
        if (failedInvites.length > 0) {
          setEmails(failedInvites)
          // Keep permissions only for failed invites
          setUserPermissions((prev) => prev.filter((user) => failedInvites.includes(user.email)))
        } else {
          setEmails([])
          setUserPermissions([])
          // Set success message when all invitations are successful
          setSuccessMessage(
            successCount === 1
              ? 'Invitation sent successfully!'
              : `${successCount} invitations sent successfully!`
          )
        }

        setInvalidEmails([])
        setShowSent(true)

        // Revert button text after 2 seconds
        setTimeout(() => {
          setShowSent(false)
        }, 4000)
      }
    } catch (err: any) {
      console.error('Error inviting members:', err)
      setErrorMessage('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetState = () => {
    setInputValue('')
    setEmails([])
    setInvalidEmails([])
    setUserPermissions([])
    setExistingUserPermissionChanges({})
    setIsSubmitting(false)
    setIsSaving(false)
    setShowSent(false)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

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
                <label htmlFor='emails' className='font-medium text-sm'>
                  Email Addresses
                </label>
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
                          : 'Enter email addresses (comma or Enter to separate)'
                    }
                    className={cn(
                      'h-7 min-w-[180px] flex-1 border-none py-1 focus-visible:ring-0 focus-visible:ring-offset-0',
                      emails.length > 0 || invalidEmails.length > 0 ? 'pl-1' : 'pl-0'
                    )}
                    autoFocus={userPerms.canAdmin}
                    disabled={isSubmitting || !userPerms.canAdmin}
                  />
                </div>
                <p
                  className={cn(
                    'mt-1 text-xs',
                    errorMessage
                      ? 'text-destructive'
                      : successMessage
                        ? 'text-green-600'
                        : 'text-muted-foreground'
                  )}
                >
                  {errorMessage ||
                    successMessage ||
                    'Press Enter, comma, or space after each email.'}
                </p>
              </div>

              <PermissionsTable
                userPermissions={userPermissions}
                onPermissionChange={handlePermissionChange}
                disabled={isSubmitting || isSaving}
                existingUserPermissionChanges={existingUserPermissionChanges}
                isSaving={isSaving}
                workspacePermissions={workspacePermissions}
                permissionsLoading={permissionsLoading}
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
                    !activeWorkspaceId
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
    </Dialog>
  )
}
