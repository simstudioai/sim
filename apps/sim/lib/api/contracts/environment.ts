import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const environmentVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
})

export const environmentVariablesSchema = z.record(z.string(), z.string())

export const personalEnvironmentDataSchema = z.record(z.string(), environmentVariableSchema)

export const workspaceEnvironmentDataSchema = z.object({
  workspace: environmentVariablesSchema.default({}),
  personal: environmentVariablesSchema.default({}),
  conflicts: z.array(z.string()).default([]),
})

export const workspaceEnvironmentParamsSchema = z.object({
  id: z.string().min(1),
})

export const savePersonalEnvironmentBodySchema = z.object({
  variables: environmentVariablesSchema,
})

export const removeWorkspaceEnvironmentBodySchema = z.object({
  keys: z.array(z.string()).min(1),
})

const successResponseSchema = z.object({
  success: z.literal(true),
})

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
  body: savePersonalEnvironmentBodySchema,
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
