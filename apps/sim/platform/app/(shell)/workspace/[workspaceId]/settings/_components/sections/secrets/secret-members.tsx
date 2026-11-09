'use client'

import { useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { SelectField } from '@sim/emcn/field'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { RecipientField } from '@sim/emcn-platform/workspace-fields'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-detail.module.css'
import {
  partitionSettledFailures,
  resolveAddEmail,
  useLeaveCredential,
  useRemoveWorkspaceCredentialMember,
  useSession,
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
  useWorkspacePermissionsQuery,
} from '@/platform/lib/data/secrets'

const MEMBER_ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

type MemberRole = (typeof MEMBER_ROLE_OPTIONS)[number]['value']

const toMemberRole = (value: string): MemberRole => (value === 'admin' ? 'admin' : 'member')

/** Why a credential member's role is fixed: workspace admins are credential admins by derivation. */
function credentialRoleLockReason(roleSource: 'explicit' | 'workspace-admin' | undefined) {
  return roleSource === 'workspace-admin'
    ? 'Workspace admins are automatically credential admins'
    : null
}

interface SecretMembersProps {
  credentialId: string
  credentialName: string
  isAdmin: boolean
  /** Leaving revokes the viewer's access, so they return to the list. */
  onLeft: () => void
}

/**
 * The secret's active members: role, removal for admins and leaving on the viewer's own row. The
 * last explicit admin cannot be demoted, removed or leave.
 */
export function SecretMembers({
  credentialId,
  credentialName,
  isAdmin,
  onLeft,
}: SecretMembersProps) {
  const { data: session } = useSession()
  const { data: members = [], isPending } = useWorkspaceCredentialMembers(credentialId)
  const upsertMember = useUpsertWorkspaceCredentialMember()
  const removeMember = useRemoveWorkspaceCredentialMember()
  const leaveCredential = useLeaveCredential()
  const [confirmingLeave, setConfirmingLeave] = useState(false)

  const viewerId = session?.user?.id
  const activeMembers = members.filter((member) => member.status === 'active')
  const explicitAdminCount = activeMembers.filter((member) => member.explicitAdmin).length

  const changeRole = async (userId: string, role: MemberRole) => {
    if (activeMembers.find((member) => member.userId === userId)?.role === role) return
    try {
      await upsertMember.mutateAsync({ credentialId, userId, role })
    } catch (error) {
      toast.error("Couldn't change role", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  const remove = async (userId: string) => {
    try {
      await removeMember.mutateAsync({ credentialId, userId })
    } catch (error) {
      toast.error("Couldn't remove member", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  return (
    <SettingsSection title={`Members (${activeMembers.length})`}>
      {isPending
        ? null
        : activeMembers.map((member) => {
            const name = member.userName || member.userEmail || member.userId
            const lockReason = credentialRoleLockReason(member.roleSource)
            const roleLocked =
              member.role === 'admin' &&
              member.roleSource !== 'workspace-admin' &&
              explicitAdminCount <= 1
            const actionDisabled = roleLocked || lockReason !== null
            const isViewer = member.userId === viewerId
            return (
              <SettingsRow
                key={member.id}
                label={name}
                description={member.userEmail || member.userId}
                leading={<Avatar name={name} src={member.userImage ?? undefined} />}
              >
                <span className={styles.controls}>
                  <ChoiceMenu
                    label={`Role for ${name}`}
                    options={MEMBER_ROLE_OPTIONS}
                    value={member.role}
                    disabled={!isAdmin || actionDisabled}
                    disabledReason={lockReason ?? undefined}
                    onValueChange={(role) => void changeRole(member.userId, toMemberRole(role))}
                  />
                  {isViewer ? (
                    <Button
                      size='compact'
                      variant='quiet'
                      destructive
                      disabled={actionDisabled}
                      disabledReason={
                        lockReason ??
                        (roleLocked ? 'Make someone else an admin before leaving' : undefined)
                      }
                      onClick={() => setConfirmingLeave(true)}
                    >
                      Leave
                    </Button>
                  ) : (
                    isAdmin && (
                      <Button
                        size='compact'
                        variant='quiet'
                        disabled={actionDisabled}
                        disabledReason={lockReason ?? undefined}
                        onClick={() => void remove(member.userId)}
                      >
                        Remove
                      </Button>
                    )
                  )}
                </span>
              </SettingsRow>
            )
          })}
      <ConfirmDialog
        target={confirmingLeave}
        onClose={() => setConfirmingLeave(false)}
        title='Leave credential'
        description={`Are you sure you want to leave ${credentialName}? You will lose access to it until an admin adds you back.`}
        confirmLabel='Leave'
        pendingLabel='Leaving...'
        onConfirm={async () => {
          await leaveCredential.mutateAsync(credentialId)
          setConfirmingLeave(false)
          onLeft()
        }}
      />
    </SettingsSection>
  )
}

interface AddPeopleModalProps {
  workspaceId: string
  credentialId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Grants existing workspace members access to the secret with a role. Each add is an idempotent
 * upsert; on a partial failure only the people still to add stay in the field.
 */
export function AddPeopleModal({
  workspaceId,
  credentialId,
  open,
  onOpenChange,
}: AddPeopleModalProps) {
  const { data: permissions } = useWorkspacePermissionsQuery(workspaceId)
  const { data: members = [] } = useWorkspaceCredentialMembers(credentialId)
  const { mutateAsync: upsertMember } = useUpsertWorkspaceCredentialMember()
  const [emails, setEmails] = useState<string[]>([])
  const [role, setRole] = useState<MemberRole>('member')

  const context = {
    workspaceUserIdByEmail: new Map(
      (permissions?.users ?? []).map((user) => [user.email.toLowerCase(), user.userId])
    ),
    existingMemberEmails: new Set(
      members
        .filter((member) => member.status === 'active')
        .map((member) => (member.userEmail ?? '').toLowerCase())
        .filter(Boolean)
    ),
  }
  const errorFor = (email: string) => {
    const result = resolveAddEmail(email, context)
    return 'error' in result ? result.error : null
  }
  const firstError = emails.map(errorFor).find(Boolean) ?? undefined

  const close = () => {
    setEmails([])
    setRole('member')
    onOpenChange(false)
  }

  const add = async () => {
    const targets = emails.flatMap((email) => {
      const result = resolveAddEmail(email, context)
      return 'userId' in result ? [{ email, userId: result.userId }] : []
    })
    if (targets.length === 0) return false
    const results = await Promise.allSettled(
      targets.map((target) => upsertMember({ credentialId, userId: target.userId, role }))
    )
    const failures = partitionSettledFailures(targets, results)
    if (failures.length === 0) {
      setEmails([])
      setRole('member')
      return
    }
    setEmails(failures.map((target) => target.email))
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    const reason = getErrorMessage(rejection?.reason, 'Please try again in a moment.')
    throw new Error(
      failures.length === targets.length
        ? `Couldn't add people. ${reason}`
        : `Couldn't add ${failures.length} of ${targets.length} people. ${reason}`
    )
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title='Add people'
      confirmLabel='Add'
      confirmDisabled={emails.length === 0 || Boolean(firstError)}
      onConfirm={add}
    >
      <RecipientField
        label='Emails'
        placeholder='Enter emails'
        recipients={emails.map((address) => ({ address, invalid: Boolean(errorFor(address)) }))}
        onRecipientsChange={(recipients) => setEmails(recipients.map(({ address }) => address))}
        validate={(address) => !errorFor(address)}
        error={firstError}
      />
      <SelectField
        label='Role'
        options={MEMBER_ROLE_OPTIONS}
        value={role}
        onValueChange={(next) => setRole(toMemberRole(next))}
      />
    </Modal>
  )
}
