import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

export const notionDatabasesSelectorContract = definePostSelector(
  '/api/tools/notion/databases',
  credentialWorkflowBodySchema,
  z.object({ databases: z.array(idNameSchema) })
)

export const notionPagesSelectorContract = definePostSelector(
  '/api/tools/notion/pages',
  credentialWorkflowBodySchema,
  z.object({ pages: z.array(idNameSchema) })
)

export type NotionDatabasesSelectorResponse = ContractJsonResponse<
  typeof notionDatabasesSelectorContract
>
export type NotionPagesSelectorResponse = ContractJsonResponse<typeof notionPagesSelectorContract>
