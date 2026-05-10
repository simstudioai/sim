import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

export const pipedrivePipelinesSelectorContract = definePostSelector(
  '/api/tools/pipedrive/pipelines',
  credentialWorkflowBodySchema,
  z.object({ pipelines: z.array(idNameSchema) })
)

export type PipedrivePipelinesSelectorResponse = ContractJsonResponse<
  typeof pipedrivePipelinesSelectorContract
>
