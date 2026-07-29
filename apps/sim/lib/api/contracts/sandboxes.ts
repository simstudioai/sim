import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

export const sandboxLanguageSchema = z.enum(['javascript', 'python'])

export const sandboxBuildStatusSchema = z.enum(['pending', 'building', 'ready', 'failed'])

/**
 * How the active deployment materializes dependencies. `runtime` deployments
 * have no build to report, so the UI swaps the build-status chip for a note
 * about the per-execution install cost.
 */
export const sandboxStrategySchema = z.enum(['prebuilt', 'runtime'])

/**
 * A structural payload guard, NOT the product limit.
 *
 * The client submits one entry per raw textarea line — blanks and `#` comments
 * included — so that a rejection can be addressed back to the row the user typed
 * it on. `validateDependencies` strips those before applying the real
 * MAX_SANDBOX_DEPENDENCIES / MAX_DEPENDENCY_LENGTH caps and returns per-line
 * `issues` the editor marks inline. Bounding this at the real limits instead
 * would reject a legal list (50 packages plus a trailing newline is 51 entries)
 * with a generic error carrying no `issues`, leaving the editor nothing to mark.
 */
const dependencyListSchema = z
  .array(z.string().max(2000, 'a dependency line is unreasonably long'))
  .max(1000, 'too many lines — paste a shorter dependency list')

const sandboxNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(64, 'Name must be 64 characters or fewer')

export const sandboxSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: sandboxLanguageSchema,
  dependencies: z.array(z.string()),
  /** Absent under the `runtime` strategy, which has nothing to build. */
  buildStatus: sandboxBuildStatusSchema.nullable(),
  /** Classified failure code from the build taxonomy. */
  errorCode: z.string().nullable(),
  /** User-facing copy for the failure; never a raw traceback. */
  errorMessage: z.string().nullable(),
  /** Installer log tail, shown behind a disclosure. */
  errorDetail: z.string().nullable(),
  builtAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Sandbox = z.output<typeof sandboxSchema>

/** A dependency line the server refused, addressed to the row the user typed it on. */
export const sandboxDependencyIssueSchema = z.object({
  line: z.number().int().positive(),
  value: z.string(),
  reason: z.string(),
})

export type SandboxDependencyIssue = z.output<typeof sandboxDependencyIssueSchema>

const sandboxWorkspaceParamsSchema = z.object({
  id: workspaceIdSchema,
})

const sandboxResourceParamsSchema = z.object({
  id: workspaceIdSchema,
  sandboxId: z.string().min(1, 'sandboxId is required'),
})

export const createSandboxBodySchema = z.object({
  name: sandboxNameSchema,
  language: sandboxLanguageSchema,
  /** One entry per submitted line, comments and blanks included, so rejections keep their row. */
  dependencies: dependencyListSchema,
})

export type CreateSandboxBody = z.input<typeof createSandboxBodySchema>

export const updateSandboxBodySchema = z
  .object({
    name: sandboxNameSchema.optional(),
    language: sandboxLanguageSchema.optional(),
    dependencies: dependencyListSchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.language !== undefined || body.dependencies !== undefined,
    { message: 'Provide at least one of name, language, or dependencies' }
  )

export type UpdateSandboxBody = z.input<typeof updateSandboxBodySchema>

export const listSandboxesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/sandboxes',
  params: sandboxWorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      sandboxes: z.array(sandboxSchema),
      strategy: sandboxStrategySchema,
      /** False on a free plan: the list still renders, but read-only behind an upgrade prompt. */
      entitled: z.boolean(),
    }),
  },
})

export const createSandboxContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/sandboxes',
  params: sandboxWorkspaceParamsSchema,
  body: createSandboxBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      sandbox: sandboxSchema,
    }),
  },
})

export const updateSandboxContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/sandboxes/[sandboxId]',
  params: sandboxResourceParamsSchema,
  body: updateSandboxBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      sandbox: sandboxSchema,
    }),
  },
})

export const deleteSandboxContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/sandboxes/[sandboxId]',
  params: sandboxResourceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export type SandboxListResponse = ContractJsonResponse<typeof listSandboxesContract>
