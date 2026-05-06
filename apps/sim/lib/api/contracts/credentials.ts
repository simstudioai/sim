import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID, type OAuthProvider } from '@/lib/oauth/types'

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
])
export const workspaceCredentialRoleSchema = z.enum(['admin', 'member'])
export const workspaceCredentialMemberStatusSchema = z.enum(['active', 'pending', 'revoked'])

export const workspaceCredentialSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: workspaceCredentialTypeSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  providerId: z.string().nullable(),
  accountId: z.string().nullable(),
  envKey: z.string().nullable(),
  envOwnerUserId: z.string().nullable(),
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

export const credentialsListQuerySchema = z.object({
  workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
  type: workspaceCredentialTypeSchema.optional(),
  providerId: z.string().optional(),
})

export const credentialIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const credentialsListGetQuerySchema = z.object({
  workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
  type: workspaceCredentialTypeSchema.optional(),
  providerId: z.string().optional(),
  credentialId: z.string().optional(),
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

export const createCredentialBodySchema = z
  .object({
    workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
    type: workspaceCredentialTypeSchema,
    displayName: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(500).optional(),
    providerId: z.string().trim().min(1).optional(),
    accountId: z.string().trim().min(1).optional(),
    envKey: z.string().trim().min(1).optional(),
    envOwnerUserId: z.string().trim().min(1).optional(),
    serviceAccountJson: z.string().optional(),
    apiToken: z.string().trim().min(1).optional(),
    domain: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
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

    if (data.type === 'service_account') {
      if (data.providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) {
        if (!data.apiToken) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'apiToken is required for Atlassian service account credentials',
            path: ['apiToken'],
          })
        }
        if (!data.domain) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'domain is required for Atlassian service account credentials',
            path: ['domain'],
          })
        }
        return
      }
      if (!data.serviceAccountJson) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'serviceAccountJson is required for service account credentials',
          path: ['serviceAccountJson'],
        })
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
  })

export const updateCredentialByIdBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(500).nullish(),
    serviceAccountJson: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.displayName !== undefined ||
      data.description !== undefined ||
      data.serviceAccountJson !== undefined,
    {
      message: 'At least one field must be provided',
      path: ['displayName'],
    }
  )

export const leaveCredentialQuerySchema = z.object({
  credentialId: z.string().min(1),
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
})

export type WorkspaceCredentialMember = z.output<typeof workspaceCredentialMemberSchema>

export const createCredentialDraftBodySchema = z.object({
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().trim().max(500).optional(),
  credentialId: z.string().min(1).optional(),
})

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
    schema: z.object({
      credentials: z.array(workspaceCredentialSchema),
    }),
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
    }),
  },
})

export const createWorkspaceCredentialContract = defineRouteContract({
  method: 'POST',
  path: '/api/credentials',
  body: createCredentialBodySchema,
  response: {
    mode: 'json',
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
