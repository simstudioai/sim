'use client'

import { Modal } from '@sim/emcn/modal'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { toast } from '@/lib/toast/sink'
import { RequestText } from '@/platform/embedded/app/(shell)/settings/_components/sections/requests/request-text'
import { type RequestScope, useRequestDetails } from '@/platform/embedded/lib/data/requests'

interface MyRequestModalProps {
  scope: RequestScope
  requestId: string
  onClose: () => void
}

/** A saved link to a request the viewer can no longer see opens nothing. */
export function MyRequestModal({ scope, requestId, onClose }: MyRequestModalProps) {
  const details = useRequestDetails(scope, requestId)
  if (details.missing) return null
  const { request } = details
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={request ? `${request.title} request` : 'Access request'}
      cancelLabel='Close'
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
          <RequestText label='Status'>
            <StatusTag label={request.status.label} intent={request.status.intent} /> {request.date}
          </RequestText>
          {request.reason && <RequestText label='Reason'>{request.reason}</RequestText>}
          {request.decisionReason && (
            <RequestText label='Response'>{request.decisionReason}</RequestText>
          )}
        </>
      )}
    </Modal>
  )
}
