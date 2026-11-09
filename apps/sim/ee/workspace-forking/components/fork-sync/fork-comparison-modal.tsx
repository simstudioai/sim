'use client'

import type { ForkWorkflowComparison } from '@/lib/api/contracts/workspace-fork'

/** Pins the last synced and proposed deployment identities within one source workflow. */
export interface ForkComparisonSelection {
  sourceWorkflowId: string
  comparison: Extract<ForkWorkflowComparison, { status: 'available' }>
}
