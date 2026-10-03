import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import type { AccessRequestDecision } from '@/ee/access-requests/lib/schemas'
import type { AccessRequestScope, AccessRequestTarget } from '@/ee/access-requests/lib/targets'

export type AccessRequestStatus = 'pending' | 'fulfilled' | 'declined' | 'cancelled' | 'closed'

export interface AccessRequestSettings {
  allowRequests: boolean
}

export interface AccessRequestRecord {
  id: string
  organizationId: string
  workspaceId: string | null
  target: AccessRequestTarget
  targetLabel: string
  reason: string
  status: AccessRequestStatus
  decisionReason: string | null
  createdAt: string
  decidedAt: string | null
  groupName: string | null
  requester: { id: string; name: string | null; email: string }
}

export interface AccessRequestPaging {
  sortBy: 'createdAt' | 'targetLabel'
  sortOrder: ListSortOrder
  cursorKeys?: CursorKey[]
}

export interface AccessRequestList {
  requests: AccessRequestRecord[]
  nextCursorKeys?: CursorKey[] | null
  total: number
  hasMore: boolean
}

export interface CreateAccessRequestInput {
  scope: AccessRequestScope
  target: AccessRequestTarget
  reason?: string
}

export type DiscoverAccessRequestsInput = AccessRequestScope & {
  limit: number
  offset: number
  search?: string
  sortOrder?: ListSortOrder
  targetKind?: AccessRequestTarget['kind']
  targetKey?: string
  state?: 'allowed' | 'requestable' | 'unavailable'
}

export interface AccessRequestDiscovery {
  enabled: boolean
  organizationId: string | null
  entries: {
    target: AccessRequestTarget
    label: string
    state: 'allowed' | 'requestable' | 'unavailable'
    reason: string | null
    pendingRequestId: string | null
  }[]
  total: number
  hasMore: boolean
}

export type ResolveAccessRequestDecision =
  | { action: 'apply'; expectedFingerprint: string; newLimitCredits?: number }
  | { action: 'decline'; reason: string }

export type AccessRequestImpact = AccessRequestDecision['impact']

export type AccessRequestPreview = Omit<
  AccessRequestDecision,
  'resolutionKind' | 'group' | 'currentLimitCredits'
> & {
  request: AccessRequestRecord
  canApply: boolean
  unavailableReason: string | null
} & (
    | {
        resolutionKind: 'permission'
        group: AccessRequestDecision['group']
        currentLimitCredits: null
      }
    | { resolutionKind: 'usage_limit'; group: null; currentLimitCredits: number | null }
  )
