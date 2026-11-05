'use client'

import { useState } from 'react'
import { Modal, RecipientField, SelectField } from '@/platform/design-system/components'
import { ORGANIZATION_ROLE_OPTIONS, useInviteMembers } from '@/platform/lib/data/members'
import { useOrganization } from '@/platform/lib/data/organization'

interface InviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Recipient {
  address: string
  invalid?: boolean
}

type InviteRole = (typeof ORGANIZATION_ROLE_OPTIONS)[number]['value']

/**
 * Invites people to the organization. Workspace grants belong to the workspace entry points, which
 * stay on the legacy surface. Failed addresses stay in the field with their reasons so a retry
 * resends only those; the seat warning never blocks, because the server decides per address.
 */
export function InviteModal({ open, onOpenChange }: InviteModalProps) {
  const { viewer } = useOrganization()
  const invite = useInviteMembers(open)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [role, setRole] = useState<InviteRole>('member')
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setRecipients([])
      setRole('member')
    }
  }

  const problem = recipients
    .filter((recipient) => recipient.invalid)
    .map((recipient) => invite.addressProblem(recipient.address))
    .find(Boolean)

  return (
    <Modal
      title='Invite people'
      open={open}
      onOpenChange={onOpenChange}
      confirmLabel='Send invites'
      confirmDisabled={!invite.canInvite || recipients.length === 0 || Boolean(problem)}
      onConfirm={async () => {
        const { failed, message } = await invite.submit(
          recipients.map(({ address }) => address),
          role
        )
        if (message) {
          setRecipients(failed.map((address) => ({ address })))
          throw new Error(message)
        }
      }}
    >
      <RecipientField
        label='Email addresses'
        placeholder='name@company.com'
        recipients={recipients}
        onRecipientsChange={setRecipients}
        validate={(address) => invite.addressProblem(address) === null}
        error={problem ?? undefined}
        hint={invite.seatWarning(recipients.length)}
        disabled={!invite.canInvite}
      />
      <SelectField
        label='Role'
        options={viewer.isAdmin ? ORGANIZATION_ROLE_OPTIONS : ORGANIZATION_ROLE_OPTIONS.slice(0, 1)}
        value={role}
        onValueChange={(next) => setRole(next === 'admin' ? 'admin' : 'member')}
        disabled={!invite.canInvite}
      />
    </Modal>
  )
}
