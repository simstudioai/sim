'use client'

import { useState } from 'react'
import { SelectField } from '@/platform/design-system/components/field/fields'
import { Modal } from '@/platform/design-system/components/modal/modal'
import { RecipientField } from '@/platform/design-system/components/workspace-fields/workspace-fields'
import { ORGANIZATION_ROLE_OPTIONS, useInviteMembers } from '@/platform/embedded/lib/data/invite'

interface InviteModalProps {
  onClose: () => void
}

interface Recipient {
  address: string
  invalid?: boolean
}

type InviteRole = (typeof ORGANIZATION_ROLE_OPTIONS)[number]['value']

/**
 * Invites people to the organization. Workspace grants belong to the workspace entry points. Failed
 * addresses stay in the field with their reasons so a retry resends only those, and the seat warning
 * never blocks, because the server decides per address.
 */
export function InviteModal({ onClose }: InviteModalProps) {
  const invite = useInviteMembers()
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [role, setRole] = useState<InviteRole>('member')

  const valid = recipients.filter((recipient) => !recipient.invalid)
  const rejected = recipients.filter((recipient) => recipient.invalid)
  const problem = recipients
    .filter((recipient) => recipient.invalid)
    .map((recipient) => invite.addressProblem(recipient.address))
    .find(Boolean)

  return (
    <Modal
      title='Invite people'
      open
      onOpenChange={onClose}
      confirmLabel='Send invites'
      confirmDisabled={valid.length === 0}
      onConfirm={async () => {
        const { failed, message } = await invite.submit(
          valid.map(({ address }) => address),
          role
        )
        if (message) {
          setRecipients([...failed.map((address) => ({ address })), ...rejected])
          throw new Error(message)
        }
        if (rejected.length > 0) {
          setRecipients(rejected)
          return false
        }
      }}
    >
      <RecipientField
        label='Email addresses'
        placeholder='name@company.com'
        recipients={recipients}
        onRecipientsChange={setRecipients}
        validate={(address) => invite.addressProblem(address) === null}
        submitsWithInvalid
        error={problem ?? undefined}
        hint={invite.seatWarning(valid.length)}
      />
      <SelectField
        label='Role'
        options={ORGANIZATION_ROLE_OPTIONS}
        value={role}
        onValueChange={(next) => setRole(next === 'admin' ? 'admin' : 'member')}
      />
    </Modal>
  )
}
