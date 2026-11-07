'use client'

import { DetailsField } from '@sim/emcn/field/details-field'
import { Modal } from '@sim/emcn/modal'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { type RequestScope, useRequestDetails } from '@/platform/lib/data/requests'
import { toast } from '@/platform/lib/data/toast'

interface MyRequestModalProps {
  scope: RequestScope
  requestId: string
  onClose: () => void
}

/** A saved link to a request the viewer can no longer see opens nothing, as on the legacy surface. */
export function MyRequestModal({ scope, requestId, onClose }: MyRequestModalProps) {
  const details = useRequestDetails(scope, requestId)
  if (details.missing) return null
  const { request } = details
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={request ? `${request.title} request` : 'Access request'}
      confirmLabel={request?.pending ? 'Withdraw request' : 'Done'}
      destructive={request?.pending}
      confirmDisabled={request?.pending ? details.fetching : false}
      onConfirm={
        request?.pending
          ? async () => {
              toast.success(await details.cancel())
            }
          : undefined
      }
    >
      {details.loading && (
        <p role='status' data-type='T060'>
          Loading request…
        </p>
      )}
      {details.error && (
        <FailureNotice
          title='Unable to load request'
          message={details.error.message}
          onRetry={details.retry}
        />
      )}
      {request && (
        <>
          <DetailsField label='Status'>
            <StatusTag label={request.status.label} intent={request.status.intent} /> {request.date}
          </DetailsField>
          {request.reason && <DetailsField label='Reason'>{request.reason}</DetailsField>}
          {request.decisionReason && (
            <DetailsField label='Response'>{request.decisionReason}</DetailsField>
          )}
        </>
      )}
    </Modal>
  )
}
