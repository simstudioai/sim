'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ImportWorkflowAsSuperuserBody,
  type ImportWorkflowAsSuperuserResponse,
  importWorkflowAsSuperuserContract,
} from '@/lib/api/contracts/workflows'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'

/**
 * Copies a workflow and its copilot chats into a target workspace as a superuser. Kept apart from
 * the workflow list hooks so the admin console does not bundle the workflow stores.
 */
export function useImportWorkflow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workflowId,
      targetWorkspaceId,
    }: ImportWorkflowAsSuperuserBody): Promise<ImportWorkflowAsSuperuserResponse> => {
      return requestJson(importWorkflowAsSuperuserContract, {
        body: { workflowId, targetWorkspaceId },
      })
    },
    onSettled: (_data, _error, variables) => {
      return invalidateWorkflowLists(queryClient, variables.targetWorkspaceId)
    },
  })
}
