'use client'

import { useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { PolicyChanges } from '@/components/access-requests/policy-changes'
import { ACCESS_REQUEST_STATUS_LABELS } from '@/components/access-requests/status'
import { useAccessRequestPreview, useResolveAccessRequest } from '@/hooks/queries/access-requests'

interface AccessRequestReviewProps {
  organizationId: string
  requestId: string
  onClose: () => void
}

export function AccessRequestReview({
  organizationId,
  requestId,
  onClose,
}: AccessRequestReviewProps) {
  const preview = useAccessRequestPreview(organizationId, requestId)
  const resolveRequest = useResolveAccessRequest()
  const [declining, setDeclining] = useState(false)
  const [decisionReason, setDecisionReason] = useState('')
  const [newLimit, setNewLimit] = useState('')
  const data = preview.isSuccess ? preview.data : undefined
  const title = data ? `${data.request.targetLabel} request` : 'Review access request'
  const parsedLimit = Number(newLimit)
  const validLimit =
    Number.isSafeInteger(parsedLimit) && parsedLimit > (data?.currentLimitCredits ?? 0)
  const pending = preview.isSuccess && data?.request.status === 'pending'
  const alreadyAvailable =
    data?.resolutionKind === 'permission' && data.canApply && data.changes.length === 0

  const apply = () => {
    if (!data || !preview.isSuccess || preview.isFetching) return
    resolveRequest.mutate(
      {
        organizationId,
        requestId,
        body: declining
          ? { action: 'decline', reason: decisionReason.trim() }
          : {
              action: 'apply',
              expectedFingerprint: data.fingerprint,
              ...(data.resolutionKind === 'usage_limit' ? { newLimitCredits: parsedLimit } : {}),
            },
      },
      {
        onSuccess: ({ request }) => {
          toast.success(
            request.status === 'fulfilled'
              ? request.target.kind === 'usage_limit'
                ? 'Credit limit increased'
                : 'Access granted'
              : `Request ${ACCESS_REQUEST_STATUS_LABELS[request.status].toLowerCase()}`
          )
          onClose()
        },
      }
    )
  }

  return (
    <ChipModal
      open
      onOpenChange={(next) => !next && onClose()}
      dismissDisabled={resolveRequest.isPending}
      size='md'
      srTitle={title}
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        {preview.isPending && (
          <p role='status' className='px-2 text-[var(--text-muted)] text-sm'>
            Loading preview...
          </p>
        )}
        {preview.isError && (
          <ChipModalField type='custom' title='Unable to load preview'>
            <p className='text-[var(--text-error)] text-sm'>{preview.error.message}</p>
            <Chip onClick={() => void preview.refetch()}>Try again</Chip>
          </ChipModalField>
        )}
        {data && (
          <>
            <div className='px-2 text-sm'>
              <p className='break-words text-[var(--text-body)]'>
                {data.request.requester.name || data.request.requester.email}
                {data.request.requester.name && (
                  <span className='text-[var(--text-muted)]'>
                    {' '}
                    · {data.request.requester.email}
                  </span>
                )}
              </p>
            </div>
            {data.request.reason && (
              <ChipModalField type='custom' title='Reason'>
                <p className='whitespace-pre-wrap break-words text-[var(--text-body)] text-sm'>
                  {data.request.reason}
                </p>
              </ChipModalField>
            )}
            {(data.request.status === 'pending' || data.request.status === 'fulfilled') &&
              data.resolutionKind === 'permission' && (
                <>
                  {data.changes.length > 0 && (
                    <ChipModalField type='custom' title='Permission group'>
                      <p className='break-words text-[var(--text-body)] text-sm'>
                        {data.group?.name ?? 'No longer available'}
                      </p>
                    </ChipModalField>
                  )}
                  {pending && alreadyAvailable && (
                    <ChipModalField type='custom' title='Current access'>
                      <p className='text-[var(--text-body)] text-sm'>
                        This access is already available.
                      </p>
                    </ChipModalField>
                  )}
                  {data.changes.length > 0 && (
                    <PolicyChanges
                      changes={data.changes}
                      impact={data.impact}
                      target={data.request.target}
                      targetLabel={data.request.targetLabel}
                    />
                  )}
                </>
              )}
            {(data.request.status === 'pending' || data.request.status === 'fulfilled') &&
              data.resolutionKind === 'usage_limit' && (
                <>
                  <ChipModalField
                    type='custom'
                    title={
                      data.request.status === 'fulfilled'
                        ? 'Previous member credit limit'
                        : 'Current member credit limit'
                    }
                  >
                    <p className='text-[var(--text-body)] text-sm'>
                      {data.currentLimitCredits ?? 'No member limit'}
                    </p>
                  </ChipModalField>
                  {data.request.status === 'fulfilled' && data.newLimitCredits !== null && (
                    <ChipModalField type='custom' title='New member credit limit'>
                      <p className='text-[var(--text-body)] text-sm'>{data.newLimitCredits}</p>
                    </ChipModalField>
                  )}
                  {pending && !declining && (
                    <ChipModalField
                      type='input'
                      title='New member credit limit'
                      inputMode='numeric'
                      value={newLimit}
                      onChange={setNewLimit}
                      required
                      hint='Enter a whole number above the current limit.'
                    />
                  )}
                </>
              )}
            {pending && data.unavailableReason && (
              <ChipModalField type='custom' title='Current status'>
                <p className='text-[var(--text-muted)] text-sm'>{data.unavailableReason}</p>
              </ChipModalField>
            )}
            {data.request.status !== 'pending' && (
              <ChipModalField type='custom' title='Decision'>
                <p className='whitespace-pre-wrap break-words text-[var(--text-body)] text-sm'>
                  {ACCESS_REQUEST_STATUS_LABELS[data.request.status]}
                  {data.request.decisionReason ? `: ${data.request.decisionReason}` : ''}
                </p>
              </ChipModalField>
            )}
            {pending && declining && (
              <ChipModalField
                type='textarea'
                title='Reason for declining'
                value={decisionReason}
                onChange={setDecisionReason}
                maxLength={1000}
                rows={3}
                required
              />
            )}
          </>
        )}
        <ChipModalError>{resolveRequest.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        hideCancel={pending}
        cancelLabel='Close'
        defaultAction='none'
        secondaryActions={
          pending
            ? [
                {
                  label: declining ? 'Back' : 'Decline',
                  onClick: () => setDeclining(!declining),
                  disabled: resolveRequest.isPending,
                },
              ]
            : undefined
        }
        primaryAction={
          pending
            ? {
                label: resolveRequest.isPending
                  ? 'Saving...'
                  : declining
                    ? 'Decline request'
                    : data?.resolutionKind === 'usage_limit'
                      ? 'Increase limit'
                      : alreadyAvailable
                        ? 'Mark fulfilled'
                        : 'Apply group change',
                onClick: apply,
                disabled:
                  resolveRequest.isPending ||
                  preview.isFetching ||
                  (declining
                    ? !decisionReason.trim()
                    : !data?.canApply || (data.resolutionKind === 'usage_limit' && !validLimit)),
              }
            : undefined
        }
      />
    </ChipModal>
  )
}
