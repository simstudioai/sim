import { z } from 'zod'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const typeformFilesBodySchema = z.object({
  formId: z.string().min(1, 'Form ID is required'),
  responseId: z.string().min(1, 'Response ID is required'),
  fieldId: z.string().min(1, 'Field ID is required'),
  filename: z.string().min(1, 'Filename is required'),
  inline: z.boolean().optional(),
  apiKey: z.string().min(1, 'API key is required'),
  workspaceId: z.string().optional(),
  workflowId: z.string().optional(),
  executionId: z.string().optional(),
})

export const typeformFilesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/typeform/files',
  body: typeformFilesBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})
