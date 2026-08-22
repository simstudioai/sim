import { z } from 'zod'
import { workspaceCredentialRoleSchema } from '@/lib/api/contracts/credentials'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'

const SECRET_NAME_REGEX = /^[A-Za-z0-9_]+$/

export const v2SecretScopeSchema = z
  .enum(['workspace', 'personal'])
  .describe(
    'Whether the secret belongs to the workspace or to the caller. A personal secret belongs to the caller across every workspace, not to one workspace.'
  )
export type V2SecretScope = z.output<typeof v2SecretScopeSchema>

export const v2SecretNameSchema = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(255, 'name is too long')
  .regex(SECRET_NAME_REGEX, 'name must contain only letters, numbers, and underscores')
  .describe('Secret name containing only letters, numbers, and underscores.')

/** Secret metadata. The stored value is intentionally absent from every response schema. */
export const v2SecretSchema = z
  .object({
    name: v2SecretNameSchema,
    scope: v2SecretScopeSchema,
    description: z
      .string()
      .nullable()
      .describe(
        'What the secret is for, as set on the workspace secret. Always null for a personal secret, which has no shared audience.'
      ),
    role: workspaceCredentialRoleSchema.describe('Caller role for the secret.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the secret was created.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 timestamp when the secret was last updated.'),
  })
  .meta({
    id: 'V2Secret',
    title: 'Secret metadata',
    description: 'Public secret metadata without the stored secret value.',
  })
export type V2Secret = z.output<typeof v2SecretSchema>

export const v2SecretDeleteDataSchema = z
  .object({
    name: v2SecretNameSchema,
    scope: v2SecretScopeSchema,
    deleted: z.literal(true).describe('Whether the secret was deleted.'),
  })
  .meta({
    id: 'V2SecretDeleteData',
    title: 'Delete secret data',
    description: 'Secret deletion acknowledgement without the stored value.',
  })
export type V2SecretDeleteData = z.output<typeof v2SecretDeleteDataSchema>

export const v2SecretSortFields = ['name', 'createdAt', 'updatedAt'] as const
export type V2SecretSortBy = (typeof v2SecretSortFields)[number]

export const v2ListSecretsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose secret metadata should be listed.'),
    scope: v2SecretScopeSchema.optional().describe('Restrict results to one ownership scope.'),
    search: v2SearchSchema.describe('Case-insensitive substring match against the secret name.'),
    ...v2SortFields(v2SecretSortFields, { sortBy: 'name', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum secrets to return per page.' }),
  })
  .strict()
export type V2ListSecretsQuery = z.output<typeof v2ListSecretsQuerySchema>

export const v2SecretParamsSchema = z.object({
  name: v2SecretNameSchema.describe('Secret to create, replace, or delete.'),
})
export type V2SecretParams = z.output<typeof v2SecretParamsSchema>

export const v2SetSecretBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe(
      'Workspace the request is authorized against. A workspace secret is written to it; a personal secret is written to the caller and is available in all of their workspaces.'
    ),
    scope: v2SecretScopeSchema,
    value: z
      .string()
      .min(1, 'value is required')
      .max(65_536, 'value is too long')
      .describe('Write-only secret value. It is never returned.')
      .meta({ writeOnly: true }),
    description: z
      .string()
      .trim()
      .max(500, 'description must be at most 500 characters')
      .nullish()
      .describe(
        'What the secret is for, shown to teammates. Workspace scope only — sending it for a personal secret is rejected. Omit it to leave an existing description untouched; send null or an empty string to clear one.'
      ),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.scope === 'personal' && data.description !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'description is only supported for a workspace secret',
      })
    }
  })
export type V2SetSecretBody = z.input<typeof v2SetSecretBodySchema>

export const v2DeleteSecretQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe(
      'Workspace the request is authorized against. A workspace secret is deleted from it; a personal secret is deleted for the caller in all of their workspaces.'
    ),
    scope: v2SecretScopeSchema,
  })
  .strict()
export type V2DeleteSecretQuery = z.output<typeof v2DeleteSecretQuerySchema>

/**
 * Lists names and metadata only, keyset-paginated over the active sort. There is
 * deliberately no single-secret GET, and no response ever carries a value.
 */
export const v2ListSecretsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/secrets',
  query: v2ListSecretsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2SecretSchema),
  },
})

/** Creates or replaces a secret value without returning it. */
export const v2SetSecretContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/secrets/[name]',
  query: noInputSchema,
  params: v2SecretParamsSchema,
  body: v2SetSecretBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SecretSchema),
    status: [200, 201],
  },
})

export const v2DeleteSecretContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/secrets/[name]',
  params: v2SecretParamsSchema,
  query: v2DeleteSecretQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SecretDeleteDataSchema),
  },
})
