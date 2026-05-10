import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
  idNameSchema,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'

const airtableBaseSchema = idNameSchema
const airtableTableSchema = idNameSchema

export const airtableTablesBodySchema = credentialWorkflowBodySchema.extend({
  baseId: z.string().min(1, 'Base ID is required'),
})

export const airtableBasesSelectorContract = definePostSelector(
  '/api/tools/airtable/bases',
  credentialWorkflowBodySchema.passthrough(),
  z.object({ bases: z.array(airtableBaseSchema) })
)

export const airtableTablesSelectorContract = definePostSelector(
  '/api/tools/airtable/tables',
  airtableTablesBodySchema,
  z.object({ tables: z.array(airtableTableSchema) })
)

export type AirtableBasesSelectorResponse = ContractJsonResponse<
  typeof airtableBasesSelectorContract
>
export type AirtableTablesSelectorResponse = ContractJsonResponse<
  typeof airtableTablesSelectorContract
>
