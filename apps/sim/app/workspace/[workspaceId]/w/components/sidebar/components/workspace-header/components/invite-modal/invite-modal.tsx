'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import {
  Button,
  type FileInputOptions,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TagInput,
  type TagItem,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { PermissionsTable } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/invite-modal/components/permissions-table'
import {
  useBatchSendWorkspaceInvitations,
  useCancelWorkspaceInvitation,
  usePendingInvitations,
  useRemoveWorkspaceMember,
  useResendWorkspaceInvitation,
  useUpdateWorkspacePermissions,
} from '@/hooks/queries/invitations'
import type { PermissionType, UserPermissions } from './components/types'

const logger = createLogger('InviteModal')

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceName?: string
}

export function InviteModal({ open, onOpenChange, workspaceName }: InviteModalProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [emailItems, setEmailItems] = useState<TagItem[]>([])
  const [userPermissions, setUserPermissions] = useState<UserPermissions[]>([])
  const [existingUserPermissionChanges, setExistingUserPermissionChanges] = useState<
    Record<string, Partial<UserPermissions>>
  >({})
  const cooldownIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [memberToRemove, setMemberToRemove] = useState<{ userId: string; email: string } | null>(
    null
  )
  const [invitationToRemove, setInvitationToRemove] = useState<{
    invitationId: string
    email: string
  } | null>(null)
  const [resendCooldowns, setResendCooldowns] = useState<Record<string, number>>({})
  const [resentInvitationIds, setResentInvitationIds] = useState<Record<string, boolean>>({})
  const [resendingInvitationIds, setResendingInvitationIds] = useState<Record<string, boolean>>({})
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: session } = useSession()
  const {
    workspacePermissions,
    permissionsLoading,
    updatePermissions,
    userPermissions: userPerms,
  } = useWorkspacePermissionsContext()

  const { data: pendingInvitations = [], isLoading: isPendingInvitationsLoading } =
    usePendingInvitations(open ? workspaceId : undefined)

  const batchSendInvitations = useBatchSendWorkspaceInvitations()
  const cancelInvitation = useCancelWorkspaceInvitation()
  const resendInvitation = useResendWorkspaceInvitation()
  const removeMember = useRemoveWorkspaceMember()
  const updatePermissionsMutation = useUpdateWorkspacePermissions()

  const hasPendingChanges = Object.keys(existingUserPermissionChanges).length > 0
  const validEmails = emailItems.filter((item) => item.isValid).map((item) => item.value)
  const hasNewInvites = validEmails.length > 0

  const isSubmitting = batchSendInvitations.isPending
  const isSaving = updatePermissionsMutation.isPending
  const isRemovingMember = removeMember.isPending
  const isRemovingInvitation = cancelInvitation.isPending

  useEffect(() => {
    if (open) {
      setErrorMessage(null)
    }
  }, [open])

  useEffect(() => {
    const intervalsRef = cooldownIntervalsRef.current
    return () => {
      intervalsRef.forEach((interval) => clearInterval(interval))
      intervalsRef.clear()
    }
  }, [])

  const addEmail = useCallback(
    (email: string) => {
      if (!email.trim()) return false

      const normalized = email.trim().toLowerCase()
      const validation = quickValidateEmail(normalized)
      const isValid = validation.isValid

      if (emailItems.some((item) => item.value === normalized)) {
        return false
      }

      const hasPendingInvitation = pendingInvitations.some((inv) => inv.email === normalized)
      if (hasPendingInvitation) {
        setErrorMessage(`${normalized} already has a pending invitation`)
        return false
      }

      const isExistingMember = workspacePermissions?.users?.some(
        (user) => user.email === normalized
      )
      if (isExistingMember) {
        setErrorMessage(`${normalized} is already a member of this workspace`)
        return false
      }

      if (session?.user?.email && session.user.email.toLowerCase() === normalized) {
        setErrorMessage('You cannot invite yourself')
        return false
      }

      setEmailItems((prev) => [...prev, { value: normalized, isValid }])

      if (isValid) {
        setErrorMessage(null)
        setUserPermissions((prev) => [
          ...prev,
          {
            email: normalized,
            permissionType: 'admin',
          },
        ])
      }

      return isValid
    },
    [emailItems, pendingInvitations, workspacePermissions?.users, session?.user?.email]
  )

  const removeEmailItem = useCallback((value: string, index: number, isValid?: boolean) => {
    setEmailItems((prev) => prev.filter((_, i) => i !== index))
    if (isValid) {
      setUserPermissions((prev) => prev.filter((user) => user.email !== value))
    }
  }, [])

  const fileInputOptions: FileInputOptions = useMemo(
    () => ({
      enabled: userPerms.canAdmin,
      accept: '.csv,.txt,text/csv,text/plain',
      extractValues: (text: string) => {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
        const matches = text.match(emailRegex) || []
        const uniqueEmails = [...new Set(matches.map((e) => e.toLowerCase()))]
        return uniqueEmails.filter((email) => quickValidateEmail(email).isValid)
      },
      tooltip: 'Upload emails',
    }),
    [userPerms.canAdmin]
  )

  const handlePermissionChange = useCallback(
    (identifier: string, permissionType: PermissionType) => {
      const existingUser = workspacePermissions?.users?.find((user) => user.userId === identifier)

      if (existingUser) {
        setExistingUserPermissionChanges((prev) => {
          const newChanges = { ...prev }

          if (existingUser.permissionType === permissionType) {
            delete newChanges[identifier]
          } else {
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

  const handleSaveChanges = useCallback(() => {
    if (!userPerms.canAdmin || !hasPendingChanges || !workspaceId) return

    setErrorMessage(null)

    const updates = Object.entries(existingUserPermissionChanges).map(([userId, changes]) => ({
      userId,
      permissions: (changes.permissionType || 'read') as 'admin' | 'write' | 'read',
    }))

    updatePermissionsMutation.mutate(
      { workspaceId, updates },
      {
        onSuccess: (data) => {
          if (data.users && data.total !== undefined) {
            updatePermissions({ users: data.users, total: data.total })
          }
          setExistingUserPermissionChanges({})
        },
        onError: (error) => {
          logger.error('Error saving permission changes:', error)
          setErrorMessage(error.message || 'Failed to save permission changes. Please try again.')
        },
      }
    )
  }, [
    userPerms.canAdmin,
    hasPendingChanges,
    workspaceId,
    existingUserPermissionChanges,
    updatePermissions,
    updatePermissionsMutation,
  ])

  const handleRestoreChanges = useCallback(() => {
    if (!userPerms.canAdmin || !hasPendingChanges) return

    setExistingUserPermissionChanges({})
  }, [userPerms.canAdmin, hasPendingChanges])

  const handleRemoveMemberClick = useCallback((userId: string, email: string) => {
    setMemberToRemove({ userId, email })
  }, [])

  const handleRemoveMemberConfirm = useCallback(() => {
    if (!memberToRemove || !workspaceId || !userPerms.canAdmin) return

    setErrorMessage(null)

    const userRecord = workspacePermissions?.users?.find(
      (user) => user.userId === memberToRemove.userId
    )

    if (!userRecord) {
      setErrorMessage('User is not a member of this workspace')
      setMemberToRemove(null)
      return
    }

    removeMember.mutate(
      { userId: memberToRemove.userId, workspaceId },
      {
        onSuccess: () => {
          if (workspacePermissions) {
            const updatedUsers = workspacePermissions.users.filter(
              (user) => user.userId !== memberToRemove.userId
            )
            updatePermissions({
              users: updatedUsers,
              total: workspacePermissions.total - 1,
            })
          }

          setExistingUserPermissionChanges((prev) => {
            const updated = { ...prev }
            delete updated[memberToRemove.userId]
            return updated
          })
          setMemberToRemove(null)
        },
        onError: (error) => {
          logger.error('Error removing member:', error)
          setErrorMessage(error.message || 'Failed to remove member. Please try again.')
          setMemberToRemove(null)
        },
      }
    )
  }, [
    memberToRemove,
    workspaceId,
    userPerms.canAdmin,
    workspacePermissions,
    updatePermissions,
    removeMember,
  ])

  const handleRemoveMemberCancel = useCallback(() => {
    setMemberToRemove(null)
  }, [])

  const handleRemoveInvitationClick = useCallback((invitationId: string, email: string) => {
    setInvitationToRemove({ invitationId, email })
  }, [])

  const handleRemoveInvitationConfirm = useCallback(() => {
    if (!invitationToRemove || !workspaceId || !userPerms.canAdmin) return

    setErrorMessage(null)

    cancelInvitation.mutate(
      { invitationId: invitationToRemove.invitationId, workspaceId },
      {
        onSuccess: () => {
          setInvitationToRemove(null)
        },
        onError: (error) => {
          logger.error('Error cancelling invitation:', error)
          setErrorMessage(error.message || 'Failed to cancel invitation. Please try again.')
          setInvitationToRemove(null)
        },
      }
    )
  }, [invitationToRemove, workspaceId, userPerms.canAdmin, cancelInvitation])

  const handleRemoveInvitationCancel = useCallback(() => {
    setInvitationToRemove(null)
  }, [])

  const handleResendInvitation = useCallback(
    (invitationId: string) => {
      if (!workspaceId || !userPerms.canAdmin) return

      const secondsLeft = resendCooldowns[invitationId]
      if (secondsLeft && secondsLeft > 0) return

      if (resendingInvitationIds[invitationId]) return

      setErrorMessage(null)
      setResendingInvitationIds((prev) => ({ ...prev, [invitationId]: true }))

      resendInvitation.mutate(
        { invitationId, workspaceId },
        {
          onSuccess: () => {
            setResendingInvitationIds((prev) => {
              const next = { ...prev }
              delete next[invitationId]
              return next
            })
            setResentInvitationIds((prev) => ({ ...prev, [invitationId]: true }))
            setTimeout(() => {
              setResentInvitationIds((prev) => {
                const next = { ...prev }
                delete next[invitationId]
                return next
              })
            }, 4000)

            setResendCooldowns((prev) => ({ ...prev, [invitationId]: 60 }))

            const existingInterval = cooldownIntervalsRef.current.get(invitationId)
            if (existingInterval) {
              clearInterval(existingInterval)
            }

            const interval = setInterval(() => {
              setResendCooldowns((prev) => {
                const current = prev[invitationId]
                if (current === undefined) return prev
                if (current <= 1) {
                  const next = { ...prev }
                  delete next[invitationId]
                  clearInterval(interval)
                  cooldownIntervalsRef.current.delete(invitationId)
                  return next
                }
                return { ...prev, [invitationId]: current - 1 }
              })
            }, 1000)

            cooldownIntervalsRef.current.set(invitationId, interval)
          },
          onError: (error) => {
            setResendingInvitationIds((prev) => {
              const next = { ...prev }
              delete next[invitationId]
              return next
            })
            logger.error('Error resending invitation:', error)
            setErrorMessage(error.message || 'Failed to resend invitation. Please try again.')
          },
        }
      )
    },
    [workspaceId, userPerms.canAdmin, resendCooldowns, resendingInvitationIds, resendInvitation]
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()

      setErrorMessage(null)

      if (validEmails.length === 0 || !workspaceId) {
        return
      }

      const invitations = validEmails.map((email) => {
        const userPermission = userPermissions.find((up) => up.email === email)
        return {
          email,
          permission: (userPermission?.permissionType || 'read') as 'admin' | 'write' | 'read',
        }
      })

      batchSendInvitations.mutate(
        { workspaceId, invitations },
        {
          onSuccess: (result) => {
            if (result.failed.length > 0) {
              setEmailItems(result.failed.map((f) => ({ value: f.email, isValid: true })))
              setUserPermissions((prev) =>
                prev.filter((user) => result.failed.some((f) => f.email === user.email))
              )
              setErrorMessage(result.failed[0].error)
            } else {
              setEmailItems([])
              setUserPermissions([])
            }
          },
          onError: (error) => {
            logger.error('Error inviting members:', error)
            setErrorMessage(error.message || 'An unexpected error occurred. Please try again.')
          },
        }
      )
    },
    [validEmails, workspaceId, userPermissions, batchSendInvitations]
  )

  const resetState = useCallback(() => {
    setEmailItems([])
    setUserPermissions([])
    setExistingUserPermissionChanges({})
    setErrorMessage(null)
    setMemberToRemove(null)
    setInvitationToRemove(null)
    setResendCooldowns({})
    setResentInvitationIds({})
    setResendingInvitationIds({})

    cooldownIntervalsRef.current.forEach((interval) => clearInterval(interval))
    cooldownIntervalsRef.current.clear()
  }, [])

  const pendingInvitationsForTable: UserPermissions[] = useMemo(
    () =>
      pendingInvitations.map((inv) => ({
        email: inv.email,
        permissionType: inv.permissionType,
        isPendingInvitation: true,
        invitationId: inv.invitationId,
      })),
    [pendingInvitations]
  )

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
      <ModalContent size='md'>
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
                <TagInput
                  id='invite-field'
                  name='invite_search_field'
                  items={emailItems}
                  onAdd={(value) => addEmail(value)}
                  onRemove={removeEmailItem}
                  onInputChange={() => setErrorMessage(null)}
                  placeholder={
                    !userPerms.canAdmin
                      ? 'Only administrators can invite new members'
                      : 'Enter emails'
                  }
                  placeholderWithTags='Add email'
                  autoFocus={userPerms.canAdmin}
                  disabled={isSubmitting || !userPerms.canAdmin}
                  fileInputOptions={fileInputOptions}
                />
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
                pendingInvitations={pendingInvitationsForTable}
                isPendingInvitationsLoading={isPendingInvitationsLoading}
                resendingInvitationIds={resendingInvitationIds}
                resentInvitationIds={resentInvitationIds}
                resendCooldowns={resendCooldowns}
              />
            </div>
          </ModalBody>

          <ModalFooter className='justify-between'>
            <div
              className={`flex gap-[8px] ${hasPendingChanges && userPerms.canAdmin ? '' : 'pointer-events-none invisible'}`}
              aria-hidden={!(hasPendingChanges && userPerms.canAdmin)}
            >
              <Button
                type='button'
                variant='default'
                disabled={isSaving || isSubmitting}
                onClick={handleRestoreChanges}
                tabIndex={hasPendingChanges && userPerms.canAdmin ? 0 : -1}
              >
                Restore Changes
              </Button>
              <Button
                type='button'
                variant='tertiary'
                disabled={isSaving || isSubmitting}
                onClick={handleSaveChanges}
                tabIndex={hasPendingChanges && userPerms.canAdmin ? 0 : -1}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>

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
        <ModalContent size='sm'>
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
        <ModalContent size='sm'>
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
