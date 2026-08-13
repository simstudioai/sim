import { z } from 'zod'
import { workspaceCredentialRoleSchema } from '@/lib/api/contracts/credentials'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
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

export const v2CredentialProviderAuthorizationOptionSchema = z.object({
  providerId: z
    .string()
    .min(1, 'providerId cannot be empty')
    .max(255, 'providerId must be at most 255 characters')
    .describe('Exact OAuth provider identifier accepted by the connection endpoint.'),
  label: z.string().min(1).max(255).describe('Human-readable authorization-server label.'),
})
export type V2CredentialProviderAuthorizationOption = z.output<
  typeof v2CredentialProviderAuthorizationOptionSchema
>

export const v2CredentialProviderSchema = z
  .object({
    serviceId: z.string().min(1).max(255).describe('Stable OAuth service identifier.'),
    name: z.string().min(1).max(255).describe('OAuth service display name.'),
    description: z.string().min(1).max(1000).describe('OAuth service description.'),
    providerFamily: z.string().min(1).max(255).describe('Owning provider family identifier.'),
    available: z
      .boolean()
      .describe('Whether this caller can start the OAuth flow in the current deployment.'),
    supportsReconnect: z
      .boolean()
      .describe('Whether existing credentials for this service can be reconnected.'),
    authorizationOptions: z
      .array(v2CredentialProviderAuthorizationOptionSchema)
      .min(1)
      .max(10)
      .describe('Authorization servers available for this OAuth service.'),
  })
  .meta({
    id: 'V2CredentialProvider',
    title: 'Credential Provider',
    description: 'An OAuth service that may be connected to a workspace.',
  })
export type V2CredentialProvider = z.output<typeof v2CredentialProviderSchema>

/** A credential's natural name field is `displayName`, so that is what `search` matches. */
export const v2CredentialSortFields = ['displayName', 'createdAt', 'updatedAt'] as const
export type V2CredentialSortBy = (typeof v2CredentialSortFields)[number]

export const v2ListCredentialsQuerySchema = z
  .object({
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
    ...v2PaginationFields({ description: 'Maximum credentials to return per page.' }),
  })
  .strict()
export type V2ListCredentialsQuery = z.output<typeof v2ListCredentialsQuerySchema>

/**
 * Lists OAuth and service-account connections, keyset-paginated over the active
 * sort. Credential mutations are intentionally absent. Nothing capped the
 * per-workspace set before pagination, so the response grew without bound.
 */
export const v2ListCredentialsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/credentials',
  query: v2ListCredentialsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2CredentialSchema),
  },
})

export const v2ListCredentialProvidersQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe(
      'Workspace used to evaluate OAuth availability and integration policy.'
    ),
  })
  .strict()
export type V2ListCredentialProvidersQuery = z.output<typeof v2ListCredentialProvidersQuerySchema>

export const v2ListCredentialProvidersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/credential-providers',
  query: v2ListCredentialProvidersQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2CredentialProviderSchema, { paged: false }),
  },
})

const v2CreateCredentialConnectionByProviderSchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that will own the credential.'),
    providerId: z
      .string({ error: 'providerId is required' })
      .trim()
      .min(1, 'providerId cannot be empty')
      .max(255, 'providerId must be at most 255 characters')
      .describe('Exact provider ID returned by the credential-provider catalog.'),
    displayName: z
      .string({ error: 'displayName is required' })
      .trim()
      .min(1, 'displayName cannot be empty')
      .max(255, 'displayName must be at most 255 characters')
      .describe('Name shown for the new credential in Sim.'),
  })
  .strict()

const v2CreateCredentialConnectionByCredentialSchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace expected to own the credential.'),
    credentialId: z
      .string({ error: 'credentialId is required' })
      .trim()
      .min(1, 'credentialId cannot be empty')
      .max(255, 'credentialId must be at most 255 characters')
      .describe('Existing OAuth credential to reconnect in place.'),
  })
  .strict()

export const v2CreateCredentialConnectionBodySchema = z.union([
  v2CreateCredentialConnectionByProviderSchema,
  v2CreateCredentialConnectionByCredentialSchema,
])
export type V2CreateCredentialConnectionBody = z.output<
  typeof v2CreateCredentialConnectionBodySchema
>

export const v2CredentialConnectionAuthorizationSchema = z
  .object({
    authorizationUrl: z
      .string()
      .url('authorizationUrl must be an absolute URL')
      .describe('Short-lived Sim browser URL that starts the OAuth authorization flow.'),
    expiresAt: v2TimestampSchema.describe('ISO 8601 timestamp when the connection link expires.'),
  })
  .meta({
    id: 'V2CredentialConnectionAuthorization',
    title: 'Credential Connection Authorization',
    description: 'A short-lived browser entrypoint for an OAuth connection flow.',
  })
export type V2CredentialConnectionAuthorization = z.output<
  typeof v2CredentialConnectionAuthorizationSchema
>

export const v2CreateCredentialConnectionResponseSchema = v2DataResponse(
  v2CredentialConnectionAuthorizationSchema
)
export type V2CreateCredentialConnectionResponse = z.output<
  typeof v2CreateCredentialConnectionResponseSchema
>

export const v2CreateCredentialConnectionContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/credential-connections',
  body: v2CreateCredentialConnectionBodySchema,
  response: {
    mode: 'json',
    schema: v2CreateCredentialConnectionResponseSchema,
  },
})
