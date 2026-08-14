import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

/**
 * Optional string inputs arrive as `null` when a block leaves the field blank,
 * which a bare `z.string().optional()` rejects with "expected string, received
 * null" before any request is made. Normalizing null to undefined keeps those
 * fields genuinely optional.
 */
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)

const agiloftFileOutputSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  data: z.string(),
  size: z.number(),
})

export const agiloftRetrieveResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    file: agiloftFileOutputSchema,
  }),
})

export const agiloftAttachResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    recordId: z.string(),
    fieldName: z.string(),
    fileName: z.string(),
    totalAttachments: z.number(),
  }),
})

export const agiloftRetrieveBodySchema = z.object({
  instanceUrl: z.string().min(1, 'Instance URL is required'),
  knowledgeBase: z.string().min(1, 'Knowledge base is required'),
  login: z.string().min(1, 'Login is required'),
  password: z.string().min(1, 'Password is required'),
  table: z.string().min(1, 'Table is required'),
  recordId: z.string().min(1, 'Record ID is required'),
  fieldName: z.string().min(1, 'Field name is required'),
  position: z.string().min(1, 'Position is required'),
})

export const agiloftAttachBodySchema = z.object({
  instanceUrl: z.string().min(1, 'Instance URL is required'),
  knowledgeBase: z.string().min(1, 'Knowledge base is required'),
  login: z.string().min(1, 'Login is required'),
  password: z.string().min(1, 'Password is required'),
  table: z.string().min(1, 'Table is required'),
  recordId: z.string().min(1, 'Record ID is required'),
  fieldName: z.string().min(1, 'Field name is required'),
  file: FileInputSchema.optional(),
  fileName: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  overwrite: z
    .boolean()
    .nullish()
    .transform((value) => value ?? undefined),
})

export const agiloftRetrieveContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/retrieve',
  body: agiloftRetrieveBodySchema,
  response: { mode: 'json', schema: agiloftRetrieveResponseSchema },
})

export const agiloftAttachContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/attach',
  body: agiloftAttachBodySchema,
  response: { mode: 'json', schema: agiloftAttachResponseSchema },
})

export type AgiloftRetrieveBody = ContractBody<typeof agiloftRetrieveContract>
export type AgiloftRetrieveBodyInput = ContractBodyInput<typeof agiloftRetrieveContract>
export type AgiloftRetrieveResponse = ContractJsonResponse<typeof agiloftRetrieveContract>
export type AgiloftAttachBody = ContractBody<typeof agiloftAttachContract>
export type AgiloftAttachBodyInput = ContractBodyInput<typeof agiloftAttachContract>
export type AgiloftAttachResponse = ContractJsonResponse<typeof agiloftAttachContract>

const agiloftBaseFields = {
  instanceUrl: z.string().min(1, 'Instance URL is required'),
  knowledgeBase: z.string().min(1, 'Knowledge base is required'),
  login: z.string().min(1, 'Login is required'),
  password: z.string().min(1, 'Password is required'),
  table: z.string().min(1, 'Table is required'),
} as const

export const agiloftCreateRecordBodySchema = z.object({
  ...agiloftBaseFields,
  data: z.string().min(1, 'Data is required'),
})

export const agiloftCreateRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      id: z.string().nullable(),
      fields: z.record(z.string(), z.unknown()),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftCreateRecordContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/create_record',
  body: agiloftCreateRecordBodySchema,
  response: { mode: 'json', schema: agiloftCreateRecordResponseSchema },
})

export type AgiloftCreateRecordBody = ContractBody<typeof agiloftCreateRecordContract>
export type AgiloftCreateRecordBodyInput = ContractBodyInput<typeof agiloftCreateRecordContract>
export type AgiloftCreateRecordResponse = ContractJsonResponse<typeof agiloftCreateRecordContract>

export const agiloftReadRecordBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
  fields: optionalText,
})

export const agiloftReadRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      id: z.string().nullable(),
      fields: z.record(z.string(), z.unknown()),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftReadRecordContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/read_record',
  body: agiloftReadRecordBodySchema,
  response: { mode: 'json', schema: agiloftReadRecordResponseSchema },
})

export type AgiloftReadRecordBody = ContractBody<typeof agiloftReadRecordContract>
export type AgiloftReadRecordBodyInput = ContractBodyInput<typeof agiloftReadRecordContract>
export type AgiloftReadRecordResponse = ContractJsonResponse<typeof agiloftReadRecordContract>

export const agiloftUpdateRecordBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
  data: z.string().min(1, 'Data is required'),
})

export const agiloftUpdateRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      id: z.string().nullable(),
      fields: z.record(z.string(), z.unknown()),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftUpdateRecordContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/update_record',
  body: agiloftUpdateRecordBodySchema,
  response: { mode: 'json', schema: agiloftUpdateRecordResponseSchema },
})

export type AgiloftUpdateRecordBody = ContractBody<typeof agiloftUpdateRecordContract>
export type AgiloftUpdateRecordBodyInput = ContractBodyInput<typeof agiloftUpdateRecordContract>
export type AgiloftUpdateRecordResponse = ContractJsonResponse<typeof agiloftUpdateRecordContract>

/** EWDelete requires a delete rule naming how dependent records are handled. */
export const agiloftDeleteRecordBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
  deleteRule: z
    .enum([
      'ERROR_IF_DEPENDANTS',
      'APPLY_DELETE_WHERE_POSSIBLE',
      'DELETE_WHERE_POSSIBLE_OTHERWISE_UNLINK',
      'APPLY_UNLINK',
      'UNLINK_WHERE_POSSIBLE_OTHERWISE_DELETE',
      'REPLACE_WITH_ANOTHER',
    ])
    .nullish()
    .transform((value) => value ?? 'ERROR_IF_DEPENDANTS'),
  substituteIds: optionalText,
})

export const agiloftDeleteRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      id: z.string(),
      deleted: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftDeleteRecordContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/delete_record',
  body: agiloftDeleteRecordBodySchema,
  response: { mode: 'json', schema: agiloftDeleteRecordResponseSchema },
})

export type AgiloftDeleteRecordBody = ContractBody<typeof agiloftDeleteRecordContract>
export type AgiloftDeleteRecordBodyInput = ContractBodyInput<typeof agiloftDeleteRecordContract>
export type AgiloftDeleteRecordResponse = ContractJsonResponse<typeof agiloftDeleteRecordContract>

export const agiloftLockRecordBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
  lockAction: z.enum(['lock', 'unlock', 'check'], {
    message: 'Lock action must be "lock", "unlock", or "check"',
  }),
  force: z
    .boolean()
    .nullish()
    .transform((value) => value ?? undefined),
})

export const agiloftLockRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      id: z.string(),
      tableId: z.number().nullable(),
      /** Documented values are LOCKED and NO_LOCK; empty on a failed call. */
      lockStatus: z.string(),
      lockedBy: z.string().nullable(),
      lockExpiresInMinutes: z.number().nullable(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftLockRecordContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/lock_record',
  body: agiloftLockRecordBodySchema,
  response: { mode: 'json', schema: agiloftLockRecordResponseSchema },
})

export type AgiloftLockRecordBody = ContractBody<typeof agiloftLockRecordContract>
export type AgiloftLockRecordBodyInput = ContractBodyInput<typeof agiloftLockRecordContract>
export type AgiloftLockRecordResponse = ContractJsonResponse<typeof agiloftLockRecordContract>

/**
 * Search accepts a saved-search label (`search`), an ad hoc `query`, or both.
 * At least one must be present, otherwise the call degenerates into an
 * unbounded scan of the whole table.
 */
export const agiloftSearchRecordsBodySchema = z
  .object({
    ...agiloftBaseFields,
    query: optionalText,
    search: optionalText,
    fields: optionalText,
    page: optionalText,
    limit: optionalText,
  })
  .superRefine((value, ctx) => {
    if (!value.query?.trim() && !value.search?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Provide a search query or a saved search name',
      })
    }
  })

export const agiloftSearchRecordsResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      records: z.array(z.record(z.string(), z.unknown())),
      totalCount: z.number(),
      page: z.number(),
      limit: z.number(),
      truncated: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftSearchRecordsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/search_records',
  body: agiloftSearchRecordsBodySchema,
  response: { mode: 'json', schema: agiloftSearchRecordsResponseSchema },
})

export type AgiloftSearchRecordsBody = ContractBody<typeof agiloftSearchRecordsContract>
export type AgiloftSearchRecordsBodyInput = ContractBodyInput<typeof agiloftSearchRecordsContract>
export type AgiloftSearchRecordsResponse = ContractJsonResponse<typeof agiloftSearchRecordsContract>

export const agiloftSelectRecordsBodySchema = z.object({
  ...agiloftBaseFields,
  where: z.string().min(1, 'Where clause is required'),
})

export const agiloftSelectRecordsResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      recordIds: z.array(z.string()),
      totalCount: z.number(),
      truncated: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftSelectRecordsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/select_records',
  body: agiloftSelectRecordsBodySchema,
  response: { mode: 'json', schema: agiloftSelectRecordsResponseSchema },
})

export type AgiloftSelectRecordsBody = ContractBody<typeof agiloftSelectRecordsContract>
export type AgiloftSelectRecordsBodyInput = ContractBodyInput<typeof agiloftSelectRecordsContract>
export type AgiloftSelectRecordsResponse = ContractJsonResponse<typeof agiloftSelectRecordsContract>

export const agiloftAttachmentInfoBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
  fieldName: z.string().min(1, 'Field name is required'),
})

export const agiloftAttachmentInfoResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      attachments: z.array(
        z.object({
          position: z.number(),
          name: z.string(),
          size: z.number(),
        })
      ),
      totalCount: z.number(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftAttachmentInfoContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/attachment_info',
  body: agiloftAttachmentInfoBodySchema,
  response: { mode: 'json', schema: agiloftAttachmentInfoResponseSchema },
})

export type AgiloftAttachmentInfoBody = ContractBody<typeof agiloftAttachmentInfoContract>
export type AgiloftAttachmentInfoBodyInput = ContractBodyInput<typeof agiloftAttachmentInfoContract>
export type AgiloftAttachmentInfoResponse = ContractJsonResponse<
  typeof agiloftAttachmentInfoContract
>

export const agiloftRemoveAttachmentBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
  fieldName: z.string().min(1, 'Field name is required'),
  position: z.string().min(1, 'Position is required'),
})

export const agiloftRemoveAttachmentResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      recordId: z.string(),
      fieldName: z.string(),
      remainingAttachments: z.number(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftRemoveAttachmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/remove_attachment',
  body: agiloftRemoveAttachmentBodySchema,
  response: { mode: 'json', schema: agiloftRemoveAttachmentResponseSchema },
})

export type AgiloftRemoveAttachmentBody = ContractBody<typeof agiloftRemoveAttachmentContract>
export type AgiloftRemoveAttachmentBodyInput = ContractBodyInput<
  typeof agiloftRemoveAttachmentContract
>
export type AgiloftRemoveAttachmentResponse = ContractJsonResponse<
  typeof agiloftRemoveAttachmentContract
>

export const agiloftGetChoiceLineIdBodySchema = z.object({
  ...agiloftBaseFields,
  fieldName: z.string().min(1, 'Field name is required'),
  value: z.string().min(1, 'Value is required'),
})

export const agiloftGetChoiceLineIdResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      choiceLineId: z.number().nullable(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftGetChoiceLineIdContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/get_choice_line_id',
  body: agiloftGetChoiceLineIdBodySchema,
  response: { mode: 'json', schema: agiloftGetChoiceLineIdResponseSchema },
})

export type AgiloftGetChoiceLineIdBody = ContractBody<typeof agiloftGetChoiceLineIdContract>
export type AgiloftGetChoiceLineIdBodyInput = ContractBodyInput<
  typeof agiloftGetChoiceLineIdContract
>
export type AgiloftGetChoiceLineIdResponse = ContractJsonResponse<
  typeof agiloftGetChoiceLineIdContract
>

export const agiloftRunActionButtonBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
  actionButtonField: z.string().min(1, 'Action button field name is required'),
})

export const agiloftRunActionButtonResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      recordId: z.string(),
      callbackId: z.string().nullable(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftRunActionButtonContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/run_action_button',
  body: agiloftRunActionButtonBodySchema,
  response: { mode: 'json', schema: agiloftRunActionButtonResponseSchema },
})

export type AgiloftRunActionButtonBody = ContractBody<typeof agiloftRunActionButtonContract>
export type AgiloftRunActionButtonBodyInput = ContractBodyInput<
  typeof agiloftRunActionButtonContract
>
export type AgiloftRunActionButtonResponse = ContractJsonResponse<
  typeof agiloftRunActionButtonContract
>

export const agiloftSavedSearchBodySchema = z.object({ ...agiloftBaseFields })

export const agiloftSavedSearchResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      searches: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          id: z.number().nullable(),
          description: z.string().nullable(),
        })
      ),
      totalCount: z.number(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftSavedSearchContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/saved_search',
  body: agiloftSavedSearchBodySchema,
  response: { mode: 'json', schema: agiloftSavedSearchResponseSchema },
})

export type AgiloftSavedSearchBody = ContractBody<typeof agiloftSavedSearchContract>
export type AgiloftSavedSearchBodyInput = ContractBodyInput<typeof agiloftSavedSearchContract>
export type AgiloftSavedSearchResponse = ContractJsonResponse<typeof agiloftSavedSearchContract>

const agiloftCredentialFields = {
  instanceUrl: z.string().min(1, 'Instance URL is required'),
  knowledgeBase: z.string().min(1, 'Knowledge base is required'),
  login: z.string().min(1, 'Login is required'),
  password: z.string().min(1, 'Password is required'),
} as const

/** EWTable is KB-scoped; `table` narrows the result rather than selecting it. */
export const agiloftListTablesBodySchema = z.object({
  ...agiloftCredentialFields,
  table: optionalText,
  includeLinkedInfo: z
    .boolean()
    .nullish()
    .transform((value) => value ?? undefined),
  skipColumnsInfo: z
    .boolean()
    .nullish()
    .transform((value) => value ?? undefined),
})

export const agiloftListTablesResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      tables: z.array(
        z.object({
          label: z.string(),
          logicalName: z.string(),
          fields: z.array(
            z.object({
              columnName: z.string(),
              columnLabel: z.string(),
              columnType: z.string(),
              columnTypeDomain: z.string(),
              isLinked: z.boolean(),
            })
          ),
        })
      ),
      totalCount: z.number(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftListTablesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/list_tables',
  body: agiloftListTablesBodySchema,
  response: { mode: 'json', schema: agiloftListTablesResponseSchema },
})

export type AgiloftListTablesBody = ContractBody<typeof agiloftListTablesContract>
export type AgiloftListTablesBodyInput = ContractBodyInput<typeof agiloftListTablesContract>
export type AgiloftListTablesResponse = ContractJsonResponse<typeof agiloftListTablesContract>

export const agiloftUpsertRecordBodySchema = z.object({
  ...agiloftBaseFields,
  match: z.string().min(1, 'A match field is required'),
  data: z.string().min(1, 'Data is required'),
  async: z
    .boolean()
    .nullish()
    .transform((value) => value ?? undefined),
})

export const agiloftUpsertRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      id: z.string().nullable(),
      created: z.boolean(),
      /** Present only for a queued (202) upsert, to poll with Async Status. */
      callbackId: z.string().nullable(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftUpsertRecordContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/upsert_record',
  body: agiloftUpsertRecordBodySchema,
  response: { mode: 'json', schema: agiloftUpsertRecordResponseSchema },
})

export type AgiloftUpsertRecordBody = ContractBody<typeof agiloftUpsertRecordContract>
export type AgiloftUpsertRecordBodyInput = ContractBodyInput<typeof agiloftUpsertRecordContract>
export type AgiloftUpsertRecordResponse = ContractJsonResponse<typeof agiloftUpsertRecordContract>

export const agiloftAsyncStatusBodySchema = z.object({
  ...agiloftBaseFields,
  callbackId: z.string().min(1, 'Callback ID is required'),
})

export const agiloftAsyncStatusResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      callbackId: z.string(),
      statusCode: z.number(),
      status: z.string(),
      complete: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftAsyncStatusContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/async_status',
  body: agiloftAsyncStatusBodySchema,
  response: { mode: 'json', schema: agiloftAsyncStatusResponseSchema },
})

export type AgiloftAsyncStatusBody = ContractBody<typeof agiloftAsyncStatusContract>
export type AgiloftAsyncStatusBodyInput = ContractBodyInput<typeof agiloftAsyncStatusContract>
export type AgiloftAsyncStatusResponse = ContractJsonResponse<typeof agiloftAsyncStatusContract>

/** EWNLPSearch is knowledge-base scoped and takes no table. */
export const agiloftNlpSearchBodySchema = z.object({
  ...agiloftCredentialFields,
  nlpQuery: z.string().min(1, 'A natural language query is required'),
  fields: z.string().min(1, 'At least one field to return is required'),
  page: optionalText,
  limit: optionalText,
})

export const agiloftNlpSearchResponseSchema = z.object({
  success: z.boolean(),
  output: z
    .object({
      records: z.array(z.record(z.string(), z.unknown())),
      totalCount: z.number(),
      truncated: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
})

export const agiloftNlpSearchContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/agiloft/nlp_search',
  body: agiloftNlpSearchBodySchema,
  response: { mode: 'json', schema: agiloftNlpSearchResponseSchema },
})

export type AgiloftNlpSearchBody = ContractBody<typeof agiloftNlpSearchContract>
export type AgiloftNlpSearchBodyInput = ContractBodyInput<typeof agiloftNlpSearchContract>
export type AgiloftNlpSearchResponse = ContractJsonResponse<typeof agiloftNlpSearchContract>
