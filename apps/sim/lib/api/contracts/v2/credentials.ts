import { z } from 'zod'
import { workspaceCredentialRoleSchema } from '@/lib/api/contracts/credentials'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'

/** Public credentials are authenticated connections, never raw environment secrets. */
export const v2CredentialTypeSchema = z
  .enum(['oauth', 'service_account'])
  .describe('Authenticated connection type.')
export type V2CredentialType = z.output<typeof v2CredentialTypeSchema>

/** Public credential metadata. No token, key, or service-account payload is returned. */
export const v2CredentialSchema = z
  .object({
    id: z.string().describe('Unique credential identifier.'),
    type: v2CredentialTypeSchema,
    displayName: z.string().describe('Credential display name.'),
    description: z.string().nullable().describe('Optional credential description.'),
    providerId: z
      .string()
      .nullable()
      .describe('Integration provider authenticated by this credential.'),
    accountId: z.string().nullable().describe('Linked account identifier for OAuth credentials.'),
    hasServiceAccountKey: z
      .boolean()
      .describe('Whether a service-account payload is stored. Its contents are never returned.'),
    role: workspaceCredentialRoleSchema.describe('Caller role for the credential.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the credential was created.'),
    updatedAt: v2TimestampSchema.describe(
      'ISO 8601 timestamp when the credential was last updated.'
    ),
  })
  .meta({
    id: 'V2Credential',
    title: 'Credential',
    description: 'Public authenticated-connection metadata without secret material.',
  })
export type V2Credential = z.output<typeof v2CredentialSchema>

/** A credential's natural name field is `displayName`, so that is what `search` matches. */
export const v2CredentialSortFields = ['displayName', 'createdAt', 'updatedAt'] as const
export type V2CredentialSortBy = (typeof v2CredentialSortFields)[number]

export const v2ListCredentialsQuerySchema = z.object({
  workspaceId: workspaceIdSchema.describe('Workspace whose credentials should be listed.'),
  type: v2CredentialTypeSchema.optional().describe('Restrict results to this credential type.'),
  providerId: z
    .string()
    .min(1, 'providerId cannot be empty')
    .optional()
    .describe('Restrict results to credentials for this integration provider.'),
  search: v2SearchSchema.describe(
    'Case-insensitive substring match against the credential display name.'
  ),
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
