import type { AccessRequestStatus } from '@/lib/api/contracts/access-requests'

export const ACCESS_REQUEST_STATUS_LABELS = {
  pending: 'Pending',
  fulfilled: 'Fulfilled',
  declined: 'Declined',
  cancelled: 'Cancelled',
  closed: 'Closed',
} as const satisfies Record<AccessRequestStatus, string>
