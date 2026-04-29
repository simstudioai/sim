import { z } from 'zod'

export const unknownRecordSchema = z.record(z.string(), z.unknown())

export function flattenFieldErrors<TFields extends string>(
  error: z.ZodError
): Partial<Record<TFields, string>> {
  const result: Partial<Record<TFields, string>> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string') continue
    if (result[field as TFields] === undefined) {
      result[field as TFields] = issue.message
    }
  }
  return result
}

export const noInputSchema = z.object({}).strict()
export type NoInput = z.output<typeof noInputSchema>

export const jobIdParamsSchema = z.object({
  jobId: z.string().min(1),
})

export const memoryIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const memoryWorkspaceQuerySchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
})

const agentMemoryDataSchema = z.object({
  role: z.enum(['user', 'assistant', 'system'], {
    error: 'Role must be user, assistant, or system',
  }),
  content: z.string().min(1, 'Content is required'),
})

const genericMemoryDataSchema = z.record(z.string(), z.unknown())

export const memoryPutBodySchema = z.object({
  data: z.union([agentMemoryDataSchema, genericMemoryDataSchema], {
    error: 'Invalid memory data structure',
  }),
  workspaceId: z.string().uuid('Invalid workspace ID format'),
})
export type MemoryPutBody = z.input<typeof memoryPutBodySchema>

export const agentMemoryDataSchemaContract = agentMemoryDataSchema

export const memoryListQuerySchema = z.object({
  workspaceId: z.string().optional(),
  query: z.string().nullable().optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => Number.parseInt(value || '50')),
})

export const memoryMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.unknown().refine((value) => Boolean(value)),
  })
  .passthrough()

export const memoryPostBodySchema = z
  .object({
    key: z.string().optional(),
    data: z.unknown().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough()
export type MemoryPostBody = z.input<typeof memoryPostBodySchema>

export const memoryDeleteQuerySchema = z.object({
  workspaceId: z.string().optional(),
  conversationId: z.string().optional(),
})

/**
 * Non-empty string identifier (used for workspace, workflow, user, table, etc.).
 * Prefer this over inline `z.string().min(1)` so error wording stays consistent
 * and refactors can centralize ID validation in one place.
 */
export const nonEmptyIdSchema = z.string().min(1)

/**
 * Non-empty `workspaceId` field. Same constraint as `nonEmptyIdSchema` with a
 * stable, human-readable message. Use to deduplicate the
 * `z.string().min(1, 'Workspace ID is required')` pattern across contracts.
 */
export const workspaceIdSchema = z.string().min(1, 'Workspace ID is required')

/**
 * Non-empty `workflowId` field. Same constraint as `nonEmptyIdSchema` with a
 * stable, human-readable message.
 */
export const workflowIdSchema = z.string().min(1, 'Workflow ID is required')
