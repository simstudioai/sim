'use client'

import { type KeyboardEvent, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSession } from '@/lib/auth-client'
import { useWorkspacePermissions, WorkspacePermissions } from '@/hooks/use-workspace-permissions'

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
  email: string
  admin: boolean
  read: boolean
  edit: boolean
  deploy: boolean
  isCurrentUser?: boolean
}

interface PermissionsTableProps {
  userPermissions: UserPermissions[]
  onPermissionChange: (email: string, permission: keyof Omit<UserPermissions, 'email'>, value: boolean) => void
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

const PermissionsTable = ({ 
  userPermissions, 
  onPermissionChange, 
  disabled, 
  existingUserPermissionChanges, 
  isSaving, 
  workspacePermissions, 
  permissionsLoading 
}: PermissionsTableProps) => {
  const { data: session } = useSession()
  
  if (userPermissions.length === 0 && !session?.user?.email && !workspacePermissions?.users?.length) return null

  // Show loading state during save operations to prevent UI inconsistencies
  if (isSaving) {
    return (
      <div className='space-y-2'>
        <label className='font-medium text-sm text-foreground'>Member Permissions</label>
        <div className='rounded-lg border border-border bg-card'>
          <div className='flex items-center justify-center py-12'>
            <div className='flex items-center space-x-2 text-muted-foreground'>
              <Loader2 className='h-5 w-5 animate-spin' />
              <span className='text-sm font-medium'>Saving permission changes...</span>
            </div>
          </div>
        </div>
        <p className='text-xs text-muted-foreground'>
          Please wait while we update the permissions.
        </p>
      </div>
    )
  }

  // Convert workspace users to UserPermissions format, merging with pending changes
  // Simplified logic: always merge changes if they exist, otherwise use original permissions
  const existingUsers: UserPermissions[] = workspacePermissions?.users?.map(user => {
    const changes = existingUserPermissionChanges[user.email] || {}
    
    return {
      email: user.email,
      admin: changes.admin !== undefined ? changes.admin : user.permissions.includes('admin'),
      read: changes.read !== undefined ? changes.read : user.permissions.includes('read'),
      edit: changes.edit !== undefined ? changes.edit : user.permissions.includes('edit'),
      deploy: changes.deploy !== undefined ? changes.deploy : user.permissions.includes('deploy'),
      isCurrentUser: user.email === session?.user?.email
    }
  }) || []

  // Find current user from existing users or create fallback
  const currentUser: UserPermissions | null = session?.user?.email ? 
    existingUsers.find(user => user.isCurrentUser) || {
      email: session.user.email,
      admin: true, // Fallback if not found in workspace users
      read: true,
      edit: true,
      deploy: true,
      isCurrentUser: true
    } : null

  // Check if current user has admin permissions
  const currentUserIsAdmin = currentUser?.admin || false

  // Filter out current user from existing users to avoid duplication
  const filteredExistingUsers = existingUsers.filter(user => !user.isCurrentUser)

  // Combine current user, existing users, and new invites
  const allUsers: UserPermissions[] = [
    ...(currentUser ? [currentUser] : []),
    ...filteredExistingUsers,
    ...userPermissions
  ]

  return (
    <div className='space-y-2'>
      <label className='font-medium text-sm text-foreground'>Member Permissions</label>
      <div className='rounded-lg border border-border bg-card'>
        <div className='max-h-64 overflow-y-auto'>
          <table className='w-full text-sm'>
            <thead className='sticky top-0 bg-muted/50 border-b border-border'>
              <tr>
                <th className='px-4 py-3 text-left font-medium text-muted-foreground'>Email</th>
                <th className='px-4 py-3 text-center font-medium text-muted-foreground'>Admin</th>
                <th className='px-4 py-3 text-center font-medium text-muted-foreground'>Read</th>
                <th className='px-4 py-3 text-center font-medium text-muted-foreground'>Edit</th>
                <th className='px-4 py-3 text-center font-medium text-muted-foreground'>Deploy</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-border'>
              {permissionsLoading && (
                <tr>
                  <td colSpan={5} className='px-4 py-3 text-center text-muted-foreground'>
                    <Loader2 className='h-4 w-4 animate-spin inline-block mr-2' />
                    Loading workspace members...
                  </td>
                </tr>
              )}
              {allUsers.map((user, index) => {
                const isCurrentUser = user.isCurrentUser === true
                const isExistingUser = filteredExistingUsers.some(eu => eu.email === user.email)
                const isNewInvite = userPermissions.some(up => up.email === user.email)
                const hasChanges = existingUserPermissionChanges[user.email] !== undefined
                
                return (
                  <tr 
                    key={user.email} 
                    className={cn(
                      'transition-colors hover:bg-muted/50',
                      index % 2 === 0 ? 'bg-card' : 'bg-muted/20',
                      isCurrentUser && 'bg-primary/5 border-primary/20'
                    )}
                  >
                    <td className='px-4 py-3 font-medium text-card-foreground max-w-[200px] truncate'>
                      {user.email}
                      {isCurrentUser && (
                        <span className='ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'>
                          You
                        </span>
                      )}
                      {isExistingUser && !isCurrentUser && (
                        <span className='ml-2 inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400'>
                          Member
                        </span>
                      )}
                      {isNewInvite && (
                        <span className='ml-2 inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400'>
                          New Invite
                        </span>
                      )}
                      {hasChanges && (
                        <span className='ml-2 inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-400'>
                          Modified
                        </span>
                      )}
                    </td>
                    <td className='px-4 py-3 text-center'>
                      <div className='flex justify-center'>
                        <Checkbox
                          checked={user.admin}
                          onCheckedChange={!currentUserIsAdmin ? undefined : 
                            (isCurrentUser && user.admin) ? undefined : 
                            (checked) => onPermissionChange(user.email, 'admin', Boolean(checked))
                          }
                          disabled={disabled || !currentUserIsAdmin || (isCurrentUser && user.admin)}
                          className={cn(
                            'data-[state=checked]:bg-primary data-[state=checked]:border-primary',
                            (!currentUserIsAdmin || (isCurrentUser && user.admin)) && 'opacity-50 cursor-not-allowed'
                          )}
                        />
                      </div>
                    </td>
                    <td className='px-4 py-3 text-center'>
                      <div className='flex justify-center'>
                        <Checkbox
                          checked={true}
                          onCheckedChange={undefined}
                          disabled={true}
                          className={cn(
                            'data-[state=checked]:bg-primary data-[state=checked]:border-primary',
                            'opacity-50 cursor-not-allowed'
                          )}
                        />
                      </div>
                    </td>
                    <td className='px-4 py-3 text-center'>
                      <div className='flex justify-center'>
                        <Checkbox
                          checked={user.edit}
                          onCheckedChange={!currentUserIsAdmin ? undefined : (checked) => 
                            onPermissionChange(user.email, 'edit', Boolean(checked))
                          }
                          disabled={disabled || user.admin || !currentUserIsAdmin}
                          className={cn(
                            'data-[state=checked]:bg-primary data-[state=checked]:border-primary',
                            (user.admin || !currentUserIsAdmin) && 'opacity-50 cursor-not-allowed'
                          )}
                        />
                      </div>
                    </td>
                    <td className='px-4 py-3 text-center'>
                      <div className='flex justify-center'>
                        <Checkbox
                          checked={user.deploy}
                          onCheckedChange={!currentUserIsAdmin ? undefined : (checked) => 
                            onPermissionChange(user.email, 'deploy', Boolean(checked))
                          }
                          disabled={disabled || user.admin || !currentUserIsAdmin}
                          className={cn(
                            'data-[state=checked]:bg-primary data-[state=checked]:border-primary',
                            (user.admin || !currentUserIsAdmin) && 'opacity-50 cursor-not-allowed'
                          )}
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
      <p className='text-xs text-muted-foreground'>
        {!currentUserIsAdmin 
          ? 'Only administrators can invite new members and modify permissions.'
          : 'Admin grants all permissions automatically. Read access is always granted and cannot be removed. Modified permissions are highlighted and require saving.'
        }
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
  const [existingUserPermissionChanges, setExistingUserPermissionChanges] = useState<Record<string, Partial<UserPermissions>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showSent, setShowSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const { activeWorkspaceId } = useWorkflowRegistry()
  const { data: session } = useSession()
  const { permissions: workspacePermissions, loading: permissionsLoading, updatePermissions } = useWorkspacePermissions(activeWorkspaceId)

  // Check if current user has admin permissions
  const currentUserIsAdmin = workspacePermissions?.users?.find(
    user => user.email === session?.user?.email
  )?.permissions.includes('admin') || false

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
    setUserPermissions(prev => [
      ...prev,
      {
        email: normalizedEmail,
        admin: false,  // Default: no admin access
        read: true,    // Default: grant read access
        edit: false,   // Default: no edit access
        deploy: false  // Default: no deploy access
      }
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
    setUserPermissions(prev => prev.filter(user => user.email !== emailToRemove))
  }

  const removeInvalidEmail = (index: number) => {
    const newInvalidEmails = [...invalidEmails]
    newInvalidEmails.splice(index, 1)
    setInvalidEmails(newInvalidEmails)
  }

  const handlePermissionChange = (email: string, permission: keyof Omit<UserPermissions, 'email'>, value: boolean) => {
    const isExistingUser = workspacePermissions?.users?.some(user => user.email === email)
    
    if (isExistingUser) {
      // Handle existing user permission changes
      setExistingUserPermissionChanges(prev => {
        const currentUser = workspacePermissions?.users?.find(user => user.email === email)
        const currentChanges = prev[email] || {}
        
        // Get the current permissions (original + any changes)
        const currentPermissions = {
          admin: currentChanges.admin !== undefined ? currentChanges.admin : currentUser?.permissions.includes('admin') || false,
          read: currentChanges.read !== undefined ? currentChanges.read : currentUser?.permissions.includes('read') || false,
          edit: currentChanges.edit !== undefined ? currentChanges.edit : currentUser?.permissions.includes('edit') || false,
          deploy: currentChanges.deploy !== undefined ? currentChanges.deploy : currentUser?.permissions.includes('deploy') || false,
        }

        const updatedPermissions = { ...currentPermissions, [permission]: value }
        
        // Admin permission logic
        if (permission === 'admin') {
          if (value) {
            updatedPermissions.read = true
            updatedPermissions.edit = true
            updatedPermissions.deploy = true
          } else {
            updatedPermissions.read = true
            updatedPermissions.edit = false
            updatedPermissions.deploy = false
          }
        } else if (currentPermissions.admin) {
          return prev // Don't allow changes if admin is enabled
        } else {
          if ((permission === 'edit' || permission === 'deploy') && value) {
            updatedPermissions.read = true
          }
        }

        return {
          ...prev,
          [email]: updatedPermissions
        }
      })
    } else {
      // Handle new invites (existing logic)
      setUserPermissions(prev => prev.map(user => {
        if (user.email === email) {
          const updatedUser = { ...user, [permission]: value }
          
          if (permission === 'admin') {
            if (value) {
              updatedUser.read = true
              updatedUser.edit = true
              updatedUser.deploy = true
            } else {
              updatedUser.read = true
              updatedUser.edit = false
              updatedUser.deploy = false
            }
          } else if (user.admin) {
            return user
          } else {
            if ((permission === 'edit' || permission === 'deploy') && value) {
              updatedUser.read = true
            }
          }
          
          return updatedUser
        }
        return user
      }))
    }
  }

  const handleSaveChanges = async () => {
    if (!currentUserIsAdmin || !hasPendingChanges || !activeWorkspaceId) return

    setIsSaving(true)
    setErrorMessage(null)

    try {
      // Convert existingUserPermissionChanges to the API format
      const updates = Object.entries(existingUserPermissionChanges).map(([email, changes]) => ({
        email,
        permissions: {
          admin: changes.admin ?? false,
          read: changes.read ?? true,
          edit: changes.edit ?? false,
          deploy: changes.deploy ?? false,
        }
      }))

      console.log('Saving changes:', updates) // DEBUG

      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/permissions`, {
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

      // Use the updated permissions from the API response instead of refetching
      if (data.permissions) {
        updatePermissions(data.permissions)
      }
      
      // Clear staged changes now that we have fresh data
      setExistingUserPermissionChanges({})

      setSuccessMessage(`Permission changes saved for ${updates.length} user${updates.length !== 1 ? 's' : ''}!`)
      setTimeout(() => setSuccessMessage(null), 3000)

    } catch (error) {
      console.error('Error saving permission changes:', error)
      const errorMsg = error instanceof Error ? error.message : 'Failed to save permission changes. Please try again.'
      setErrorMessage(errorMsg)
    } finally {
      setIsSaving(false)
    }
  }

  const handleRestoreChanges = () => {
    if (!currentUserIsAdmin || !hasPendingChanges) return
    
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
            const userPermission = userPermissions.find(up => up.email === email)
            const permissions = userPermission ? {
              admin: userPermission.admin,
              read: userPermission.read,
              edit: userPermission.edit,
              deploy: userPermission.deploy
            } : {
              admin: false,
              read: true,
              edit: false,
              deploy: false
            }

            const response = await fetch('/api/workspaces/invitations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                workspaceId: activeWorkspaceId,
                email: email,
                role: 'member', // Default role for invited members
                permissions: permissions, // Include permissions
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
          setUserPermissions(prev => prev.filter(user => failedInvites.includes(user.email)))
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

        <div className='px-6 pt-4 pb-6 max-h-[80vh] overflow-y-auto'>
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
                      disabled={isSubmitting || !currentUserIsAdmin}
                      isInvalid={true}
                    />
                  ))}
                  {emails.map((email, index) => (
                    <EmailTag
                      key={`valid-${index}`}
                      email={email}
                      onRemove={() => removeEmail(index)}
                      disabled={isSubmitting || !currentUserIsAdmin}
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
                      !currentUserIsAdmin
                        ? 'Only administrators can invite new members'
                        : emails.length > 0 || invalidEmails.length > 0
                        ? 'Add another email'
                        : 'Enter email addresses (comma or Enter to separate)'
                    }
                    className={cn(
                      'h-7 min-w-[180px] flex-1 border-none py-1 focus-visible:ring-0 focus-visible:ring-offset-0',
                      emails.length > 0 || invalidEmails.length > 0 ? 'pl-1' : 'pl-0'
                    )}
                    autoFocus={currentUserIsAdmin}
                    disabled={isSubmitting || !currentUserIsAdmin}
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
                {hasPendingChanges && currentUserIsAdmin && (
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
                    !currentUserIsAdmin ||
                    !hasNewInvites ||
                    isSubmitting ||
                    isSaving ||
                    !activeWorkspaceId
                  }
                  className={cn(
                    'gap-2 font-medium ml-auto',
                    'bg-[#802FFF] hover:bg-[#7028E6]',
                    'shadow-[0_0_0_0_#802FFF] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'text-white transition-all duration-200',
                    'disabled:opacity-50 disabled:hover:bg-[#802FFF] disabled:hover:shadow-none'
                  )}
                >
                  {isSubmitting && <Loader2 className='h-4 w-4 animate-spin' />}
                  {!currentUserIsAdmin ? 'Admin Access Required' : (showSent ? 'Sent!' : 'Send Invitations')}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
