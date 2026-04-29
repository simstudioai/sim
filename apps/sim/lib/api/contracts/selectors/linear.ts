import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

export const linearProjectsBodySchema = credentialWorkflowBodySchema.extend({
  teamId: z.string().min(1),
})

export const linearTeamsSelectorContract = definePostSelector(
  '/api/tools/linear/teams',
  credentialWorkflowBodySchema,
  z.object({ teams: z.array(idNameSchema) })
)

export const linearProjectsSelectorContract = definePostSelector(
  '/api/tools/linear/projects',
  linearProjectsBodySchema,
  z.object({ projects: z.array(idNameSchema) })
)

export type LinearTeamsSelectorResponse = ContractJsonResponse<typeof linearTeamsSelectorContract>
export type LinearProjectsSelectorResponse = ContractJsonResponse<
  typeof linearProjectsSelectorContract
>
