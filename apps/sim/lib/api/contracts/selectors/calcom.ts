import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

const calcomEventTypeSchema = z
  .object({ id: z.string(), title: z.string(), slug: z.string() })
  .passthrough()

export const calcomEventTypesSelectorContract = definePostSelector(
  '/api/tools/calcom/event-types',
  credentialWorkflowBodySchema,
  z.object({ eventTypes: z.array(calcomEventTypeSchema) })
)

export const calcomSchedulesSelectorContract = definePostSelector(
  '/api/tools/calcom/schedules',
  credentialWorkflowBodySchema,
  z.object({ schedules: z.array(idNameSchema) })
)

export type CalcomEventTypesSelectorResponse = ContractJsonResponse<
  typeof calcomEventTypesSelectorContract
>
export type CalcomSchedulesSelectorResponse = ContractJsonResponse<
  typeof calcomSchedulesSelectorContract
>
