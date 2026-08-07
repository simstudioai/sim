import { z } from 'zod'
import { workspaceCredentialRoleSchema } from '@/lib/api/contracts/credentials'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CursorListResponse, v2SearchSchema, v2SortFields } from '@/lib/api/contracts/v2/shared'

/** Public credentials are authenticated connections, never raw environment secrets. */
export const v2CredentialTypeSchema = z.enum(['oauth', 'service_account'])
export type V2CredentialType = z.output<typeof v2CredentialTypeSchema>

/** Public credential metadata. No token, key, or service-account payload is returned. */
export const v2CredentialSchema = z.object({
  id: z.string(),
  type: v2CredentialTypeSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  providerId: z.string().nullable(),
  accountId: z.string().nullable(),
  hasServiceAccountKey: z.boolean(),
  role: workspaceCredentialRoleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type V2Credential = z.output<typeof v2CredentialSchema>

/** A credential's natural name field is `displayName`, so that is what `search` matches. */
export const v2CredentialSortFields = ['displayName', 'createdAt', 'updatedAt'] as const
export type V2CredentialSortBy = (typeof v2CredentialSortFields)[number]

export const v2ListCredentialsQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  type: v2CredentialTypeSchema.optional(),
  providerId: z.string().min(1, 'providerId cannot be empty').optional(),
  search: v2SearchSchema,
  ...v2SortFields(v2CredentialSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
})
export type V2ListCredentialsQuery = z.output<typeof v2ListCredentialsQuerySchema>

/** Lists OAuth and service-account connections. Credential mutations are intentionally absent. */
export const v2ListCredentialsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/credentials',
  query: v2ListCredentialsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2CredentialSchema),
  },
})
