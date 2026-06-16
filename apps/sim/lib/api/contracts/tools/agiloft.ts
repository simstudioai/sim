import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

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
  fileName: z.string().optional(),
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
  output: z.object({
    id: z.string().nullable(),
    fields: z.record(z.string(), z.unknown()),
  }),
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
  fields: z.string().optional(),
})

export const agiloftReadRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({
    id: z.string().nullable(),
    fields: z.record(z.string(), z.unknown()),
  }),
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
  output: z.object({
    id: z.string().nullable(),
    fields: z.record(z.string(), z.unknown()),
  }),
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

export const agiloftDeleteRecordBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
})

export const agiloftDeleteRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({
    id: z.string(),
    deleted: z.boolean(),
  }),
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
})

export const agiloftLockRecordResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({
    id: z.string(),
    lockStatus: z.string(),
    lockedBy: z.string().nullable(),
    lockExpiresInMinutes: z.number().nullable(),
  }),
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

export const agiloftSearchRecordsBodySchema = z.object({
  ...agiloftBaseFields,
  query: z.string().min(1, 'Query is required'),
  fields: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
})

export const agiloftSearchRecordsResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({
    records: z.array(z.record(z.string(), z.unknown())),
    totalCount: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
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
  output: z.object({
    recordIds: z.array(z.string()),
    totalCount: z.number(),
  }),
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

export const agiloftSavedSearchBodySchema = z.object({
  ...agiloftBaseFields,
})

export const agiloftSavedSearchResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({
    searches: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        id: z.union([z.string(), z.number()]),
        description: z.string().nullable(),
      })
    ),
  }),
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

export const agiloftAttachmentInfoBodySchema = z.object({
  ...agiloftBaseFields,
  recordId: z.string().min(1, 'Record ID is required'),
  fieldName: z.string().min(1, 'Field name is required'),
})

export const agiloftAttachmentInfoResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({
    attachments: z.array(
      z.object({
        position: z.number(),
        name: z.string(),
        size: z.number(),
      })
    ),
    totalCount: z.number(),
  }),
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
  output: z.object({
    recordId: z.string(),
    fieldName: z.string(),
    remainingAttachments: z.number(),
  }),
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
  output: z.object({
    choiceLineId: z.number().nullable(),
  }),
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
