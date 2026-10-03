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
import { useInviteOrganizationAccountPeople } from '@/hooks/queries/organization-accounts'

interface OrganizationAccountInviteModalProps {
  organizationId: string
  searchConnection?: { optionId: string; providerName: string }
  onClose: () => void
}

function validateEmail(email: string): string | null {
  const result = quickValidateEmail(email)
  return result.isValid ? null : (result.reason ?? 'Invalid email')
}

export function OrganizationAccountInviteModal({
  organizationId,
  searchConnection,
  onClose,
}: OrganizationAccountInviteModalProps) {
  const invite = useInviteOrganizationAccountPeople()
  const [emails, setEmails] = useState<string[]>([])
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const canSubmit = emails.length > 0 && !invite.isPending

  const handleEmailsChange = useCallback((next: string[]) => {
    setEmails(next)
    setDeliveryError(null)
  }, [])

  const handleOpenChange = (nextOpen: boolean) => {
    if (invite.isPending) return
    if (!nextOpen) onClose()
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
        organizationId,
        emails,
        ...(searchConnection ? { optionId: searchConnection.optionId } : {}),
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
      open
      onOpenChange={handleOpenChange}
      srTitle={
        searchConnection
          ? `Request ${searchConnection.providerName} connections`
          : 'Request account connections'
      }
      dismissDisabled={invite.isPending}
    >
      <ChipModalHeader onClose={() => handleOpenChange(false)}>
        {searchConnection
          ? `Request ${searchConnection.providerName} connections`
          : 'Request account connections'}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='emails'
          title='Emails'
          value={emails}
          onChange={handleEmailsChange}
          validate={validateEmail}
          placeholder='Enter emails'
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
