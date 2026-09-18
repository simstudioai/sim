'use client'

import type { AccessRequestScope } from '@/lib/api/contracts/access-requests'
import { RequestAccessAction } from '@/ee/access-requests/components/request-access-action'
import { useDiscoverAccessRequests } from '@/ee/access-requests/hooks/access-requests'

interface MemberLimitRequestActionProps {
  scope: AccessRequestScope
}

/** The server confirms a member cap is requestable; a transient rate limit never becomes a request. */
export function MemberLimitRequestAction({ scope }: MemberLimitRequestActionProps) {
  const discovery = useDiscoverAccessRequests({
    ...scope,
    targetKind: 'usage_limit',
    limit: 1,
    offset: 0,
  })
  const entry = discovery.data?.entries.find((candidate) => candidate.state === 'requestable')
  if (!discovery.isSuccess || !discovery.data.enabled || !entry) return null
  return (
    <RequestAccessAction
      scope={scope}
      target={entry.target}
      label={entry.label}
      pendingRequestId={entry.pendingRequestId}
    />
  )
}
