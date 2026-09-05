import { z } from 'zod'
import {
  atlassianProductSchema,
  quickBooksOAuthClientConfigSchema,
  workspaceCredentialRoleSchema,
} from '@/lib/api/contracts/credentials'
import {
  missingFieldError,
  noInputSchema,
  nonEmptyIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import {
  getServiceAccountRequiredFields,
  SERVICE_ACCOUNT_REQUIRED_FIELDS,
} from '@/lib/credentials/service-account-fields'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'

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

export const v2CredentialProviderAuthorizationOptionSchema = z
  .object({
    providerId: z
      .string()
      .min(1, 'providerId cannot be empty')
      .max(255, 'providerId must be at most 255 characters')
      .describe('Exact OAuth provider identifier accepted by the connection endpoint.'),
    label: z
      .string()
      .min(1, 'label cannot be empty')
      .max(255, 'label must be at most 255 characters')
      .describe('Human-readable authorization-server label.'),
  })
  .strict()
export type V2CredentialProviderAuthorizationOption = z.output<
  typeof v2CredentialProviderAuthorizationOptionSchema
>

export const v2CredentialProviderFieldOptionSchema = z
  .object({
    value: z.string().min(1).max(255).describe('Submitted option value.'),
    label: z.string().min(1).max(255).describe('Human-readable option label.'),
  })
  .strict()

export const v2CredentialProviderFieldSchema = z
  .object({
    id: z.string().min(1).max(255).describe('Exact create-body field name.'),
    label: z.string().min(1).max(255).describe('Human-readable field label.'),
    placeholder: z.string().min(1).max(1000).describe('Suggested input placeholder.'),
    required: z.boolean().describe('Whether the field is required for the selected flow.'),
    secret: z.boolean().describe('Whether the submitted field is write-only secret material.'),
    multiline: z.boolean().describe('Whether the field is intended for multi-line input.'),
    requiredForAuthMethods: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(10)
      .optional()
      .describe('Authentication methods for which this field is required.'),
    options: z
      .array(v2CredentialProviderFieldOptionSchema)
      .min(1)
      .max(20)
      .optional()
      .describe('Fixed values accepted by a selector field.'),
    hint: z.string().min(1).max(2000).optional().describe('Provider-specific setup guidance.'),
  })
  .strict()

const v2CredentialProviderBaseShape = {
  serviceId: z.string().min(1).max(255).describe('Stable credential-provider identifier.'),
  name: z.string().min(1).max(255).describe('Credential provider display name.'),
  description: z.string().min(1).max(1000).describe('Credential provider description.'),
  providerFamily: z.string().min(1).max(255).describe('Owning provider family identifier.'),
  available: z
    .boolean()
    .describe('Whether this caller can connect the provider in the current deployment.'),
} as const

export const v2OAuthCredentialProviderSchema = z
  .object({
    type: z.literal('oauth').describe('Browser-based OAuth connection method.'),
    ...v2CredentialProviderBaseShape,
    supportsReconnect: z
      .boolean()
      .describe('Whether existing credentials for this service can be reconnected.'),
    authorizationOptions: z
      .array(v2CredentialProviderAuthorizationOptionSchema)
      .min(1)
      .max(10)
      .describe('Authorization servers available for this OAuth service.'),
    fields: z
      .array(v2CredentialProviderFieldSchema)
      .max(20)
      .describe('Write-only setup fields required before starting this OAuth flow.'),
  })
  .strict()

export const v2ServiceAccountCredentialProviderSchema = z
  .object({
    type: z.literal('service_account').describe('Direct service-account credential method.'),
    ...v2CredentialProviderBaseShape,
    providerId: z
      .string()
      .min(1)
      .max(255)
      .describe('Exact service-account provider ID accepted by credential creation.'),
    docsUrl: z.string().url().describe('Setup guide for the provider.'),
    helpText: z.string().min(1).max(2000).optional().describe('Provider-specific setup guidance.'),
    requiresClientGeneratedCredentialId: z
      .boolean()
      .describe('Whether the caller must generate and submit the credential ID before setup.'),
    fields: z
      .array(v2CredentialProviderFieldSchema)
      .min(1)
      .max(20)
      .describe('Create-body fields accepted by this provider. Secret fields are write-only.'),
  })
  .strict()

export const v2CredentialProviderSchema = z
  .discriminatedUnion('type', [
    v2OAuthCredentialProviderSchema,
    v2ServiceAccountCredentialProviderSchema,
  ])
  .meta({
    id: 'V2CredentialProvider',
    title: 'Credential Provider',
    description: 'An OAuth or service-account connection method available to a workspace.',
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
    ...v2SortFields(v2CredentialSortFields, {
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    ...v2PaginationFields({
      description: 'Maximum credentials to return per page.',
    }),
  })
  .strict()
export type V2ListCredentialsQuery = z.output<typeof v2ListCredentialsQuerySchema>

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
      'Workspace used to evaluate credential-provider availability and integration policy.'
    ),
    search: v2SearchSchema.describe(
      'Case-insensitive substring match against the credential provider name.'
    ),
  })
  .strict()
export type V2ListCredentialProvidersQuery = z.output<typeof v2ListCredentialProvidersQuerySchema>

export const v2ListCredentialProvidersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/credentials/providers',
  query: v2ListCredentialProvidersQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2CredentialProviderSchema, { paged: false }),
  },
})

export const V2_OAUTH_CONNECTION_PROVIDER_IDS = [
  'github-repositories',
  'google-email',
  'google-drive',
  'google-docs',
  'google-sheets',
  'google-forms',
  'google-calendar',
  'google-contacts',
  'google-ads',
  'google-bigquery',
  'google-tasks',
  'google-vault',
  'google-groups',
  'google-chat',
  'google-meet',
  'vertex-ai',
  'microsoft-ad',
  'microsoft-dataverse',
  'microsoft-excel',
  'microsoft-planner',
  'microsoft-teams',
  'microsoft-word',
  'outlook',
  'onedrive',
  'sharepoint',
  'x',
  'tiktok',
  'confluence',
  'jira',
  'airtable',
  'bitbucket',
  'notion',
  'clickup',
  'linear',
  'manageengine-sdp',
  'monday',
  'box',
  'dropbox',
  'shopify',
  'slack',
  'reddit',
  'wealthbox',
  'webflow',
  'trello',
  'asana',
  'attio',
  'calcom',
  'docusign',
  'pipedrive',
  'quickbooks',
  'hubspot',
  'linkedin',
  'instagram',
  'salesforce',
  'salesforce-sandbox',
  'zoho-desk',
  'zoom',
  'wordpress',
  'spotify',
] as const

const V2_NON_QUICKBOOKS_OAUTH_CONNECTION_PROVIDER_IDS = V2_OAUTH_CONNECTION_PROVIDER_IDS.filter(
  (
    providerId
  ): providerId is Exclude<(typeof V2_OAUTH_CONNECTION_PROVIDER_IDS)[number], 'quickbooks'> =>
    providerId !== 'quickbooks'
)

const v2CredentialConnectionBaseFields = {
  workspaceId: workspaceIdSchema.describe('Workspace that will own the credential.'),
  displayName: z
    .string({ error: 'displayName is required' })
    .trim()
    .min(1, 'displayName cannot be empty')
    .max(255, 'displayName must be at most 255 characters')
    .describe('Name shown for the new credential in Sim.'),
}

const v2CreateQuickBooksCredentialConnectionSchema = z
  .object({
    ...v2CredentialConnectionBaseFields,
    providerId: z
      .literal('quickbooks')
      .describe('QuickBooks OAuth provider ID returned by credential-provider discovery.'),
    oauthClientConfig: quickBooksOAuthClientConfigSchema.describe(
      'Write-only caller-managed Intuit OAuth app configuration.'
    ),
  })
  .strict()

const v2CreateStandardOAuthCredentialConnectionSchema = z
  .object({
    ...v2CredentialConnectionBaseFields,
    providerId: z
      .enum(V2_NON_QUICKBOOKS_OAUTH_CONNECTION_PROVIDER_IDS)
      .describe('Exact OAuth provider ID returned by credential-provider discovery.'),
  })
  .strict()

const v2CreateCredentialConnectionByProviderSchema = z.union([
  v2CreateQuickBooksCredentialConnectionSchema,
  v2CreateStandardOAuthCredentialConnectionSchema,
])

const v2CreateCredentialConnectionByCredentialSchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace expected to own the credential.'),
    credentialId: z
      .string({ error: 'credentialId is required' })
      .trim()
      .min(1, 'credentialId cannot be empty')
      .max(255, 'credentialId must be at most 255 characters')
      .describe(
        'Existing OAuth credential to reconnect in place. QuickBooks reconnects also require oauthClientConfig with the Intuit client ID, client secret, environment, and webhook verifier token.'
      ),
    oauthClientConfig: quickBooksOAuthClientConfigSchema
      .optional()
      .describe(
        'Write-only Intuit OAuth app configuration. Required when credentialId identifies a QuickBooks credential; omit it for other providers.'
      ),
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
  path: '/api/v2/credentials/connections',
  query: noInputSchema,
  body: v2CreateCredentialConnectionBodySchema,
  response: {
    mode: 'json',
    schema: v2CreateCredentialConnectionResponseSchema,
  },
})

const v2ServiceAccountCredentialFieldsSchema = z
  .object({
    serviceAccountJson: z
      .string()
      .min(1)
      .max(65_536)
      .optional()
      .describe('Write-only Google service-account JSON key.')
      .meta({ writeOnly: true }),
    apiToken: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .optional()
      .describe('Write-only provider API token.')
      .meta({ writeOnly: true }),
    domain: z.string().trim().min(1).max(2048).optional().describe('Provider account domain.'),
    atlassianProduct: atlassianProductSchema
      .optional()
      .describe(
        'Atlassian product to verify; defaults to Jira on create and preserves the saved product on reconnect.'
      ),
    signingSecret: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .optional()
      .describe('Write-only webhook signing secret.')
      .meta({ writeOnly: true }),
    botToken: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .optional()
      .describe('Write-only bot token.')
      .meta({ writeOnly: true }),
    clientId: z.string().trim().min(1).max(512).optional().describe('OAuth client identifier.'),
    clientSecret: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .optional()
      .describe('Write-only OAuth client secret.')
      .meta({ writeOnly: true }),
    certificateId: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .optional()
      .describe('Provider certificate mapping identifier.'),
    orgId: z.string().trim().min(1).max(255).optional().describe('Provider organization ID.'),
    dataCenter: z.string().trim().min(1).max(32).optional().describe('Provider data center.'),
    authMethod: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('Provider authentication method.'),
    privateKey: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .optional()
      .describe('Write-only PEM private key.')
      .meta({ writeOnly: true }),
    username: z.string().trim().min(1).max(255).optional().describe('Provider run-as username.'),
  })
  .strict()

type V2ServiceAccountCredentialFields = z.output<typeof v2ServiceAccountCredentialFieldsSchema>

const v2ServiceAccountCredentialsJsonSchema = z
  .string({ error: missingFieldError('credentials is required') })
  .min(1, 'credentials cannot be empty')
  .max(131_072, 'credentials must be at most 131072 characters')
  .describe(
    'Write-only JSON object string containing the fields declared by credential-provider discovery.'
  )
  .meta({ writeOnly: true })
  .transform((value, ctx): V2ServiceAccountCredentialFields => {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'credentials must be valid JSON',
      })
      return z.NEVER
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      ctx.addIssue({
        code: 'custom',
        message: 'credentials must be a JSON object',
      })
      return z.NEVER
    }

    const result = v2ServiceAccountCredentialFieldsSchema.safeParse(parsed)
    if (result.success) return result.data

    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: 'custom',
        path: issue.path,
        message: issue.message,
      })
    }
    return z.NEVER
  })

export const v2CreateServiceAccountCredentialBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that will own the credential.'),
    type: z.literal('service_account').describe('Service-account credential discriminator.'),
    providerId: z
      .string({ error: 'providerId is required' })
      .trim()
      .min(1, 'providerId cannot be empty')
      .max(255, 'providerId must be at most 255 characters')
      .describe('Exact service-account provider ID returned by provider discovery.'),
    displayName: z
      .string()
      .trim()
      .min(1, 'displayName cannot be empty')
      .max(255, 'displayName must be at most 255 characters')
      .optional()
      .describe('Optional name; providers may derive one from the verified account identity.'),
    description: z
      .string()
      .trim()
      .max(500, 'description must be at most 500 characters')
      .optional()
      .describe('Optional credential description.'),
    id: z
      .string()
      .uuid('id must be a valid UUID')
      .optional()
      .describe('Required only when provider discovery requests a client-generated ID.'),
    credentials: v2ServiceAccountCredentialsJsonSchema,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!Object.hasOwn(SERVICE_ACCOUNT_REQUIRED_FIELDS, body.providerId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['providerId'],
        message: `Unknown service-account provider: ${body.providerId}`,
      })
      return
    }
    if (body.providerId === SLACK_CUSTOM_BOT_PROVIDER_ID && !body.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: `id is required for ${SLACK_CUSTOM_BOT_PROVIDER_ID} credentials`,
      })
    }
    for (const field of getServiceAccountRequiredFields(body.providerId)) {
      if (!body.credentials[field]) {
        ctx.addIssue({
          code: 'custom',
          path: ['credentials', field],
          message: `${field} is required for ${body.providerId} credentials`,
        })
      }
    }
  })
export type V2CreateServiceAccountCredentialBody = z.input<
  typeof v2CreateServiceAccountCredentialBodySchema
>

export const v2CreateServiceAccountCredentialContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/credentials',
  query: noInputSchema,
  body: v2CreateServiceAccountCredentialBodySchema,
  response: {
    mode: 'json',
    status: [200, 201],
    schema: v2DataResponse(v2CredentialSchema),
  },
})

/**
 * The credential a path addresses, named for what the route does to it.
 *
 * `PATCH` and `DELETE` sit on the same path but are not the same operation, and
 * the OpenAPI document already publishes them as two components
 * (`UpdateCredentialParams`, `DeleteCredentialParams`). One shared `describe()`
 * forced both to read "update or disconnect", so the disconnect reference
 * offered an update the route cannot perform.
 */
export const v2UpdateCredentialParamsSchema = z
  .object({
    credentialId: nonEmptyIdSchema.max(255).describe('Credential to update.'),
  })
  .strict()

export const v2DeleteCredentialParamsSchema = z
  .object({
    credentialId: nonEmptyIdSchema.max(255).describe('Credential to disconnect.'),
  })
  .strict()

export const v2DeleteCredentialQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace expected to own the credential.'),
  })
  .strict()

export const v2CredentialDeleteDataSchema = z
  .object({
    id: nonEmptyIdSchema.describe('Disconnected credential identifier.'),
    deleted: z.literal(true).describe('Whether the credential was disconnected.'),
  })
  .meta({
    id: 'V2CredentialDeleteData',
    title: 'Delete credential data',
    description: 'Credential disconnection acknowledgement.',
  })

export const v2UpdateCredentialQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace expected to own the credential.'),
  })
  .strict()
export type V2UpdateCredentialQuery = z.output<typeof v2UpdateCredentialQuerySchema>

/**
 * Merge-patch semantics: an absent field is left unchanged, and `description:
 * null` clears the stored description. Deliberately `PATCH` rather than `PUT` —
 * omitting a secret field leaves the stored secret in place rather than clearing
 * it, so the body is never a complete representation of the credential.
 *
 * Reuses the create body's secret shape so a rotation cannot accept a field a
 * creation rejects, and so every secret member keeps its `writeOnly` marking.
 * `providerId` is deliberately absent: the provider is a property of the stored
 * credential, and changing it would describe a different credential.
 *
 * Whether the secret fields are *applicable* cannot be decided here, and this
 * schema deliberately does not try: only a service-account credential stores a
 * rotatable secret, and the credential's type is known only once the row is
 * loaded, so there is no discriminant in the request to key a union on. The
 * refusal lives in `updateCredentialRecord`, which answers a `validation`
 * failure — a `400` on every surface — rather than dropping the field.
 */
const v2ServiceAccountSecretFieldsShape = {
  serviceAccountJson: z
    .string()
    .min(1)
    .max(65_536)
    .optional()
    .describe('Write-only Google service-account JSON key.')
    .meta({ writeOnly: true }),
  apiToken: z
    .string()
    .trim()
    .min(1)
    .max(8192)
    .optional()
    .describe('Write-only provider API token.')
    .meta({ writeOnly: true }),
  domain: z.string().trim().min(1).max(2048).optional().describe('Provider account domain.'),
  atlassianProduct: atlassianProductSchema
    .optional()
    .describe(
      'Atlassian product to verify; defaults to Jira on create and preserves the saved product on reconnect.'
    ),
  signingSecret: z
    .string()
    .trim()
    .min(1)
    .max(8192)
    .optional()
    .describe('Write-only webhook signing secret.')
    .meta({ writeOnly: true }),
  botToken: z
    .string()
    .trim()
    .min(1)
    .max(8192)
    .optional()
    .describe('Write-only bot token.')
    .meta({ writeOnly: true }),
  clientId: z.string().trim().min(1).max(512).optional().describe('OAuth client identifier.'),
  clientSecret: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .optional()
    .describe('Write-only OAuth client secret.')
    .meta({ writeOnly: true }),
  certificateId: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe('Provider certificate mapping identifier.'),
  orgId: z.string().trim().min(1).max(255).optional().describe('Provider organization ID.'),
  dataCenter: z.string().trim().min(1).max(32).optional().describe('Provider data center.'),
  authMethod: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe('Provider authentication method.'),
  privateKey: z
    .string()
    .trim()
    .min(1)
    .max(8192)
    .optional()
    .describe('Write-only PEM private key.')
    .meta({ writeOnly: true }),
  username: z.string().trim().min(1).max(255).optional().describe('Provider run-as username.'),
} as const

export const v2UpdateCredentialBodySchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'displayName cannot be empty')
      .max(255, 'displayName must be at most 255 characters')
      .optional()
      .describe('New name shown for the credential in Sim.'),
    description: z
      .string()
      .trim()
      .max(500, 'description must be at most 500 characters')
      .nullable()
      .optional()
      .describe('New credential description. Send null to clear the stored one.'),
    ...v2ServiceAccountSecretFieldsShape,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (Object.values(body).every((value) => value === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Provide at least one of displayName, description, or a service-account secret field',
      })
    }
  })
export type V2UpdateCredentialBody = z.input<typeof v2UpdateCredentialBodySchema>

/** Rotates secret material or renames a credential while preserving its ID. */
export const v2UpdateCredentialContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/credentials/[credentialId]',
  params: v2UpdateCredentialParamsSchema,
  query: v2UpdateCredentialQuerySchema,
  body: v2UpdateCredentialBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CredentialSchema),
  },
})

export const v2DeleteCredentialContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/credentials/[credentialId]',
  params: v2DeleteCredentialParamsSchema,
  query: v2DeleteCredentialQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CredentialDeleteDataSchema),
  },
})
