'use client'
import { useCallback, useMemo } from 'react'
import {
  type AddPeopleTarget,
  type MemberRole,
  AddPeopleModal as SharedAddPeopleModal,
} from '@/components/permissions'
import {
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
} from '@/hooks/queries/credentials'

interface AddPeopleModalProps {
  credentialId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * "Add people" for a credential: wires the shared modal to credential
 * membership. Active members count as already having access.
 */
export function AddPeopleModal({ credentialId, open, onOpenChange }: AddPeopleModalProps) {
  const { data: members = [] } = useWorkspaceCredentialMembers(credentialId)
  const { mutateAsync: upsertMemberAsync } = useUpsertWorkspaceCredentialMember()

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

  const addMember = useCallback(
    (target: AddPeopleTarget, role: MemberRole) =>
      upsertMemberAsync({ credentialId, userId: target.userId, role }),
    [upsertMemberAsync, credentialId]
  )

  return (
    <SharedAddPeopleModal
      open={open}
      onOpenChange={onOpenChange}
      existingMemberEmails={existingMemberEmails}
      addMember={addMember}
    />
  )
}
