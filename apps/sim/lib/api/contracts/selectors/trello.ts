import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

const trelloBoardSchema = z
  .object({ id: z.string(), name: z.string(), closed: z.boolean().optional() })
  .passthrough()

export const trelloBoardsSelectorContract = definePostSelector(
  '/api/tools/trello/boards',
  credentialWorkflowBodySchema,
  z.object({ boards: z.array(trelloBoardSchema) })
)

export type TrelloBoardsSelectorResponse = ContractJsonResponse<typeof trelloBoardsSelectorContract>
