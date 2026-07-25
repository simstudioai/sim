'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { partitionSettledFailures, resolveAddEmail } from '@/lib/workspaces/sharing'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { MEMBER_ROLE_OPTIONS, type MemberRole } from './member-role-options'

const logger = createLogger('AddPeopleModal')

export interface AddPeopleTarget {
  email: string
  userId: string
}

interface AddPeopleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Lowercased emails that already have access — rejected as duplicates. */
  existingMemberEmails: Set<string>
  /** Grants one person the role; a rejection surfaces as a partial failure. */
  addMember: (target: AddPeopleTarget, role: MemberRole) => Promise<unknown>
  /**
   * Hides the Role field for resources without per-member roles (skills):
   * every add is a plain grant and `addMember` receives the default role.
   */
  hideRole?: boolean
}

/**
 * Shared "Add people" modal for member-managed resources (credentials, skills):
 * grants existing workspace members access, optionally with a chosen role.
 * Emails are validated against the workspace roster and current membership;
 * each add is an idempotent upsert and partial failures keep only the people
 * that still need adding.
 */
export function AddPeopleModal({
  open,
  onOpenChange,
  existingMemberEmails,
  addMember,
  hideRole = false,
}: AddPeopleModalProps) {
  const { workspacePermissions } = useWorkspacePermissionsContext()

  const [emailsToAdd, setEmailsToAdd] = useState<string[]>([])
  const [roleToAdd, setRoleToAdd] = useState<MemberRole>('member')
  const [isAdding, setIsAdding] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const workspaceUserIdByEmail = useMemo(
    () =>
      new Map(
        (workspacePermissions?.users ?? []).map((user) => [user.email.toLowerCase(), user.userId])
      ),
    [workspacePermissions?.users]
  )

  const validateAddEmail = useCallback(
    (email: string): string | null => {
      const result = resolveAddEmail(email, { workspaceUserIdByEmail, existingMemberEmails })
      return 'error' in result ? result.error : null
    },
    [workspaceUserIdByEmail, existingMemberEmails]
  )

  const handleClose = useCallback(() => {
    setEmailsToAdd([])
    setRoleToAdd('member')
    setSubmitError(null)
    onOpenChange(false)
  }, [onOpenChange])

  const handleAddPeople = useCallback(async () => {
    if (emailsToAdd.length === 0 || isAdding) return
    setSubmitError(null)
    const targets = emailsToAdd
      .map((email) => {
        const result = resolveAddEmail(email, { workspaceUserIdByEmail, existingMemberEmails })
        return 'userId' in result ? { email, userId: result.userId } : null
      })
      .filter((target): target is AddPeopleTarget => target !== null)
    if (targets.length === 0) return

    setIsAdding(true)
    try {
      const results = await Promise.allSettled(
        targets.map((target) => addMember(target, roleToAdd))
      )
      const failures = partitionSettledFailures(targets, results)
      if (failures.length === 0) {
        handleClose()
        return
      }
      setEmailsToAdd(failures.map((target) => target.email))
      const firstError = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      logger.error('Failed to add some members', firstError?.reason)
      const reason = getErrorMessage(firstError?.reason, 'Please try again in a moment.')
      setSubmitError(
        failures.length === targets.length
          ? `Couldn't add people. ${reason}`
          : `Couldn't add ${failures.length} of ${targets.length} people. ${reason}`
      )
    } finally {
      setIsAdding(false)
    }
  }, [
    emailsToAdd,
    isAdding,
    workspaceUserIdByEmail,
    existingMemberEmails,
    roleToAdd,
    addMember,
    handleClose,
  ])

  return (
    <ChipModal
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
      }}
      srTitle='Add people'
    >
      <ChipModalHeader onClose={handleClose}>Add people</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='emails'
          title='Emails'
          value={emailsToAdd}
          onChange={setEmailsToAdd}
          validate={validateAddEmail}
          placeholder='Enter emails'
          disabled={isAdding}
        />
        {!hideRole && (
          <ChipModalField
            type='dropdown'
            title='Role'
            options={MEMBER_ROLE_OPTIONS}
            value={roleToAdd}
            placeholder='Select role'
            align='start'
            onChange={(role) => setRoleToAdd(role as MemberRole)}
            disabled={isAdding}
          />
        )}
        <ChipModalError>{submitError}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={handleClose}
        primaryAction={{
          label: isAdding ? 'Adding...' : 'Add',
          onClick: handleAddPeople,
          disabled: emailsToAdd.length === 0 || isAdding,
        }}
      />
    </ChipModal>
  )
}
