'use client'

import { useState } from 'react'
import { Modal } from '@sim/emcn/modal'
import { InlineNotice } from '@sim/emcn/status'
import { RecipientField } from '@sim/emcn-platform/workspace-fields'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useConnectionRequestInvite } from '@/platform/embedded/lib/data/integrations'

interface PeopleInviteModalProps {
  organizationId: string
  onClose: () => void
}

interface Recipient {
  address: string
  invalid?: boolean
}

export function PeopleInviteModal({ organizationId, onClose }: PeopleInviteModalProps) {
  const invite = useConnectionRequestInvite(organizationId)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const emails = recipients.filter((recipient) => !recipient.invalid).map(({ address }) => address)
  const message = deliveryError ?? invite.error

  async function submit() {
    if (!emails.length || invite.pending) return false
    setDeliveryError(null)
    const delivery = await invite.send(emails)
    if (!delivery) return false
    const invalid = recipients.filter((recipient) => recipient.invalid)
    if (delivery.sent) {
      if (invalid.length === 0) return
      setRecipients(invalid)
      return false
    }
    setRecipients([...delivery.failed.map((address) => ({ address })), ...invalid])
    setDeliveryError(delivery.notice)
    return false
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Request account connections'
      confirmLabel={invite.pending ? 'Sending…' : 'Send requests'}
      confirmDisabled={!emails.length || invite.pending}
      onConfirm={submit}
    >
      <RecipientField
        label='Emails'
        placeholder='Enter emails'
        recipients={recipients}
        onRecipientsChange={(next) => {
          setRecipients(next)
          setDeliveryError(null)
        }}
        validate={(address) => quickValidateEmail(address).isValid}
        submitsWithInvalid
        error={recipients
          .filter((recipient) => recipient.invalid)
          .map((recipient) => quickValidateEmail(recipient.address).reason)
          .find(Boolean)}
        disabled={invite.pending}
      />
      {message && <InlineNotice intent='danger' message={message} />}
    </Modal>
  )
}
