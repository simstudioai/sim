import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const optionalString = z.string().optional()

/**
 * Accepts `string | null | undefined` on the wire and outputs `string |
 * undefined` (null collapsed to undefined). Used for fields like `workflowId`
 * where the wire is permissive but server-side handlers expect an optional
 * string.
 */
export const nullableOptionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)

export const credentialWorkflowBodySchema = z.object({
  credential: z.string().min(1),
  workflowId: nullableOptionalString,
})

export const credentialWorkflowDomainBodySchema = credentialWorkflowBodySchema.extend({
  domain: z.string().min(1),
})

export const credentialWorkflowImpersonateBodySchema = credentialWorkflowBodySchema.extend({
  impersonateEmail: optionalString,
})

export const credentialIdQuerySchema = z.object({
  credentialId: z
    .string({ error: 'Credential ID is required' })
    .min(1, 'Credential ID is required'),
})

export const credentialIdQueryWithSearchSchema = credentialIdQuerySchema.extend({
  query: optionalString,
})

export const idNameSchema = z.object({ id: z.string(), name: z.string() }).passthrough()
export const idTitleSchema = z.object({ id: z.string(), title: z.string() }).passthrough()
export const idDisplayNameSchema = z
  .object({ id: z.string(), displayName: z.string() })
  .passthrough()
export const fileOptionSchema = z.object({ id: z.string(), name: z.string() }).passthrough()
export const folderOptionSchema = z.object({ id: z.string(), name: z.string() }).passthrough()

export const definePostSelector = <TBody extends z.ZodType, TResponse extends z.ZodType>(
  path: string,
  body: TBody,
  response: TResponse
) =>
  defineRouteContract({
    method: 'POST',
    path,
    body,
    response: { mode: 'json', schema: response },
  })

export const defineGetSelector = <TQuery extends z.ZodType, TResponse extends z.ZodType>(
  path: string,
  query: TQuery,
  response: TResponse
) =>
  defineRouteContract({
    method: 'GET',
    path,
    query,
    response: { mode: 'json', schema: response },
  })
