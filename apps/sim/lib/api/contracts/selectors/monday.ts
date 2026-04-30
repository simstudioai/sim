import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

/**
 * Monday board IDs are numeric in the API (e.g. `123456789`). Clients
 * sometimes pass them as numbers and sometimes as strings, so we accept
 * `string | number` and let the route's `validateMondayNumericId` enforce
 * the actual numeric format.
 */
export const mondayGroupsBodySchema = credentialWorkflowBodySchema.extend({
  boardId: z.union([z.string().min(1), z.number()]),
})

export const mondayBoardsSelectorContract = definePostSelector(
  '/api/tools/monday/boards',
  credentialWorkflowBodySchema,
  z.object({ boards: z.array(idNameSchema) })
)

export const mondayGroupsSelectorContract = definePostSelector(
  '/api/tools/monday/groups',
  mondayGroupsBodySchema,
  z.object({ groups: z.array(idNameSchema) })
)

export type MondayBoardsSelectorResponse = ContractJsonResponse<typeof mondayBoardsSelectorContract>
export type MondayGroupsSelectorResponse = ContractJsonResponse<typeof mondayGroupsSelectorContract>
