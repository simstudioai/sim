'use client'

import { useState } from 'react'
import {
  Chip,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  type ChipProps,
  toast,
} from '@sim/emcn'
import { Lock } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import type { AccessRequestScope, AccessRequestTarget } from '@/lib/api/contracts/access-requests'
import { getAccessRequestTargetKey } from '@/lib/permission-groups/access-requests/targets'
import { useCreateAccessRequest, useDiscoverAccessRequests } from '@/hooks/queries/access-requests'

interface RequestAccessActionProps {
  scope: AccessRequestScope
  target: AccessRequestTarget
  label: string
  pendingRequestId?: string | null
  onViewRequest?: (requestId: string) => void
  variant?: ChipProps['variant']
}

function accessRequestHref(scope: AccessRequestScope, requestId: string): string {
  const params = new URLSearchParams({ requestId })
  if (scope.kind === 'organization') params.set('organizationId', scope.organizationId)
  const pathname =
    scope.kind === 'workspace'
      ? `/workspace/${encodeURIComponent(scope.workspaceId)}/access-requests`
      : '/access-requests'
  return `${pathname}?${params}`
}

export function RequestAccessAction({
  scope,
  target,
  label,
  pendingRequestId,
  onViewRequest,
  variant,
}: RequestAccessActionProps) {
  if (pendingRequestId) {
    if (onViewRequest) {
      return (
        <Chip
          variant={variant}
          leftIcon={Lock}
          onClick={() => onViewRequest(pendingRequestId)}
          aria-label={`View request for ${label}`}
        >
          View request
        </Chip>
      )
    }
    return (
      <ChipLink
        variant={variant}
        href={accessRequestHref(scope, pendingRequestId)}
        leftIcon={Lock}
        aria-label={`View request for ${label}`}
      >
        View request
      </ChipLink>
    )
  }

  return (
    <RequestableAccessAction
      key={JSON.stringify([scope, target])}
      scope={scope}
      target={target}
      label={label}
      onViewRequest={onViewRequest}
      variant={variant}
    />
  )
}

function RequestableAccessAction({
  scope,
  target,
  label,
  variant,
  onViewRequest,
}: RequestAccessActionProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Chip
        variant={variant}
        leftIcon={Lock}
        onClick={() => setOpen(true)}
        aria-label={
          target.kind === 'usage_limit'
            ? 'Request a higher credit limit'
            : `Request access to ${label}`
        }
      >
        {target.kind === 'usage_limit' ? 'Request increase' : 'Request access'}
      </Chip>
      {open && (
        <RequestAccessModal
          scope={scope}
          target={target}
          label={label}
          onViewRequest={onViewRequest}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

interface RequestAccessModalProps
  extends Pick<RequestAccessActionProps, 'scope' | 'target' | 'label' | 'onViewRequest'> {
  onClose: () => void
}

export function RequestAccessModal({
  scope,
  target,
  label,
  onViewRequest,
  onClose,
}: RequestAccessModalProps) {
  const router = useRouter()
  const discovery = useDiscoverAccessRequests({
    ...scope,
    targetKind: target.kind,
    targetKey: getAccessRequestTargetKey(target),
    limit: 1,
    offset: 0,
  })
  const [reason, setReason] = useState('')
  const createRequest = useCreateAccessRequest()
  const usageLimitRequest = target.kind === 'usage_limit'
  const title = usageLimitRequest ? 'Request a higher credit limit' : 'Request access'
  const entry = discovery.isSuccess ? discovery.data.entries[0] : undefined
  const pendingRequestId = entry?.pendingRequestId
  const canRequest = discovery.data?.enabled && entry?.state === 'requestable' && !pendingRequestId
  const alreadyAllowed = entry?.state === 'allowed'
  const unavailableReason =
    discovery.isSuccess && !pendingRequestId && !canRequest && !alreadyAllowed
      ? (entry?.reason ?? 'Access requests are unavailable.')
      : null

  const submit = () => {
    if (!canRequest || createRequest.isPending) return
    createRequest.mutate(
      { scope, target, reason: reason.trim() },
      {
        onSuccess: ({ request }) => {
          toast.success(
            request.status === 'closed'
              ? (request.decisionReason ?? 'Access is already available.')
              : usageLimitRequest
                ? 'Credit limit increase requested.'
                : 'Access requested.'
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
      dismissDisabled={createRequest.isPending}
      size='sm'
      srTitle={title}
    >
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Access'>
          <p className='break-words text-[var(--text-body)] text-sm'>{label}</p>
        </ChipModalField>
        {alreadyAllowed && (
          <ChipModalDescription>Access is already available.</ChipModalDescription>
        )}
        {canRequest && (
          <ChipModalField
            type='textarea'
            title='Reason (optional)'
            value={reason}
            onChange={setReason}
            maxLength={1000}
            rows={3}
            placeholder='Describe what you need to do.'
          />
        )}
        <ChipModalError>
          {discovery.error?.message ?? unavailableReason ?? createRequest.error?.message}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: discovery.isPending
            ? 'Loading...'
            : discovery.isError
              ? 'Retry'
              : pendingRequestId
                ? 'View request'
                : createRequest.isPending
                  ? 'Sending...'
                  : 'Send request',
          onClick: discovery.isError
            ? () => {
                void discovery.refetch()
              }
            : pendingRequestId
              ? () => {
                  if (onViewRequest) onViewRequest(pendingRequestId)
                  else router.push(accessRequestHref(scope, pendingRequestId))
                  onClose()
                }
              : submit,
          disabled:
            createRequest.isPending ||
            discovery.isPending ||
            (!discovery.isError && !pendingRequestId && !canRequest),
        }}
      />
    </ChipModal>
  )
}
