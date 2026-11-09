'use client'

import { useState } from 'react'
import { TextAreaField } from '@sim/emcn/field'
import { DetailsField } from '@sim/emcn/field/details-field'
import { Modal } from '@sim/emcn/modal'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { toast } from '@/lib/toast/sink'
import {
  type RequestScope,
  type RequestTarget,
  useRequestAccess,
} from '@/platform/lib/data/requests'

interface RequestAccessModalProps {
  scope: RequestScope
  target: RequestTarget
  label: string
  onViewRequest: (requestId: string) => void
  onClose: () => void
}

export function RequestAccessModal({
  scope,
  target,
  label,
  onViewRequest,
  onClose,
}: RequestAccessModalProps) {
  const access = useRequestAccess(scope, target)
  const [reason, setReason] = useState('')
  const { pendingRequestId } = access
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={access.usageLimit ? 'Request a higher credit limit' : 'Request access'}
      confirmLabel={pendingRequestId ? 'View request' : 'Send request'}
      confirmDisabled={access.loading || (!pendingRequestId && !access.canRequest)}
      onConfirm={
        pendingRequestId
          ? () => onViewRequest(pendingRequestId)
          : async () => {
              toast.success(await access.send(reason))
            }
      }
    >
      <DetailsField label='Access'>{label}</DetailsField>
      {access.loadError && (
        <FailureNotice message={access.loadError.message} onRetry={access.retry} />
      )}
      {access.alreadyAllowed && <InlineNotice message='Access is already available.' />}
      {access.unavailableReason && (
        <InlineNotice intent='warning' message={access.unavailableReason} />
      )}
      {access.canRequest && (
        <TextAreaField
          label='Reason'
          optional
          placeholder='Describe what you need to do.'
          maxLength={1000}
          value={reason}
          onChange={setReason}
        />
      )}
    </Modal>
  )
}
