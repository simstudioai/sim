import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import {
  secretChangesSchema,
  secretSourceModeSchema,
  secretVariablesSchema,
} from '@/lib/organization-secrets/validation'

const params = z.object({ id: organizationIdSchema })
const sourceIdSchema = z.string().min(1, 'Source ID cannot be empty').max(255)
export const genericSecretSourceSchema = z.object({
  id: sourceIdSchema,
  mode: secretSourceModeSchema,
})
export type GenericSecretSource = z.infer<typeof genericSecretSourceSchema>
const sourceResponse = z.object({ source: genericSecretSourceSchema.nullable() })
const successResponse = z.object({ success: z.literal(true) })

export const configureSecretSourceBodySchema = z
  .object({
    sourceId: sourceIdSchema.nullable(),
    mode: secretSourceModeSchema,
  })
  .strict()
export type ConfigureSecretSourceBody = z.input<typeof configureSecretSourceBodySchema>

export const getSecretSourceContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/secret-source',
  params,
  response: { mode: 'json', schema: sourceResponse },
})
export const configureSecretSourceContract = defineRouteContract({
  method: 'PUT',
  path: '/api/organizations/[id]/secret-source',
  params,
  body: configureSecretSourceBodySchema,
  response: { mode: 'json', schema: z.object({ source: genericSecretSourceSchema }) },
})
export const removeSecretSourceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/secret-source',
  params,
  body: z.object({ sourceId: sourceIdSchema }).strict(),
  response: { mode: 'json', schema: successResponse },
})

export const secretEditorQuerySchema = z.object({ mode: secretSourceModeSchema })
export const secretEditorResponseSchema = z.object({
  source: genericSecretSourceSchema,
  variables: secretVariablesSchema,
})
export type SecretEditorResponse = z.output<typeof secretEditorResponseSchema>
export const saveOrganizationSecretsBodySchema = secretChangesSchema
  .extend({
    sourceId: sourceIdSchema,
    mode: secretSourceModeSchema,
  })
  .strict()
export type SaveOrganizationSecretsBody = z.input<typeof saveOrganizationSecretsBodySchema>

export const getOrganizationSecretsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/secret-source/secrets',
  params,
  query: secretEditorQuerySchema,
  response: { mode: 'json', schema: secretEditorResponseSchema },
})
export const saveOrganizationSecretsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/organizations/[id]/secret-source/secrets',
  params,
  body: saveOrganizationSecretsBodySchema,
  response: { mode: 'json', schema: successResponse },
})
