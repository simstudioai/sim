import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

export const zoomMeetingsSelectorContract = definePostSelector(
  '/api/tools/zoom/meetings',
  credentialWorkflowBodySchema,
  z.object({ meetings: z.array(idNameSchema) })
)

export type ZoomMeetingsSelectorResponse = ContractJsonResponse<typeof zoomMeetingsSelectorContract>
