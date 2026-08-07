import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const environmentVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
})

export const environmentVariablesSchema = z.record(z.string(), z.string())

export const personalEnvironmentDataSchema = z.record(z.string(), environmentVariableSchema)

/**
 * Disclosure policy for a workspace environment key. `secret` is masked from
 * non-admins and redacted from traces; `variable` is readable by every member.
 * Write authorization is identical for both — this governs reads only.
 */
export const envVisibilitySchema = z.enum(['secret', 'variable'])

/** Per-key disclosure policy. Keys absent from the map are secrets. */
export const envVisibilityMapSchema = z.record(z.string(), envVisibilitySchema)

export const workspaceEnvironmentDataSchema = z.object({
  workspace: environmentVariablesSchema.default({}),
  personal: environmentVariablesSchema.default({}),
  conflicts: z.array(z.string()).default([]),
  visibility: envVisibilityMapSchema.default({}),
})

export const workspaceEnvironmentParamsSchema = z.object({
  id: z.string().min(1),
})

export const savePersonalEnvironmentBodySchema = z.object({
  variables: environmentVariablesSchema,
})

/**
 * Workspace upsert body. `variables` is the key -> value map (both kinds of
 * key); `visibility` is the separate, optional per-key disclosure policy.
 * The two are deliberately distinct fields — `variables` predates this feature
 * and does not mean "non-secret values".
 */
export const upsertWorkspaceEnvironmentBodySchema = z.object({
  variables: environmentVariablesSchema,
  visibility: envVisibilityMapSchema.optional(),
})

export const removeWorkspaceEnvironmentBodySchema = z.object({
  keys: z.array(z.string()).min(1),
})

const successResponseSchema = z.object({
  success: z.literal(true),
})

export type EnvironmentVariable = z.output<typeof environmentVariableSchema>
export type EnvVisibility = z.output<typeof envVisibilitySchema>
export type EnvVisibilityMap = z.output<typeof envVisibilityMapSchema>
export type WorkspaceEnvironmentData = z.output<typeof workspaceEnvironmentDataSchema>
export type UpsertWorkspaceEnvironmentBody = z.input<typeof upsertWorkspaceEnvironmentBodySchema>
export type SavePersonalEnvironmentBody = z.input<typeof savePersonalEnvironmentBodySchema>

export const getPersonalEnvironmentContract = defineRouteContract({
  method: 'GET',
  path: '/api/environment',
  response: {
    mode: 'json',
    schema: z.object({
      data: personalEnvironmentDataSchema,
    }),
  },
})

export const savePersonalEnvironmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/environment',
  body: savePersonalEnvironmentBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const getWorkspaceEnvironmentContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/environment',
  params: workspaceEnvironmentParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: workspaceEnvironmentDataSchema,
    }),
  },
})

export const upsertWorkspaceEnvironmentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/environment',
  params: workspaceEnvironmentParamsSchema,
  body: upsertWorkspaceEnvironmentBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})

export const removeWorkspaceEnvironmentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/environment',
  params: workspaceEnvironmentParamsSchema,
  body: removeWorkspaceEnvironmentBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema,
  },
})
