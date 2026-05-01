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
  file: FileInputSchema.optional().nullable(),
  fileName: z.string().optional().nullable(),
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
