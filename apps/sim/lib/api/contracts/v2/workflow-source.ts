import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import { v2WorkflowIdParamsSchema } from '@/lib/api/contracts/v2/workflows'
import {
  workflowSourceQuerySchema,
  workflowSourceSchema,
} from '@/lib/api/contracts/workflow-source'

/** `GET /api/v2/workflows/{workflowId}/source`: the internal Code tab read, for API callers. */
export const v2GetWorkflowSourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/workflows/[workflowId]/source',
  params: v2WorkflowIdParamsSchema,
  query: workflowSourceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(workflowSourceSchema) },
})
