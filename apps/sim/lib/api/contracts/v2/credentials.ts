import { z } from 'zod'
import {
  normalizeCredentialEnvKey,
  workspaceCredentialRoleSchema,
  workspaceCredentialTypeSchema,
} from '@/lib/api/contracts/credentials'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'
import { getServiceAccountRequiredFields } from '@/lib/credentials/service-account-fields'

/**
 * v2 credential contracts.
 *
 * Secret material — service-account JSON, API tokens, signing secrets, bot
 * tokens, client secrets — is accepted on write and **never** returned on read,
 * the same treatment MCP request headers get. A read exposes only whether a
 * secret is stored (`hasServiceAccountKey`).
 *
 * `oauth` credentials cannot be created here: they are minted by the interactive
 * OAuth connect flow and are bound to an `account` row the caller authorized in
 * a browser. They are listed, read, updated, and deleted like any other type.
 *
 * Credential sharing (`/api/credentials/[id]/members`) is not part of this
 * surface.
 */

const ENV_VAR_NAME_REGEX = /^[A-Za-z0-9_]+$/

/** The types a public caller can create. `oauth` requires the browser connect flow. */
export const v2CreatableCredentialTypeSchema = z.enum(
  ['env_workspace', 'env_personal', 'service_account'],
  { error: 'type must be one of env_workspace, env_personal, service_account' }
)
export type V2CreatableCredentialType = z.output<typeof v2CreatableCredentialTypeSchema>

/**
 * Public credential projection. `workspaceId` (supplied by the caller),
 * `createdBy`, and every encrypted column are omitted.
 */
export const v2CredentialSchema = z.object({
  id: z.string(),
  type: workspaceCredentialTypeSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  /** The integration this credential authenticates against, when it has one. */
  providerId: z.string().nullable(),
  /** The linked OAuth account, for `oauth` credentials. */
  accountId: z.string().nullable(),
  /** The environment-variable name, for `env_workspace` / `env_personal` credentials. */
  envKey: z.string().nullable(),
  /** Whether a service-account secret is stored. The secret itself is never returned. */
  hasServiceAccountKey: z.boolean(),
  /** The caller's role on this credential. */
  role: workspaceCredentialRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type V2Credential = z.output<typeof v2CredentialSchema>

/** `{ credential }` payload for single-credential reads and mutations. */
export const v2CredentialDataSchema = z.object({ credential: v2CredentialSchema })
export type V2CredentialData = z.output<typeof v2CredentialDataSchema>

export const v2CredentialDeleteDataSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})
export type V2CredentialDeleteData = z.output<typeof v2CredentialDeleteDataSchema>

export const v2CredentialParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type V2CredentialParams = z.output<typeof v2CredentialParamsSchema>

export const v2CredentialWorkspaceQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})
export type V2CredentialWorkspaceQuery = z.output<typeof v2CredentialWorkspaceQuerySchema>

/** A credential's natural name field is `displayName`, so that is what `search` matches. */
export const v2CredentialSortFields = ['displayName', 'createdAt', 'updatedAt'] as const

export type V2CredentialSortBy = (typeof v2CredentialSortFields)[number]

export const v2ListCredentialsQuerySchema = v2CredentialWorkspaceQuerySchema.extend({
  type: workspaceCredentialTypeSchema.optional(),
  providerId: z.string().min(1, 'providerId cannot be empty').optional(),
  search: v2SearchSchema,
  ...v2SortFields(v2CredentialSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
})
export type V2ListCredentialsQuery = z.output<typeof v2ListCredentialsQuerySchema>

/** Write-only secret fields, shared by create and the reconnect-style update. */
const credentialSecretFields = {
  /** Write-only. Google-style service-account JSON key. */
  serviceAccountJson: z.string().min(1, 'serviceAccountJson cannot be empty').optional(),
  /** Write-only. Slack custom-bot signing secret. */
  signingSecret: z.string().trim().min(1, 'signingSecret cannot be empty').optional(),
  /** Write-only. Slack custom-bot token. */
  botToken: z.string().trim().min(1, 'botToken cannot be empty').optional(),
  /** Write-only. Atlassian API token. */
  apiToken: z.string().trim().min(1, 'apiToken cannot be empty').optional(),
  domain: z.string().trim().min(1, 'domain cannot be empty').optional(),
  /** Write-only. Client-credentials service-account id/secret pair. */
  clientId: z.string().trim().min(1, 'clientId cannot be empty').max(512).optional(),
  clientSecret: z.string().trim().min(1, 'clientSecret cannot be empty').max(1024).optional(),
  orgId: z.string().trim().min(1, 'orgId cannot be empty').max(255).optional(),
} as const

export const v2CreateCredentialBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    type: v2CreatableCredentialTypeSchema,
    displayName: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(500).optional(),
    providerId: z.string().trim().min(1, 'providerId cannot be empty').optional(),
    /** Required for `env_workspace` / `env_personal`. Accepts `NAME` or `{{NAME}}`. */
    envKey: z.string().trim().min(1, 'envKey cannot be empty').optional(),
    ...credentialSecretFields,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === 'service_account') {
      for (const field of getServiceAccountRequiredFields(data.providerId)) {
        if (!data[field]) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required for ${data.providerId ?? 'service account'} credentials`,
          })
        }
      }
      return
    }

    const normalizedEnvKey = data.envKey ? normalizeCredentialEnvKey(data.envKey) : ''
    if (!normalizedEnvKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['envKey'],
        message: 'envKey is required for env credentials',
      })
      return
    }
    if (!ENV_VAR_NAME_REGEX.test(normalizedEnvKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['envKey'],
        message: 'envKey must contain only letters, numbers, and underscores',
      })
    }
  })
export type V2CreateCredentialBody = z.input<typeof v2CreateCredentialBodySchema>

/**
 * Update body. Renaming and re-describing apply to any type; the secret fields
 * rotate a stored secret in place (the provider re-verifies it).
 */
export const v2UpdateCredentialBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    displayName: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(500).nullish(),
    ...credentialSecretFields,
  })
  .strict()
  .superRefine((data, ctx) => {
    const { workspaceId: _workspaceId, ...changes } = data
    if (Object.values(changes).every((value) => value === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'At least one field to change is required',
      })
    }
  })
export type V2UpdateCredentialBody = z.input<typeof v2UpdateCredentialBodySchema>

/**
 * Credential list. A workspace's credential set is small and bounded, so the
 * full visible set is returned as a single page (`nextCursor` is always `null`);
 * the canonical cursor envelope keeps the v2 list surface uniform.
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

export const v2CreateCredentialContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/credentials',
  body: v2CreateCredentialBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CredentialDataSchema),
  },
})

export const v2GetCredentialContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/credentials/[id]',
  params: v2CredentialParamsSchema,
  query: v2CredentialWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CredentialDataSchema),
  },
})

export const v2UpdateCredentialContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/credentials/[id]',
  params: v2CredentialParamsSchema,
  body: v2UpdateCredentialBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CredentialDataSchema),
  },
})

export const v2DeleteCredentialContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/credentials/[id]',
  params: v2CredentialParamsSchema,
  query: v2CredentialWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CredentialDeleteDataSchema),
  },
})
