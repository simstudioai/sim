'use client'

import React, { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { API_ENDPOINTS } from '@/stores/constants'
import type { PermissionType, UserPermissions } from './components'
import { EmailTag, PermissionsTable } from './components'

const logger = createLogger('InviteModal')

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceName?: string
}

interface PendingInvitation {
  id: string
  workspaceId: string
  email: string
  permissions: PermissionType
  status: string
  createdAt: string
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
        const successfulEmails = emails.filter((_, index) => results[index])

        if (successCount > 0) {
          if (successfulEmails.length > 0) {
            const newPendingInvitations: UserPermissions[] = successfulEmails.map((email) => {
              const userPermission = userPermissions.find((up) => up.email === email)
              const permissionType = userPermission?.permissionType || 'read'

              return {
                email,
                permissionType,
                isPendingInvitation: true,
              }
            })

            setPendingInvitations((prev) => {
              const existingEmails = new Set(prev.map((inv) => inv.email))
              const merged = [...prev]

              newPendingInvitations.forEach((inv) => {
                if (!existingEmails.has(inv.email)) {
                  merged.push(inv)
                }
              })

              return merged
            })
          }

          fetchPendingInvitations()
          setInputValue('')

          if (failedInvites.length > 0) {
            setEmails(failedInvites)
            setUserPermissions((prev) => prev.filter((user) => failedInvites.includes(user.email)))
          } else {
            setEmails([])
            setUserPermissions([])
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
      <ModalContent className='w-[500px]'>
        <ModalHeader>Invite members to {workspaceName || 'Workspace'}</ModalHeader>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className='flex min-h-0 flex-1 flex-col'
          autoComplete='off'
        >
          <ModalBody>
            <div className='space-y-[12px]'>
              <div>
                <Label
                  htmlFor='invite-field'
                  className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
                >
                  Email Addresses
                </Label>
                {/* Hidden decoy fields to prevent browser autofill */}
                <input
                  type='text'
                  name='fakeusernameremembered'
                  autoComplete='username'
                  style={{
                    position: 'absolute',
                    left: '-9999px',
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                  tabIndex={-1}
                  readOnly
                />
                <input
                  type='email'
                  name='fakeemailremembered'
                  autoComplete='email'
                  style={{
                    position: 'absolute',
                    left: '-9999px',
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                  tabIndex={-1}
                  readOnly
                />
                <div className='scrollbar-hide flex max-h-32 min-h-9 flex-wrap items-center gap-x-[8px] gap-y-[4px] overflow-y-auto rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[6px] py-[4px] focus-within:outline-none dark:bg-[var(--surface-5)]'>
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
                    id='invite-field'
                    name='invite_search_field'
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
                    autoComplete='off'
                    autoCorrect='off'
                    autoCapitalize='off'
                    spellCheck={false}
                    data-lpignore='true'
                    data-form-type='other'
                    aria-autocomplete='none'
                  />
                </div>
              </div>
              {errorMessage && (
                <p className='mt-[4px] text-[12px] text-[var(--text-error)]'>{errorMessage}</p>
              )}
            </div>
            <div className='mt-[8px]'>
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
            </div>
          </ModalBody>

          <ModalFooter className='justify-between'>
            {hasPendingChanges && userPerms.canAdmin && (
              <div className='flex gap-[8px]'>
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
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            )}

            <Button
              type='button'
              variant='tertiary'
              onClick={() => formRef.current?.requestSubmit()}
              disabled={
                !userPerms.canAdmin || isSubmitting || isSaving || !workspaceId || !hasNewInvites
              }
              className='ml-auto'
            >
              {!userPerms.canAdmin
                ? 'Admin Access Required'
                : isSubmitting
                  ? 'Inviting...'
                  : 'Invite'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>

      {/* Remove Member Confirmation Dialog */}
      <Modal open={!!memberToRemove} onOpenChange={handleRemoveMemberCancel}>
        <ModalContent>
          <ModalHeader>Remove Member</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to remove{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {memberToRemove?.email}
              </span>{' '}
              from this workspace?{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={handleRemoveMemberCancel}
              disabled={isRemovingMember}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRemoveMemberConfirm}
              disabled={isRemovingMember}
            >
              {isRemovingMember ? 'Removing...' : 'Remove Member'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Remove Invitation Confirmation Dialog */}
      <Modal open={!!invitationToRemove} onOpenChange={handleRemoveInvitationCancel}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Cancel Invitation</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to cancel the invitation for{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {invitationToRemove?.email}
              </span>
              ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={handleRemoveInvitationCancel}
              disabled={isRemovingInvitation}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleRemoveInvitationConfirm}
              disabled={isRemovingInvitation}
            >
              {isRemovingInvitation ? 'Cancelling...' : 'Cancel Invitation'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Modal>
  )
}
