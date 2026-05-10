import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

const linearProjectsBodySchema = credentialWorkflowBodySchema.extend({
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

type LinearTeamsSelectorResponse = ContractJsonResponse<typeof linearTeamsSelectorContract>
type LinearProjectsSelectorResponse = ContractJsonResponse<typeof linearProjectsSelectorContract>
