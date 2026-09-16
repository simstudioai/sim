'use client'

import { useState } from 'react'
import {
  Chip,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { Lock } from '@sim/emcn/icons'
import type { AccessRequestScope, AccessRequestTarget } from '@/lib/api/contracts/access-requests'
import { useCreateAccessRequest } from '@/hooks/queries/access-requests'

interface RequestAccessActionProps {
  scope: AccessRequestScope
  target: AccessRequestTarget
  label: string
  pendingRequestId?: string | null
  onViewRequest?: (requestId: string) => void
}

export function RequestAccessAction({
  scope,
  target,
  label,
  pendingRequestId,
  onViewRequest,
}: RequestAccessActionProps) {
  if (pendingRequestId) {
    if (onViewRequest) {
      return (
        <Chip
          leftIcon={Lock}
          onClick={() => onViewRequest(pendingRequestId)}
          aria-label={`View request for ${label}`}
        >
          View request
        </Chip>
      )
    }
    const params = new URLSearchParams({ requestId: pendingRequestId })
    if (scope.kind === 'organization') params.set('organizationId', scope.organizationId)
    const pathname =
      scope.kind === 'workspace'
        ? `/workspace/${encodeURIComponent(scope.workspaceId)}/access-requests`
        : '/access-requests'
    return (
      <ChipLink
        href={`${pathname}?${params}`}
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
    />
  )
}

function RequestableAccessAction({ scope, target, label }: RequestAccessActionProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Chip
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
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

interface RequestAccessModalProps extends Omit<RequestAccessActionProps, 'pendingRequestId'> {
  onClose: () => void
}

export function RequestAccessModal({ scope, target, label, onClose }: RequestAccessModalProps) {
  const [reason, setReason] = useState('')
  const createRequest = useCreateAccessRequest()
  const usageLimitRequest = target.kind === 'usage_limit'
  const title = usageLimitRequest ? 'Request a higher credit limit' : 'Request access'

  const submit = () => {
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
          <p className='text-[var(--text-body)] text-sm'>{label}</p>
        </ChipModalField>
        <ChipModalField
          type='textarea'
          title='Reason (optional)'
          value={reason}
          onChange={setReason}
          maxLength={1000}
          rows={3}
          placeholder='Describe what you need to do.'
        />
        <ChipModalError>{createRequest.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: createRequest.isPending ? 'Sending...' : 'Send request',
          onClick: submit,
          disabled: createRequest.isPending,
        }}
      />
    </ChipModal>
  )
}
