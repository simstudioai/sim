import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  ATLASSIAN_PRODUCTS,
  getServiceAccountRequiredFields,
} from '@/lib/credentials/service-account-fields'
import type { OAuthProvider } from '@/lib/oauth/types'

export const atlassianProductSchema = z.enum(ATLASSIAN_PRODUCTS)
export type AtlassianProduct = z.output<typeof atlassianProductSchema>

const ENV_VAR_NAME_REGEX = /^[A-Za-z0-9_]+$/

export function normalizeCredentialEnvKey(raw: string): string {
  const trimmed = raw.trim()
  const wrappedMatch = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(trimmed)
  return wrappedMatch ? wrappedMatch[1] : trimmed
}

export const workspaceCredentialTypeSchema = z.enum([
  'oauth',
  'env_workspace',
  'env_personal',
  'service_account',
  'personal_token',
])
const creatableWorkspaceCredentialTypeSchema = z.enum([
  'oauth',
  'env_workspace',
  'env_personal',
  'service_account',
  'personal_token',
])
export const workspaceCredentialRoleSchema = z.enum(['admin', 'member'])
export const workspaceCredentialMemberStatusSchema = z.enum(['active', 'pending', 'revoked'])
export const workspaceCredentialSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: workspaceCredentialTypeSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  /** True when an env_workspace secret opts out of redaction; always false for other types. */
  unredacted: z.boolean(),
  providerId: z.string().nullable(),
  accountId: z.string().nullable(),
  envKey: z.string().nullable(),
  envOwnerUserId: z.string().nullable(),
  instanceUrl: z.string().url().optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  role: workspaceCredentialRoleSchema.optional(),
  status: workspaceCredentialMemberStatusSchema.optional(),
})

export type WorkspaceCredentialType = z.output<typeof workspaceCredentialTypeSchema>
export type WorkspaceCredentialRole = z.output<typeof workspaceCredentialRoleSchema>
export type WorkspaceCredentialMemberStatus = z.output<typeof workspaceCredentialMemberStatusSchema>
export type WorkspaceCredential = z.output<typeof workspaceCredentialSchema>

const firstQueryStringSchema = z
  .union([z.string(), z.array(z.string()).min(1)])
  .transform((value) => (Array.isArray(value) ? value[0] : value))

function trimmedOptionalQueryString<T extends z.ZodType<string, string>>(schema: T) {
  return firstQueryStringSchema
    .transform((value) => value.trim() || undefined)
    .pipe(schema.optional())
    .optional()
}

export const credentialsListQuerySchema = z.object({
  workspaceId: firstQueryStringSchema
    .transform((value) => value.trim())
    .pipe(z.string().uuid('Workspace ID must be a valid UUID')),
  type: trimmedOptionalQueryString(workspaceCredentialTypeSchema),
  providerId: trimmedOptionalQueryString(z.string()),
  credentialId: trimmedOptionalQueryString(z.string()),
})

export const credentialIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const serviceAccountJsonSchema = z
  .string()
  .min(1, 'Service account JSON key is required')
  .transform((val, ctx) => {
    try {
      const parsed = JSON.parse(val)
      if (parsed.type !== 'service_account') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JSON key must have type "service_account"',
        })
        return z.NEVER
      }
      if (!parsed.client_email || typeof parsed.client_email !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JSON key must contain a valid client_email',
        })
        return z.NEVER
      }
      if (!parsed.private_key || typeof parsed.private_key !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JSON key must contain a valid private_key',
        })
        return z.NEVER
      }
      if (!parsed.project_id || typeof parsed.project_id !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JSON key must contain a valid project_id',
        })
        return z.NEVER
      }
      return parsed as {
        type: 'service_account'
        client_email: string
        private_key: string
        project_id: string
        [key: string]: unknown
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid JSON format',
      })
      return z.NEVER
    }
  })

export const createCredentialFieldsSchema = z.object({
  workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
  type: creatableWorkspaceCredentialTypeSchema,
  displayName: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(500).optional(),
  providerId: z.string().trim().min(1).optional(),
  accountId: z.string().trim().min(1).optional(),
  envKey: z.string().trim().min(1).optional(),
  envOwnerUserId: z.string().trim().min(1).optional(),
  serviceAccountJson: z.string().optional(),
  apiToken: z.string().trim().min(1).optional(),
  domain: z.string().trim().min(1).optional(),
  atlassianProduct: atlassianProductSchema.optional(),
  /**
   * Client-supplied credential id, honored only for `slack-custom-bot` creates:
   * the setup modal shows the ingest URL `/api/webhooks/slack/custom/{id}`
   * before secrets exist, so the id must be known up front.
   */
  id: z.string().uuid('id must be a valid UUID').optional(),
  signingSecret: z.string().trim().min(1).optional(),
  botToken: z.string().trim().min(1).optional(),
  clientId: z.string().trim().min(1).max(512).optional(),
  clientSecret: z.string().trim().min(1).max(1024).optional(),
  certificateId: z.string().trim().min(1).max(512).optional(),
  orgId: z.string().trim().min(1).max(255).optional(),
  /** Optional provider region selector (Zoho Desk data center). */
  dataCenter: z.string().trim().min(1).max(32).optional(),
  /**
   * Grant selector for providers offering more than one server-to-server
   * flow (Salesforce: `client_credentials` | `jwt_bearer`). The descriptor's
   * option list is the real allowlist — an unrecognized value resolves to the
   * provider's default rather than failing, so this only bounds length.
   */
  authMethod: z.string().trim().min(1).max(64).optional(),
  /** PEM private key for certificate/JWT-based grants (for example Salesforce or NetSuite). */
  privateKey: z.string().trim().min(1).max(8192).optional(),
  /** Run-as username for key-based grants (Salesforce JWT `sub`). */
  username: z.string().trim().min(1).max(255).optional(),
})

export function refineCredentialCreate(
  data: Omit<z.input<typeof createCredentialFieldsSchema>, 'workspaceId'>,
  ctx: z.RefinementCtx
) {
  if (data.type === 'oauth') {
    if (!data.accountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'accountId is required for oauth credentials',
        path: ['accountId'],
      })
    }
    if (!data.providerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'providerId is required for oauth credentials',
        path: ['providerId'],
      })
    }
    if (!data.displayName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'displayName is required for oauth credentials',
        path: ['displayName'],
      })
    }
    return
  }

  if (data.type === 'personal_token') {
    if (data.providerId !== 'gitlab')
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Personal tokens are supported for GitLab',
        path: ['providerId'],
      })
    if (!data.apiToken || data.apiToken.length > 4096)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a GitLab personal access token',
        path: ['apiToken'],
      })
    if (data.domain && data.domain.length > 255)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GitLab host is too long',
        path: ['domain'],
      })
    return
  }

  if (data.type === 'service_account') {
    for (const field of getServiceAccountRequiredFields(data.providerId)) {
      if (!data[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} is required for ${data.providerId ?? 'service account'} credentials`,
          path: [field],
        })
      }
    }
    return
  }

  const normalizedEnvKey = data.envKey ? normalizeCredentialEnvKey(data.envKey) : ''
  if (!normalizedEnvKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'envKey is required for env credentials',
      path: ['envKey'],
    })
    return
  }

  if (!ENV_VAR_NAME_REGEX.test(normalizedEnvKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'envKey must contain only letters, numbers, and underscores',
      path: ['envKey'],
    })
  }
}

export const createCredentialBodySchema =
  createCredentialFieldsSchema.superRefine(refineCredentialCreate)

export const updateCredentialByIdBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(500).nullish(),
    /** Workspace-secret redaction opt-out; rejected for every type but env_workspace. */
    unredacted: z.boolean().optional(),
    serviceAccountJson: z.string().min(1).optional(),
    /** Slack custom-bot secret rotation (reconnect). */
    signingSecret: z.string().trim().min(1).optional(),
    botToken: z.string().trim().min(1).optional(),
    /** Atlassian service-account secret rotation (reconnect). */
    apiToken: z.string().trim().min(1).optional(),
    domain: z.string().trim().min(1).optional(),
    atlassianProduct: atlassianProductSchema.optional(),
    /** Client-credential service-account secret rotation (reconnect). */
    clientId: z.string().trim().min(1).max(512).optional(),
    clientSecret: z.string().trim().min(1).max(1024).optional(),
    certificateId: z.string().trim().min(1).max(512).optional(),
    orgId: z.string().trim().min(1).max(255).optional(),
    dataCenter: z.string().trim().min(1).max(32).optional(),
    authMethod: z.string().trim().min(1).max(64).optional(),
    privateKey: z.string().trim().min(1).max(8192).optional(),
    username: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.displayName !== undefined ||
      data.description !== undefined ||
      data.unredacted !== undefined ||
      data.serviceAccountJson !== undefined ||
      data.signingSecret !== undefined ||
      data.botToken !== undefined ||
      data.apiToken !== undefined ||
      data.domain !== undefined ||
      data.atlassianProduct !== undefined ||
      data.clientId !== undefined ||
      data.clientSecret !== undefined ||
      data.certificateId !== undefined ||
      data.orgId !== undefined ||
      data.dataCenter !== undefined ||
      data.authMethod !== undefined ||
      data.privateKey !== undefined ||
      data.username !== undefined,
    {
      message: 'At least one field must be provided',
      path: ['displayName'],
    }
  )

export const leaveCredentialQuerySchema = z.object({
  credentialId: z.string().min(1),
})

export const credentialMembershipSchema = z.object({
  membershipId: z.string(),
  credentialId: z.string(),
  workspaceId: z.string(),
  type: workspaceCredentialTypeSchema,
  displayName: z.string(),
  providerId: z.string().nullable(),
  role: workspaceCredentialRoleSchema,
  status: workspaceCredentialMemberStatusSchema,
  joinedAt: z.string().nullable(),
})

export const workspaceCredentialMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: workspaceCredentialRoleSchema,
  status: workspaceCredentialMemberStatusSchema,
  joinedAt: z.string().nullable(),
  invitedBy: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  userImage: z.string().nullable().optional(),
  /** `workspace-admin` roles are derived from workspace admin and cannot be changed. */
  roleSource: z.enum(['explicit', 'workspace-admin']).optional(),
})

export type WorkspaceCredentialMember = z.output<typeof workspaceCredentialMemberSchema>

export const quickBooksOAuthClientConfigSchema = z
  .object({
    clientId: z
      .string({ error: 'QuickBooks client ID is required' })
      .trim()
      .min(1, 'QuickBooks client ID is required')
      .max(255, 'QuickBooks client ID must be at most 255 characters')
      .describe('Client ID for the caller-managed Intuit OAuth application.'),
    clientSecret: z
      .string({ error: 'QuickBooks client secret is required' })
      .trim()
      .min(1, 'QuickBooks client secret is required')
      .max(512, 'QuickBooks client secret must be at most 512 characters')
      .describe('Write-only client secret for the caller-managed Intuit OAuth application.')
      .meta({ writeOnly: true }),
    environment: z
      .enum(['sandbox', 'production'], {
        error: 'QuickBooks environment must be sandbox or production',
      })
      .describe('Intuit company environment used for authorization and API requests.'),
    webhookVerifierToken: z
      .string({ error: 'QuickBooks webhook verifier token is required' })
      .trim()
      .min(1, 'QuickBooks webhook verifier token is required')
      .max(512, 'QuickBooks webhook verifier token must be at most 512 characters')
      .describe('Write-only verifier token for webhook signatures from the caller-managed app.')
      .meta({ writeOnly: true }),
  })
  .strict()

export type QuickBooksOAuthClientConfigInput = z.input<typeof quickBooksOAuthClientConfigSchema>

export function refineOAuthClientConfigForProvider(
  value: {
    providerId: string
    oauthClientConfig?: QuickBooksOAuthClientConfigInput
  },
  ctx: z.RefinementCtx
): void {
  if (value.providerId === 'quickbooks' && !value.oauthClientConfig) {
    ctx.addIssue({
      code: 'custom',
      path: ['oauthClientConfig'],
      message: 'oauthClientConfig is required for QuickBooks',
    })
  }
  if (value.providerId !== 'quickbooks' && value.oauthClientConfig) {
    ctx.addIssue({
      code: 'custom',
      path: ['oauthClientConfig'],
      message: 'oauthClientConfig is only supported for QuickBooks',
    })
  }
}

export const createCredentialDraftBodySchema = z
  .object({
    workspaceId: z.string().min(1),
    providerId: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().trim().max(500).optional(),
    credentialId: z.string().min(1).optional(),
    oauthClientConfig: quickBooksOAuthClientConfigSchema.optional(),
  })
  .superRefine(refineOAuthClientConfigForProvider)

export const upsertWorkspaceCredentialMemberBodySchema = z.object({
  userId: z.string().min(1),
  role: workspaceCredentialRoleSchema.default('member'),
})

export const removeWorkspaceCredentialMemberQuerySchema = z.object({
  userId: z.string().min(1),
})

export const oauthCredentialSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.custom<OAuthProvider>((value) => typeof value === 'string'),
  type: z.enum(['oauth', 'service_account']).optional(),
  serviceId: z.string().optional(),
  lastUsed: z.string().optional(),
  isDefault: z.boolean().optional(),
  scopes: z.array(z.string()).optional(),
})

export const workspaceCredentialLookupSchema = workspaceCredentialSchema.pick({
  id: true,
  displayName: true,
  type: true,
  providerId: true,
})
export type WorkspaceCredentialLookup = z.output<typeof workspaceCredentialLookupSchema>

export const oauthCredentialsQuerySchema = z
  .object({
    provider: z.string().nullish(),
    workflowId: z.string().uuid('Workflow ID must be a valid UUID').nullish(),
    workspaceId: z.string().uuid('Workspace ID must be a valid UUID').nullish(),
    credentialId: z.string().min(1, 'Credential ID must not be empty').max(255).nullish(),
  })
  .refine((data) => data.provider || data.credentialId, {
    message: 'Provider or credentialId is required',
    path: ['provider'],
  })

export const listWorkspaceCredentialsContract = defineRouteContract({
  method: 'GET',
  path: '/api/credentials',
  query: credentialsListQuerySchema,
  response: {
    mode: 'json',
    schema: z.union([
      z.object({ credentials: z.array(workspaceCredentialSchema) }),
      z.object({ credential: workspaceCredentialLookupSchema.nullable() }),
    ]),
  },
})

export const getWorkspaceCredentialContract = defineRouteContract({
  method: 'GET',
  path: '/api/credentials/[id]',
  params: credentialIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      credential: workspaceCredentialSchema.nullable(),
    }),
  },
})

export const listOAuthCredentialsContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/oauth/credentials',
  query: oauthCredentialsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentials: z.array(oauthCredentialSchema),
    }),
  },
})

export const listWorkspaceCredentialMembersContract = defineRouteContract({
  method: 'GET',
  path: '/api/credentials/[id]/members',
  params: credentialIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      members: z.array(workspaceCredentialMemberSchema).optional(),
    }),
  },
})

export const createCredentialDraftContract = defineRouteContract({
  method: 'POST',
  path: '/api/credentials/draft',
  body: createCredentialDraftBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      draftId: z.string().min(1),
    }),
  },
})

export const createWorkspaceCredentialContract = defineRouteContract({
  method: 'POST',
  path: '/api/credentials',
  body: createCredentialBodySchema,
  response: {
    mode: 'json',
    status: [200, 201],
    schema: z.object({
      credential: workspaceCredentialSchema,
    }),
  },
})

export const updateWorkspaceCredentialContract = defineRouteContract({
  method: 'PUT',
  path: '/api/credentials/[id]',
  params: credentialIdParamsSchema,
  body: updateCredentialByIdBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credential: workspaceCredentialSchema.nullable(),
    }),
  },
})

export const deleteWorkspaceCredentialContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/credentials/[id]',
  params: credentialIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const upsertWorkspaceCredentialMemberContract = defineRouteContract({
  method: 'POST',
  path: '/api/credentials/[id]/members',
  params: credentialIdParamsSchema,
  body: upsertWorkspaceCredentialMemberBodySchema,
  response: {
    mode: 'json',
    status: [200, 201],
    schema: z.object({
      success: z.literal(true),
      member: workspaceCredentialMemberSchema.optional(),
    }),
  },
})

export const removeWorkspaceCredentialMemberContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/credentials/[id]/members',
  params: credentialIdParamsSchema,
  query: removeWorkspaceCredentialMemberQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const listCredentialMembershipsContract = defineRouteContract({
  method: 'GET',
  path: '/api/credentials/memberships',
  response: {
    mode: 'json',
    schema: z.object({ memberships: z.array(credentialMembershipSchema) }),
  },
})

export const leaveCredentialMembershipContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/credentials/memberships',
  query: leaveCredentialQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }),
  },
})

export const personalCredentialSchema = z.object({
  id: z.string().min(1).max(255),
  providerId: z.string().min(1).max(100),
  displayName: z.string(),
  type: z.enum(['oauth', 'managed_oauth', 'personal_token']),
  updatedAt: z.string().datetime(),
  connectedAt: z.string().datetime(),
  instanceUrl: z.string().url().optional(),
})
export type PersonalCredential = z.output<typeof personalCredentialSchema>

export const listPersonalCredentialsContract = defineRouteContract({
  method: 'GET',
  path: '/api/credentials/personal',
  query: z.object({ workspaceId: workspaceIdSchema }),
  response: { mode: 'json', schema: z.object({ credentials: z.array(personalCredentialSchema) }) },
})

export const startPersonalCredentialConnectionBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  providerId: z.string().trim().min(1, 'Provider is required').max(100),
  credentialId: z.string().min(1, 'Credential ID must not be empty').max(255).optional(),
})
export type StartPersonalCredentialConnectionBody = z.input<
  typeof startPersonalCredentialConnectionBodySchema
>

export const startPersonalCredentialConnectionContract = defineRouteContract({
  method: 'POST',
  path: '/api/credentials/personal/connect',
  body: startPersonalCredentialConnectionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ url: z.string().url(), providerId: z.string().min(1).max(100) }),
  },
})
