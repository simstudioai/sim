import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

/**
 * Zoho Desk scopes every call except `GET /organizations` to a single portal via
 * the `orgId` header, so every downstream selector must carry the organization
 * the user picked.
 */
const zohoDeskOrgIdSchema = z.string().min(1, 'orgId is required')

export const zohoDeskOrganizationsSelectorContract = definePostSelector(
  '/api/tools/zoho_desk/organizations',
  credentialWorkflowBodySchema,
  z.object({ organizations: z.array(idNameSchema) })
)

export const zohoDeskDepartmentsSelectorContract = definePostSelector(
  '/api/tools/zoho_desk/departments',
  credentialWorkflowBodySchema.extend({ orgId: zohoDeskOrgIdSchema }),
  z.object({ departments: z.array(idNameSchema) })
)

export const zohoDeskAgentsSelectorContract = definePostSelector(
  '/api/tools/zoho_desk/agents',
  credentialWorkflowBodySchema.extend({ orgId: zohoDeskOrgIdSchema }),
  z.object({ agents: z.array(idNameSchema) })
)

export type ZohoDeskOrganizationsSelectorResponse = ContractJsonResponse<
  typeof zohoDeskOrganizationsSelectorContract
>
export type ZohoDeskDepartmentsSelectorResponse = ContractJsonResponse<
  typeof zohoDeskDepartmentsSelectorContract
>
export type ZohoDeskAgentsSelectorResponse = ContractJsonResponse<
  typeof zohoDeskAgentsSelectorContract
>
