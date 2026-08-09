import { z } from 'zod'
import {
  credentialWorkflowBodySchema,
  definePostSelector,
} from '@/lib/api/contracts/selectors/shared'
import type { ContractBodyInput, ContractJsonResponse } from '@/lib/api/contracts/types'
import { SNOWFLAKE_SELECTOR_KINDS } from '@/tools/snowflake/selector-kinds'

/**
 * One route backs every Snowflake picker: each `kind` maps to a metadata-only
 * `SHOW` statement over the same SQL API endpoint and the same credential, so
 * splitting them into nine routes would duplicate the credential resolution
 * and statement transport nine times.
 */
export const snowflakeObjectsBodySchema = credentialWorkflowBodySchema
  .extend({
    kind: z.enum(SNOWFLAKE_SELECTOR_KINDS),
    database: z.string().min(1, 'database cannot be empty').max(255).optional(),
    schema: z.string().min(1, 'schema cannot be empty').max(255).optional(),
  })
  .superRefine((value, ctx) => {
    const needsDatabase =
      value.kind !== 'databases' && value.kind !== 'warehouses' && value.kind !== 'roles'
    const needsSchema = needsDatabase && value.kind !== 'schemas'
    if (needsDatabase && !value.database?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['database'],
        message: `database is required to list ${value.kind}`,
      })
    }
    if (needsSchema && !value.schema?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema'],
        message: `schema is required to list ${value.kind}`,
      })
    }
  })

const snowflakeObjectSchema = z.object({
  /** Snowflake object name, exactly as Snowflake stores it. */
  name: z.string().min(1),
  /** Kind-specific secondary column (state, type, comment, or signature). */
  detail: z.string().nullable(),
})

export const snowflakeObjectsSelectorContract = definePostSelector(
  '/api/tools/snowflake/objects',
  snowflakeObjectsBodySchema,
  z.object({ objects: z.array(snowflakeObjectSchema) })
)

export type SnowflakeObjectsSelectorBody = ContractBodyInput<
  typeof snowflakeObjectsSelectorContract
>
export type SnowflakeObjectsSelectorResponse = ContractJsonResponse<
  typeof snowflakeObjectsSelectorContract
>
