'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { InlineNotice, Modal, RecipientField } from '@/platform/design-system/components'
import {
  quickValidateEmail,
  useInviteOrganizationAccountPeople,
} from '@/platform/lib/data/credential-groups'

interface PeopleInviteModalProps {
  organizationId: string
  onClose: () => void
}

interface Recipient {
  address: string
  invalid?: boolean
}

export function PeopleInviteModal({ organizationId, onClose }: PeopleInviteModalProps) {
  const invite = useInviteOrganizationAccountPeople()
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const emails = recipients.filter((recipient) => !recipient.invalid).map(({ address }) => address)
  const message =
    deliveryError ??
    (invite.error ? getErrorMessage(invite.error, 'Failed to send invitations') : null)

  async function submit() {
    if (!emails.length || invite.isPending) return false
    setDeliveryError(null)
    try {
      const result = await invite.mutateAsync({ organizationId, emails })
      const failures = result.results.filter((item) => !item.success)
      if (failures.length === 0) {
        toast.success(
          result.sentCount === 1
            ? 'Connection request sent'
            : `${result.sentCount} connection requests sent`
        )
        return
      }
      setRecipients(failures.map((item) => ({ address: item.email })))
      setDeliveryError(
        result.sentCount > 0
          ? `${result.sentCount} sent. ${failures.length} failed: ${failures.map((item) => item.email).join(', ')}`
          : `No invitations were sent: ${failures.map((item) => `${item.email} (${item.error})`).join(', ')}`
      )
    } catch {}
    return false
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Request account connections'
      confirmLabel={invite.isPending ? 'Sending...' : 'Send requests'}
      confirmDisabled={!emails.length || invite.isPending}
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
        disabled={invite.isPending}
      />
      {message && <InlineNotice intent='danger' message={message} />}
    </Modal>
  )
}
