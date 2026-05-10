import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

const attioObjectSchema = idNameSchema
const attioListSchema = idNameSchema

export const attioObjectsSelectorContract = definePostSelector(
  '/api/tools/attio/objects',
  credentialWorkflowBodySchema,
  z.object({ objects: z.array(attioObjectSchema) })
)

export const attioListsSelectorContract = definePostSelector(
  '/api/tools/attio/lists',
  credentialWorkflowBodySchema,
  z.object({ lists: z.array(attioListSchema) })
)

export type AttioObjectsSelectorResponse = ContractJsonResponse<typeof attioObjectsSelectorContract>
export type AttioListsSelectorResponse = ContractJsonResponse<typeof attioListsSelectorContract>
