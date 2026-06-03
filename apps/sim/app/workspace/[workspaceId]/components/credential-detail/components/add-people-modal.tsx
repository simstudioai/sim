'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@/components/emcn'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
  type WorkspaceCredentialRole,
} from '@/hooks/queries/credentials'
import { ROLE_OPTIONS } from '../roles'
import { partitionSettledFailures, resolveAddEmail } from '../sharing'

const logger = createLogger('AddPeopleModal')

interface AddPeopleModalProps {
  credentialId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Shared "Add people" modal: grants existing workspace members access to a
 * credential with a chosen role. Emails are validated against the workspace
 * roster and current membership; each add is an idempotent upsert and partial
 * failures keep only the people that still need adding.
 */
export function AddPeopleModal({ credentialId, open, onOpenChange }: AddPeopleModalProps) {
  const { workspacePermissions } = useWorkspacePermissionsContext()
  const { data: members = [] } = useWorkspaceCredentialMembers(credentialId)
  const upsertMember = useUpsertWorkspaceCredentialMember()

  const [emailsToAdd, setEmailsToAdd] = useState<string[]>([])
  const [roleToAdd, setRoleToAdd] = useState<WorkspaceCredentialRole>('member')
  const [isAdding, setIsAdding] = useState(false)

  const workspaceUserIdByEmail = useMemo(
    () =>
      new Map(
        (workspacePermissions?.users ?? []).map((user) => [user.email.toLowerCase(), user.userId])
      ),
    [workspacePermissions?.users]
  )

  const existingMemberEmails = useMemo(
    () =>
      new Set(
        members
          .filter((member) => member.status === 'active')
          .map((member) => (member.userEmail ?? '').toLowerCase())
          .filter(Boolean)
      ),
    [members]
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
    onOpenChange(false)
  }, [onOpenChange])

  const handleAddPeople = useCallback(async () => {
    if (emailsToAdd.length === 0 || isAdding) return
    const targets = emailsToAdd
      .map((email) => ({ email, userId: workspaceUserIdByEmail.get(email) }))
      .filter((target): target is { email: string; userId: string } => Boolean(target.userId))
    if (targets.length === 0) return

    setIsAdding(true)
    try {
      const results = await Promise.allSettled(
        targets.map((target) =>
          upsertMember.mutateAsync({ credentialId, userId: target.userId, role: roleToAdd })
        )
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
      logger.error('Failed to add some credential members', firstError?.reason)
      toast.error(
        failures.length === targets.length
          ? "Couldn't add people"
          : `Couldn't add ${failures.length} of ${targets.length} people`,
        { description: getErrorMessage(firstError?.reason, 'Please try again in a moment.') }
      )
    } finally {
      setIsAdding(false)
    }
  }, [
    credentialId,
    emailsToAdd,
    isAdding,
    workspaceUserIdByEmail,
    roleToAdd,
    upsertMember,
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
        <ChipModalField
          type='dropdown'
          title='Role'
          options={ROLE_OPTIONS}
          value={roleToAdd}
          placeholder='Select role'
          align='start'
          onChange={(role) => setRoleToAdd(role as WorkspaceCredentialRole)}
          disabled={isAdding}
        />
      </ChipModalBody>
      <ChipModalFooter>
        <Chip
          variant='primary'
          onClick={handleAddPeople}
          disabled={emailsToAdd.length === 0 || isAdding}
        >
          {isAdding ? 'Adding...' : 'Add'}
        </Chip>
      </ChipModalFooter>
    </ChipModal>
  )
}
