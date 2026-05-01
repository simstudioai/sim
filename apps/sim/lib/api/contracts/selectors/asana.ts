import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

const asanaWorkspaceSchema = idNameSchema

export const asanaWorkspacesSelectorContract = definePostSelector(
  '/api/tools/asana/workspaces',
  credentialWorkflowBodySchema,
  z.object({ workspaces: z.array(asanaWorkspaceSchema) })
)

export type AsanaWorkspacesSelectorResponse = ContractJsonResponse<
  typeof asanaWorkspacesSelectorContract
>
