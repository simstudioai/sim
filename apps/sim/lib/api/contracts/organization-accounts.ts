import { z } from 'zod'
import {
  createCredentialGroupMcpConnectorBodySchema,
  credentialGroupEnrollmentDetailSchema,
  credentialGroupEnrollmentSchema,
  credentialGroupMcpServerSchema,
  credentialGroupOptionInputSchema,
  credentialGroupProviderSchema,
  credentialGroupSchema,
  inviteCredentialGroupEnrollmentsBodySchema,
  inviteCredentialGroupEnrollmentsContract,
  managedMcpConnectorIdSchema,
  startSlackCredentialGroupConfigurationBodySchema,
  startSlackCredentialGroupConfigurationContract,
  updateCredentialGroupBodySchema,
} from '@/lib/api/contracts/credential-groups'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  ORGANIZATION_ACCOUNT_INDEXING_SOURCE_LIMIT,
  ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT,
} from '@/lib/credential-groups/limits'

const organizationAccountsParamsSchema = z.object({ id: organizationIdSchema })
const organizationCredentialGroupSchema = credentialGroupSchema.extend({
  workspaceId: z.null(),
  organizationId: organizationIdSchema,
})
const organizationAccountsResponseSchema = z.object({
  credentialGroup: organizationCredentialGroupSchema,
})

export const getOrganizationAccountsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/connected-accounts',
  params: organizationAccountsParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      credentialGroup: organizationCredentialGroupSchema.nullable(),
      availableProviders: z.array(credentialGroupProviderSchema),
      canManage: z.boolean(),
      indexingAvailable: z.boolean(),
    }),
  },
})
export const ensureOrganizationAccountsContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/connected-accounts',
  params: organizationAccountsParamsSchema,
  body: z.object({ option: credentialGroupOptionInputSchema.optional() }).strict(),
  response: { mode: 'json', schema: organizationAccountsResponseSchema },
})
export const updateOrganizationAccountsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/organizations/[id]/connected-accounts/[groupId]',
  params: organizationAccountsParamsSchema.extend({ groupId: z.string().min(1).max(128) }),
  body: updateCredentialGroupBodySchema,
  response: { mode: 'json', schema: organizationAccountsResponseSchema },
})
export const startOrganizationAccountConnectionContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/connected-accounts/connect',
  params: organizationAccountsParamsSchema,
  body: z.object({ optionId: z.string().min(1, 'Account option is required').max(128) }).strict(),
  response: { mode: 'json', schema: z.object({ invitationLink: z.string().url() }) },
})

export const startOrganizationSlackConfigurationContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/connected-accounts/[groupId]/slack-managed-users',
  params: organizationAccountsParamsSchema.extend({ groupId: z.string().min(1).max(128) }),
  body: startSlackCredentialGroupConfigurationBodySchema
    .omit({ slackBotCredentialId: true })
    .required({ appId: true, teamId: true }),
  response: startSlackCredentialGroupConfigurationContract.response,
})
export type OrganizationAccountsSettings = z.output<
  typeof getOrganizationAccountsContract.response.schema
>

export const updateOrganizationAccountIndexingContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/connected-accounts/indexing',
  params: organizationAccountsParamsSchema,
  body: z
    .object({
      optionId: z.string().min(1, 'Provider option is required').max(128),
      enabled: z.boolean(),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: z.object({
      enabled: z.boolean(),
      knowledgeBaseIds: z
        .array(z.string().min(1).max(128))
        .max(ORGANIZATION_ACCOUNT_INDEXING_SOURCE_LIMIT),
    }),
  },
})
export type UpdateOrganizationAccountIndexingBody = z.input<
  NonNullable<typeof updateOrganizationAccountIndexingContract.body>
>
export type EnsureOrganizationAccountsBody = z.input<
  NonNullable<typeof ensureOrganizationAccountsContract.body>
>
export type UpdateOrganizationAccountsBody = z.input<typeof updateCredentialGroupBodySchema>

export const organizationAccountWorkspaceAccessSchema = z.object({
  revision: z.number().int().positive(),
  workspaceIds: z
    .array(workspaceIdSchema)
    .max(ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length, 'Workspace IDs must be unique'),
})
export const getOrganizationAccountWorkspaceAccessContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/connected-accounts/workspace-access',
  params: organizationAccountsParamsSchema,
  response: {
    mode: 'json',
    schema: organizationAccountWorkspaceAccessSchema.extend({
      workspaces: z
        .array(z.object({ id: workspaceIdSchema, name: z.string().max(256) }))
        .max(ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT),
    }),
  },
})
export const updateOrganizationAccountWorkspaceAccessContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/connected-accounts/workspace-access',
  params: organizationAccountsParamsSchema,
  body: organizationAccountWorkspaceAccessSchema.strict(),
  response: { mode: 'json', schema: organizationAccountWorkspaceAccessSchema },
})
export type OrganizationAccountWorkspaceAccess = z.output<
  typeof getOrganizationAccountWorkspaceAccessContract.response.schema
>
export type UpdateOrganizationAccountWorkspaceAccessBody = z.input<
  NonNullable<typeof updateOrganizationAccountWorkspaceAccessContract.body>
>

export const listOrganizationAccountPeopleContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/connected-accounts/people',
  params: organizationAccountsParamsSchema,
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
    email: z.string().trim().max(320).optional(),
    search: z.string().trim().max(320).optional(),
    optionId: z.string().min(1, 'Provider option is required').max(128).optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({
      enrollments: z.array(credentialGroupEnrollmentDetailSchema).max(100),
      nextCursor: z.string().nullable(),
    }),
  },
})
export const inviteOrganizationAccountPeopleContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/connected-accounts/people',
  params: organizationAccountsParamsSchema,
  body: inviteCredentialGroupEnrollmentsBodySchema.extend({
    optionId: z.string().min(1, 'Provider option is required').max(128).optional(),
  }),
  response: inviteCredentialGroupEnrollmentsContract.response,
})
const organizationAccountEnrollmentParamsSchema = organizationAccountsParamsSchema.extend({
  enrollmentId: z.string().min(1, 'Enrollment ID is required').max(128),
})
export const resendOrganizationAccountInvitationContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/connected-accounts/people/[enrollmentId]/resend',
  params: organizationAccountEnrollmentParamsSchema,
  query: z.object({
    optionId: z.string().min(1, 'Provider option is required').max(128).optional(),
  }),
  response: {
    mode: 'json',
    schema: z.object({ credentialGroupEnrollment: credentialGroupEnrollmentSchema }),
  },
})
export const revokeOrganizationAccountEnrollmentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/connected-accounts/people/[enrollmentId]',
  params: organizationAccountEnrollmentParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ credentialGroupEnrollment: credentialGroupEnrollmentSchema }),
  },
})
export const addOrganizationAccountMcpProviderContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/connected-accounts/mcp-providers',
  params: organizationAccountsParamsSchema,
  body: createCredentialGroupMcpConnectorBodySchema,
  response: { mode: 'json', schema: z.object({ mcpServer: credentialGroupMcpServerSchema }) },
})
export const removeOrganizationAccountMcpProviderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/connected-accounts/mcp-providers/[connectorId]',
  params: organizationAccountsParamsSchema.extend({ connectorId: managedMcpConnectorIdSchema }),
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
export type OrganizationAccountPeoplePage = z.output<
  typeof listOrganizationAccountPeopleContract.response.schema
>
export type OrganizationAccountPeopleQuery = z.input<
  NonNullable<typeof listOrganizationAccountPeopleContract.query>
>
export type InviteOrganizationAccountPeopleBody = z.input<
  NonNullable<typeof inviteOrganizationAccountPeopleContract.body>
>
export type ResendOrganizationAccountInvitationQuery = z.input<
  NonNullable<typeof resendOrganizationAccountInvitationContract.query>
>
export type AddOrganizationAccountMcpProviderBody = z.input<
  NonNullable<typeof addOrganizationAccountMcpProviderContract.body>
>
export type RemoveOrganizationAccountMcpProviderParams = z.input<
  NonNullable<typeof removeOrganizationAccountMcpProviderContract.params>
>

export const configureOrganizationMcpContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/connected-accounts/databricks',
  params: organizationAccountsParamsSchema,
  body: z
    .object({
      url: z.string().trim().min(1, 'Databricks MCP endpoint is required').max(2048).url(),
      oauthClientId: z.string().trim().min(1, 'OAuth client ID is required').max(2048),
      oauthClientSecret: z.string().min(1).max(8192).nullable().optional(),
      name: z.string().trim().min(1).max(256).optional(),
    })
    .strict(),
  response: { mode: 'json', schema: z.object({ mcpServer: credentialGroupMcpServerSchema }) },
})
export type ConfigureOrganizationMcpBody = z.input<
  NonNullable<typeof configureOrganizationMcpContract.body>
>

export const getOrganizationDatabricksSetupContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/connected-accounts/databricks',
  params: organizationAccountsParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      server: z.object({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(256),
        url: z.string().max(2048).nullable(),
        oauthClientId: z.string().max(2048).nullable(),
        hasOauthClientSecret: z.boolean(),
        enabled: z.boolean(),
      }),
    }),
  },
})
export type OrganizationDatabricksSetup = z.output<
  typeof getOrganizationDatabricksSetupContract.response.schema
>

export const getWorkspaceOrganizationAccountsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/organization-accounts',
  params: z.object({ id: workspaceIdSchema }),
  response: {
    mode: 'json',
    schema: z.object({
      organizationId: organizationIdSchema.nullable(),
      organizationName: z.string().nullable(),
      available: z.boolean(),
      allowed: z.boolean(),
      canManage: z.boolean(),
      providers: z.array(z.object({ id: z.string(), label: z.string() })),
      mcpProviders: z.array(z.object({ id: z.string(), label: z.string() })),
    }),
  },
})
export type WorkspaceOrganizationAccounts = z.output<
  typeof getWorkspaceOrganizationAccountsContract.response.schema
>

export const personalOrganizationAccountSchema = z.object({
  credentialId: z.string().min(1).max(128),
  displayName: z.string(),
  providerId: z.string().min(1),
  kind: z.enum(['oauth', 'mcp']),
  status: z.enum(['active', 'needs_reauth', 'revoked']),
  organizationId: organizationIdSchema,
  organizationName: z.string(),
  enrollmentStatus: z.enum(['invited', 'delivery_failed', 'in_progress', 'completed', 'revoked']),
  canReconnect: z.boolean(),
})
export const listPersonalOrganizationAccountsContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/organization-accounts',
  query: z.object({ cursor: z.string().min(1).max(128).optional() }),
  response: {
    mode: 'json',
    schema: z.object({
      accounts: z.array(personalOrganizationAccountSchema).max(50),
      nextCursor: z.string().nullable(),
    }),
  },
})
export const reconnectPersonalOrganizationAccountContract = defineRouteContract({
  method: 'POST',
  path: '/api/users/me/organization-accounts/[credentialId]/reconnect',
  params: z.object({ credentialId: z.string().min(1).max(128) }),
  response: { mode: 'json', schema: z.object({ invitationLink: z.string().url() }) },
})
export const disconnectPersonalOrganizationAccountContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/users/me/organization-accounts/[credentialId]',
  params: z.object({ credentialId: z.string().min(1).max(128) }),
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
export type PersonalOrganizationAccount = z.output<typeof personalOrganizationAccountSchema>
