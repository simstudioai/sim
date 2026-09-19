'use client'

import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTag,
  toast,
} from '@sim/emcn'
import type { AccessRequestScope } from '@/lib/api/contracts/access-requests'
import { ACCESS_REQUEST_STATUS_LABELS } from '@/ee/access-requests/components/status'
import {
  useCancelAccessRequest,
  useMyAccessRequests,
} from '@/ee/access-requests/hooks/access-requests'

interface MyAccessRequestDetailsProps {
  scope: AccessRequestScope
  requestId: string
  onClose: () => void
}

export function MyAccessRequestDetails({ scope, requestId, onClose }: MyAccessRequestDetailsProps) {
  const details = useMyAccessRequests(scope, 0, requestId)
  const cancelRequest = useCancelAccessRequest()
  const request = details.isSuccess ? details.data.requests[0] : undefined
  const title = request ? `${request.targetLabel} request` : 'Access request'

  return (
    <ChipModal
      open
      onOpenChange={(next) => !next && onClose()}
      dismissDisabled={cancelRequest.isPending}
      size='sm'
      srTitle={title}
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        {details.isPending && (
          <p role='status' className='px-2 text-[var(--text-muted)] text-sm'>
            Loading request...
          </p>
        )}
        {details.isError && (
          <ChipModalField type='custom' title='Unable to load request'>
            <p className='text-[var(--text-error)] text-sm'>{details.error.message}</p>
            <Chip onClick={() => void details.refetch()}>Try again</Chip>
          </ChipModalField>
        )}
        {details.isSuccess && !request && (
          <p className='px-2 text-[var(--text-muted)] text-sm'>
            This request is no longer available.
          </p>
        )}
        {request && (
          <>
            <div className='flex flex-wrap items-center gap-2 px-2'>
              <ChipTag variant='gray'>{ACCESS_REQUEST_STATUS_LABELS[request.status]}</ChipTag>
              <span className='text-[var(--text-muted)] text-caption'>
                {new Date(request.createdAt).toLocaleDateString()}
              </span>
            </div>
            {request.reason && (
              <ChipModalField type='custom' title='Reason'>
                <p className='whitespace-pre-wrap break-words text-[var(--text-body)] text-sm'>
                  {request.reason}
                </p>
              </ChipModalField>
            )}
            {request.decisionReason && (
              <ChipModalField type='custom' title='Response'>
                <p className='whitespace-pre-wrap break-words text-[var(--text-body)] text-sm'>
                  {request.decisionReason}
                </p>
              </ChipModalField>
            )}
          </>
        )}
        <ChipModalError>{cancelRequest.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        cancelLabel='Close'
        defaultAction='none'
        secondaryActions={
          request?.status === 'pending'
            ? [
                {
                  label: cancelRequest.isPending ? 'Cancelling...' : 'Cancel request',
                  disabled: cancelRequest.isPending || details.isFetching,
                  onClick: () =>
                    cancelRequest.mutate(
                      { scope, requestId },
                      {
                        onSuccess: ({ request }) => {
                          toast.success(
                            `Request ${ACCESS_REQUEST_STATUS_LABELS[request.status].toLowerCase()}`
                          )
                          onClose()
                        },
                      }
                    ),
                },
              ]
            : undefined
        }
      />
    </ChipModal>
  )
}
