import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const baseInputSchema = z.object({
  agentUrl: z.string().url('Agent URL must be a valid URL').max(2048),
  apiKey: z.string().optional(),
})

export const a2aSendMessageInputSchema = baseInputSchema.extend({
  message: z.string().min(1, 'Message is required'),
  data: z.unknown().optional(),
  files: z.array(RawFileInputSchema).max(20).optional(),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
})

export const a2aGetTaskInputSchema = baseInputSchema.extend({
  taskId: z.string().min(1, 'Task ID is required'),
  historyLength: z
    .number()
    .int()
    .positive()
    .max(1000, 'History length cannot exceed 1000')
    .optional(),
})

export const a2aCancelTaskInputSchema = baseInputSchema.extend({
  taskId: z.string().min(1, 'Task ID is required'),
})

export const a2aGetAgentCardInputSchema = baseInputSchema

export type A2ASendMessageInput = z.output<typeof a2aSendMessageInputSchema>
export type A2AGetTaskInput = z.output<typeof a2aGetTaskInputSchema>
export type A2ACancelTaskInput = z.output<typeof a2aCancelTaskInputSchema>
export type A2AGetAgentCardInput = z.output<typeof a2aGetAgentCardInputSchema>
