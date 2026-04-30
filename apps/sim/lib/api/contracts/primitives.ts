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
