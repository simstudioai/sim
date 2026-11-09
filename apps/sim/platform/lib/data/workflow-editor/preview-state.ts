'use client'

import { isApiClientError } from '@/lib/api/client/errors'
import { useWorkflowState } from '@/hooks/queries/workflows'
import { queryRead } from '@/platform/shared/workspace-records'

/**
 * A workflow's current state for its read-only canvas, refreshed as the chat's edits invalidate
 * it. A workflow that no longer exists reads as missing rather than failed.
 */
export function useWorkflowPreviewState(workflowId: string) {
  const query = useWorkflowState(workflowId)
  return {
    state: query.data,
    missing: isApiClientError(query.error) && query.error.status === 404,
    read: queryRead(query, 'This workflow could not be loaded.'),
  }
}
