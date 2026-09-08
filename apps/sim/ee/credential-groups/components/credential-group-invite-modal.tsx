'use client'

import { useCallback, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useInviteCredentialGroupEnrollments } from '@/hooks/queries/credential-groups'

interface CredentialGroupInviteModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  groupId: string
}

function validateEmail(email: string): string | null {
  const result = quickValidateEmail(email)
  return result.isValid ? null : (result.reason ?? 'Invalid email')
}

export function CredentialGroupInviteModal({
  open,
  onOpenChange,
  workspaceId,
  groupId,
}: CredentialGroupInviteModalProps) {
  const invite = useInviteCredentialGroupEnrollments()
  const [emails, setEmails] = useState<string[]>([])
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const canSubmit = emails.length > 0 && !invite.isPending

  const handleEmailsChange = useCallback((next: string[]) => {
    setEmails(next)
    setDeliveryError(null)
  }, [])

  const handleOpenChange = (nextOpen: boolean) => {
    if (invite.isPending) return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setEmails([])
      setDeliveryError(null)
      invite.reset()
    }
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setDeliveryError(null)
    try {
      const result = await invite.mutateAsync({
        workspaceId,
        groupId,
        body: { emails },
      })
      const failures = result.results.filter((item) => !item.success)
      if (failures.length === 0) {
        toast.success(
          result.sentCount === 1
            ? 'Connection request sent'
            : `${result.sentCount} connection requests sent`
        )
        handleOpenChange(false)
        return
      }

      setEmails(failures.map((item) => item.email))
      setDeliveryError(
        result.sentCount > 0
          ? `${result.sentCount} sent. ${failures.length} failed: ${failures.map((item) => item.email).join(', ')}`
          : `No invitations were sent: ${failures.map((item) => `${item.email} (${item.error})`).join(', ')}`
      )
    } catch {
      return
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      srTitle='Request account connections'
      dismissDisabled={invite.isPending}
    >
      <ChipModalHeader onClose={() => handleOpenChange(false)}>
        Request account connections
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='emails'
          title='Emails'
          value={emails}
          onChange={handleEmailsChange}
          validate={validateEmail}
          placeholder='Enter emails'
          hint='Each person receives a link to connect their accounts. They can connect and leave without joining Sim. To give someone access to Search in Sim, invite them from Teammates.'
          disabled={invite.isPending}
        />
        <ChipModalError>
          {deliveryError ??
            (invite.error ? getErrorMessage(invite.error, 'Failed to send invitations') : null)}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={invite.isPending}
        primaryAction={{
          label: invite.isPending ? 'Sending...' : 'Send requests',
          onClick: handleSubmit,
          disabled: !canSubmit,
        }}
      />
    </ChipModal>
  )
}
