import { z } from 'zod'
import {
  MAX_OAUTH_CODE_LENGTH,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  CREDENTIAL_GROUP_MCP_SERVER_LIMIT,
  CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT,
  CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT,
  CREDENTIAL_GROUP_WORKFLOW_NAME_MAX_LENGTH,
} from '@/lib/credential-groups/limits'
import { MANAGED_MCP_CONNECTOR_IDS } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS,
} from '@/lib/credential-groups/providers'

export const credentialGroupProviderSchema = z.enum(CREDENTIAL_GROUP_PROVIDER_IDS)
export const credentialGroupStatusSchema = z.enum(['active', 'disabled'])
export const credentialGroupEnrollmentStatusSchema = z.enum([
  'invited',
  'delivery_failed',
  'in_progress',
  'completed',
  'revoked',
])
export const credentialGroupOptionConfigurationStatusSchema = z.enum([
  'not_configured',
  'ready',
  'needs_update',
])
export const managedMcpConnectorIdSchema = z.enum(MANAGED_MCP_CONNECTOR_IDS)

const credentialGroupOptionFields = {
  label: z.string().trim().min(1, 'Option label is required').max(100),
  required: z.boolean(),
} as const

const standardOAuthCredentialGroupOptionInputSchema = z
  .object({
    provider: z.enum(CREDENTIAL_GROUP_STANDARD_OAUTH_PROVIDER_IDS),
    ...credentialGroupOptionFields,
  })
  .strict()

const slackCredentialGroupOptionInputSchema = z
  .object({
    provider: z.literal('slack'),
    ...credentialGroupOptionFields,
    slackBotCredentialId: z.string().uuid('Select a custom Slack bot').optional(),
  })
  .strict()

export const credentialGroupOptionInputSchema = z.discriminatedUnion('provider', [
  standardOAuthCredentialGroupOptionInputSchema,
  slackCredentialGroupOptionInputSchema,
])

export const credentialGroupOptionSchema = z.discriminatedUnion('provider', [
  standardOAuthCredentialGroupOptionInputSchema.extend({
    id: z.string().min(1),
    status: z.enum(['active', 'disabled']),
    configurationStatus: credentialGroupOptionConfigurationStatusSchema,
  }),
  slackCredentialGroupOptionInputSchema.extend({
    id: z.string().min(1),
    status: z.enum(['active', 'disabled']),
    configurationStatus: credentialGroupOptionConfigurationStatusSchema,
    requiredScopes: z.array(z.string().min(1).max(255)).max(100).optional(),
  }),
])

export const credentialGroupOptionUpdateInputSchema = z.discriminatedUnion('provider', [
  standardOAuthCredentialGroupOptionInputSchema.extend({
    id: z.string().min(1).max(128).optional(),
  }),
  slackCredentialGroupOptionInputSchema.extend({ id: z.string().min(1).max(128).optional() }),
])

export const credentialGroupMcpServerSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1),
  description: z.string().nullable(),
  authType: z.string().min(1),
  enabled: z.boolean(),
  managedConnectorId: managedMcpConnectorIdSchema,
})

export const credentialGroupSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  options: z.array(credentialGroupOptionSchema).max(CREDENTIAL_GROUP_PROVIDER_IDS.length),
  mcpServers: z.array(credentialGroupMcpServerSchema).max(CREDENTIAL_GROUP_MCP_SERVER_LIMIT),
  status: credentialGroupStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type CredentialGroup = z.output<typeof credentialGroupSchema>
export type CredentialGroupOption = z.output<typeof credentialGroupOptionSchema>
export type CredentialGroupOptionInput = z.input<typeof credentialGroupOptionInputSchema>
export type CredentialGroupMcpServer = z.output<typeof credentialGroupMcpServerSchema>

export const credentialGroupEnrollmentSchema = z.object({
  id: z.string(),
  credentialGroupId: z.string(),
  email: z.string().email(),
  status: credentialGroupEnrollmentStatusSchema,
  expiresAt: z.string(),
  invitedAt: z.string(),
  sentAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  expired: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type CredentialGroupEnrollment = z.output<typeof credentialGroupEnrollmentSchema>

export const credentialGroupEnrollmentConnectionSchema = z.object({
  provider: z.union([credentialGroupProviderSchema, z.literal('gitlab')]),
  status: z.enum(['active', 'needs_reauth', 'revoked']),
  count: z.number().int().positive(),
})

export const credentialGroupEnrollmentMcpConnectionSchema = z.object({
  mcpServerId: z.string().min(1).max(128),
  name: z.string().min(1).max(255),
  status: z.enum(['active', 'needs_reauth', 'revoked']),
})

export const credentialGroupEnrollmentDetailSchema = credentialGroupEnrollmentSchema.extend({
  connections: z
    .array(credentialGroupEnrollmentConnectionSchema)
    .max((CREDENTIAL_GROUP_PROVIDER_IDS.length + 1) * 3),
  mcpConnections: z
    .array(credentialGroupEnrollmentMcpConnectionSchema)
    .max(CREDENTIAL_GROUP_MCP_SERVER_LIMIT),
})

export type CredentialGroupEnrollmentConnection = z.output<
  typeof credentialGroupEnrollmentConnectionSchema
>
export type CredentialGroupEnrollmentMcpConnection = z.output<
  typeof credentialGroupEnrollmentMcpConnectionSchema
>
export type CredentialGroupEnrollmentDetail = z.output<typeof credentialGroupEnrollmentDetailSchema>

export const credentialGroupAccessPolicySchema = z
  .object({
    revision: z.number().int().positive(),
    allowedWorkflowIds: z
      .array(
        workflowIdSchema
          .max(128, 'Workflow ID is too long')
          .refine((workflowId) => workflowId === workflowId.trim(), {
            message: 'Workflow ID must not have surrounding whitespace',
          })
      )
      .max(
        CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT,
        `Select at most ${CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT} workflows`
      )
      .superRefine((workflowIds, ctx) => {
        const seen = new Set<string>()
        for (const [index, workflowId] of workflowIds.entries()) {
          if (seen.has(workflowId)) {
            ctx.addIssue({
              code: 'custom',
              path: [index],
              message: 'Workflow selections must be unique',
            })
          }
          seen.add(workflowId)
        }
      }),
  })
  .strict()

export type CredentialGroupAccessPolicy = z.output<typeof credentialGroupAccessPolicySchema>

export const resourcePolicyWorkflowSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().max(CREDENTIAL_GROUP_WORKFLOW_NAME_MAX_LENGTH),
  })
  .strict()

export const credentialGroupAccessResponseSchema = credentialGroupAccessPolicySchema.extend({
  workflows: z.array(resourcePolicyWorkflowSchema).max(CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT),
})

export type CredentialGroupAccessResponse = z.output<typeof credentialGroupAccessResponseSchema>

export const updateCredentialGroupAccessBodySchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    allowedWorkflowIds: credentialGroupAccessPolicySchema.shape.allowedWorkflowIds,
  })
  .strict()

export type UpdateCredentialGroupAccessBody = z.input<typeof updateCredentialGroupAccessBodySchema>

export const credentialGroupWorkspaceParamsSchema = z.object({
  id: workspaceIdSchema,
})

export const credentialGroupDetailParamsSchema = credentialGroupWorkspaceParamsSchema.extend({
  groupId: z.string().min(1, 'Credential group ID is required').max(128),
})

export const credentialGroupMcpConnectorParamsSchema = credentialGroupDetailParamsSchema.extend({
  connectorId: managedMcpConnectorIdSchema,
})

export const credentialGroupEnrollmentParamsSchema = credentialGroupDetailParamsSchema.extend({
  enrollmentId: z.string().min(1, 'Enrollment ID is required').max(128),
})

export const publicCredentialGroupEnrollmentParamsSchema = z.object({
  token: z.string().min(1, 'Invitation token is required').max(128),
})

export const startCredentialGroupOAuthParamsSchema =
  publicCredentialGroupEnrollmentParamsSchema.extend({
    optionId: z.string().min(1, 'Credential option ID is required').max(128),
  })

export const startCredentialGroupMcpOAuthParamsSchema =
  publicCredentialGroupEnrollmentParamsSchema.extend({
    mcpServerId: z.string().min(1, 'MCP server ID is required').max(128),
  })

export const credentialGroupOAuthCallbackQuerySchema = z
  .object({
    state: z.string().min(1, 'OAuth state is required').max(512),
    code: z.string().min(1).max(MAX_OAUTH_CODE_LENGTH, 'Authorization code is too long').optional(),
    error: z.string().min(1).max(256).optional(),
    error_description: z.string().max(1000).optional(),
  })
  .superRefine((query, ctx) => {
    if (!query.code && !query.error) {
      ctx.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'OAuth callback must include a code or error',
      })
    }
  })

export const credentialGroupOAuthCallbackParamsSchema = z.object({
  provider: z.literal('slack'),
})

export const sharedCredentialGroupOAuthCallbackParamsSchema = z.object({
  providerId: z.string().min(1, 'OAuth provider ID is required').max(128),
})

export type CredentialGroupOAuthCallbackQuery = z.output<
  typeof credentialGroupOAuthCallbackQuerySchema
>

export const startSlackCredentialGroupConfigurationBodySchema = z
  .object({
    slackBotCredentialId: z.string().uuid('Select a custom Slack bot').optional(),
    appId: z
      .string()
      .regex(/^A[A-Z0-9]+$/, 'Enter the Slack App ID')
      .max(64)
      .optional(),
    teamId: z
      .string()
      .regex(/^T[A-Z0-9]+$/, 'Enter the Slack workspace ID')
      .max(64)
      .optional(),
    clientId: z.string().trim().min(1, 'Slack Client ID is required').max(256),
    clientSecret: z.string().trim().min(1, 'Slack Client Secret is required').max(512),
    requiredScopes: z.array(z.string().trim().min(1).max(255)).min(1).max(100).optional(),
  })
  .strict()

export const slackCredentialGroupConfigurationCallbackQuerySchema =
  credentialGroupOAuthCallbackQuerySchema

export const credentialGroupEnrollmentListQuerySchema = z.object({
  cursor: z.string().min(1, 'Enrollment cursor cannot be empty').max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const inviteCredentialGroupEnrollmentsBodySchema = z
  .object({
    emails: z
      .array(z.string().trim().email('Enter a valid email address').max(320))
      .min(1, 'At least one email address is required')
      .max(100, 'You can invite at most 100 people at once'),
  })
  .strict()

export type InviteCredentialGroupEnrollmentsBody = z.input<
  typeof inviteCredentialGroupEnrollmentsBodySchema
>

export const credentialGroupEnrollmentInviteResultSchema = z.discriminatedUnion('success', [
  z.object({
    email: z.string().email(),
    success: z.literal(true),
    enrollment: credentialGroupEnrollmentSchema,
  }),
  z.object({
    email: z.string().email(),
    success: z.literal(false),
    error: z.string(),
  }),
])

export const updateCredentialGroupBodySchema = z
  .object({
    options: z
      .array(credentialGroupOptionUpdateInputSchema)
      .max(CREDENTIAL_GROUP_PROVIDER_IDS.length)
      .optional(),
    status: credentialGroupStatusSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (Object.keys(body).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'At least one field must be updated' })
    }
    if (!body.options) return
    const labels = new Set<string>()
    const optionIds = new Set<string>()
    const providers = new Set<string>()
    for (const [index, option] of body.options.entries()) {
      const normalized = option.label.toLowerCase()
      if (labels.has(normalized)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', index, 'label'],
          message: 'Credential option labels must be unique within a group',
        })
      }
      labels.add(normalized)
      if (providers.has(option.provider)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', index, 'provider'],
          message: 'Each provider can only be added once',
        })
      }
      providers.add(option.provider)
      if (option.id && optionIds.has(option.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', index, 'id'],
          message: 'Credential option IDs must be unique within a group',
        })
      }
      if (option.id) optionIds.add(option.id)
    }
  })

export type UpdateCredentialGroupBody = z.input<typeof updateCredentialGroupBodySchema>

export const createCredentialGroupMcpConnectorBodySchema = z.discriminatedUnion('connectorId', [
  z.object({ connectorId: z.literal('fireflies') }).strict(),
  z.object({ connectorId: z.literal('granola') }).strict(),
  z
    .object({
      connectorId: z.literal('databricks'),
      name: z.string().trim().min(1, 'Name is required').max(100),
      url: z.string().trim().url('Enter a valid Databricks MCP URL').max(2048),
      oauthClientId: z.string().trim().min(1, 'OAuth Client ID is required').max(512),
      oauthClientSecret: z.string().trim().min(1).max(2048).optional(),
    })
    .strict(),
])

export type CreateCredentialGroupMcpConnectorBody = z.input<
  typeof createCredentialGroupMcpConnectorBodySchema
>

export const updateCredentialGroupMcpConnectorBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100).optional(),
    url: z.string().trim().url('Enter a valid Databricks MCP URL').max(2048).optional(),
    oauthClientId: z.string().trim().min(1, 'OAuth Client ID is required').max(512).optional(),
    oauthClientSecret: z.string().trim().min(1).max(2048).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be updated',
  })

export type UpdateCredentialGroupMcpConnectorBody = z.input<
  typeof updateCredentialGroupMcpConnectorBodySchema
>

export const workspaceAccountsSettingsSchema = z.object({
  credentialGroup: credentialGroupSchema.nullable(),
  /**
   * The providers this deployment has an OAuth client for. The settings picker offers only these,
   * so an admin is never shown an account type nobody could finish connecting.
   */
  availableProviders: z.array(credentialGroupProviderSchema),
})

export type WorkspaceAccountsSettings = z.output<typeof workspaceAccountsSettingsSchema>

export const getWorkspaceAccountsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/credential-groups',
  params: credentialGroupWorkspaceParamsSchema,
  response: { mode: 'json', schema: workspaceAccountsSettingsSchema },
})

export const ensureWorkspaceAccountsResponseSchema = z.object({
  credentialGroup: credentialGroupSchema,
})

export type EnsureWorkspaceAccountsResponse = z.output<typeof ensureWorkspaceAccountsResponseSchema>

export const ensureWorkspaceAccountsContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/credential-groups/ensure',
  params: credentialGroupWorkspaceParamsSchema,
  response: { mode: 'json', schema: ensureWorkspaceAccountsResponseSchema },
})

export const getCredentialGroupContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/credential-groups/[groupId]',
  params: credentialGroupDetailParamsSchema,
  query: credentialGroupEnrollmentListQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentialGroup: credentialGroupSchema,
      enrollments: z.array(credentialGroupEnrollmentDetailSchema),
      nextCursor: z.string().nullable(),
    }),
  },
})

export const inviteCredentialGroupEnrollmentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/enrollments',
  params: credentialGroupDetailParamsSchema,
  body: inviteCredentialGroupEnrollmentsBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      results: z.array(credentialGroupEnrollmentInviteResultSchema).min(1).max(100),
      sentCount: z.number().int().nonnegative(),
      failedCount: z.number().int().nonnegative(),
    }),
  },
})

export const resendCredentialGroupEnrollmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/enrollments/[enrollmentId]/resend',
  params: credentialGroupEnrollmentParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ credentialGroupEnrollment: credentialGroupEnrollmentSchema }),
  },
})

export const deleteCredentialGroupEnrollmentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/enrollments/[enrollmentId]',
  params: credentialGroupEnrollmentParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ credentialGroupEnrollment: credentialGroupEnrollmentSchema }),
  },
})

export const updateCredentialGroupContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/credential-groups/[groupId]',
  params: credentialGroupDetailParamsSchema,
  body: updateCredentialGroupBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ credentialGroup: credentialGroupSchema }),
  },
})

export const createCredentialGroupMcpConnectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/mcp-connectors',
  params: credentialGroupDetailParamsSchema,
  body: createCredentialGroupMcpConnectorBodySchema,
  response: {
    mode: 'json',
    status: 201,
    schema: z.object({ mcpServer: credentialGroupMcpServerSchema }),
  },
})

export const updateCredentialGroupMcpConnectorContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/mcp-connectors/[connectorId]',
  params: credentialGroupMcpConnectorParamsSchema,
  body: updateCredentialGroupMcpConnectorBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ mcpServer: credentialGroupMcpServerSchema }),
  },
})

export const deleteCredentialGroupMcpConnectorContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/mcp-connectors/[connectorId]',
  params: credentialGroupMcpConnectorParamsSchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})

export const getCredentialGroupAccessContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/access',
  params: credentialGroupDetailParamsSchema,
  response: { mode: 'json', schema: credentialGroupAccessResponseSchema },
})

export const updateCredentialGroupAccessContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/access',
  params: credentialGroupDetailParamsSchema,
  body: updateCredentialGroupAccessBodySchema,
  response: { mode: 'json', schema: credentialGroupAccessPolicySchema },
})

export type StartSlackCredentialGroupConfigurationBody = z.input<
  typeof startSlackCredentialGroupConfigurationBodySchema
>

export const startSlackCredentialGroupConfigurationContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/credential-groups/[groupId]/slack-managed-users',
  params: credentialGroupDetailParamsSchema,
  body: startSlackCredentialGroupConfigurationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      authorizationUrl: z.string().url(),
      state: z.string().min(1),
    }),
  },
})

export const slackCredentialGroupConfigurationCallbackContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-groups/slack-managed-users/callback',
  query: slackCredentialGroupConfigurationCallbackQuerySchema,
  response: { mode: 'text' },
})

export const startCredentialGroupOAuthQuerySchema = z.object({
  returnTo: z.enum(['search', 'accounts']).optional(),
})
export type StartCredentialGroupOAuthQuery = z.output<typeof startCredentialGroupOAuthQuerySchema>

export const startCredentialGroupOAuthContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-groups/enroll/[token]/oauth/[optionId]',
  params: startCredentialGroupOAuthParamsSchema,
  query: startCredentialGroupOAuthQuerySchema,
  response: { mode: 'empty' },
})

export const startCredentialGroupMcpOAuthContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-groups/enroll/[token]/mcp/[mcpServerId]',
  params: startCredentialGroupMcpOAuthParamsSchema,
  response: { mode: 'empty' },
})

export const completeCredentialGroupEnrollmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/credential-groups/enroll/[token]/complete',
  params: publicCredentialGroupEnrollmentParamsSchema,
  response: { mode: 'empty' },
})

export const credentialGroupOAuthCallbackContract = defineRouteContract({
  method: 'GET',
  path: '/api/credential-groups/oauth/[provider]/callback',
  params: credentialGroupOAuthCallbackParamsSchema,
  query: credentialGroupOAuthCallbackQuerySchema,
  response: { mode: 'empty' },
})

export const sharedCredentialGroupOAuthCallbackContract = defineRouteContract({
  method: 'GET',
  path: '/api/auth/oauth2/callback/[providerId]',
  params: sharedCredentialGroupOAuthCallbackParamsSchema,
  query: credentialGroupOAuthCallbackQuerySchema,
  response: { mode: 'redirect' },
})
