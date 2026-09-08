import { z } from 'zod'
import {
  createCredentialDraftBodySchema,
  createCredentialFieldsSchema,
  credentialIdParamsSchema,
  oauthCredentialSchema,
  refineCredentialCreate,
  refineOAuthClientConfigForProvider,
  updateCredentialByIdBodySchema,
  workspaceCredentialSchema,
} from '@/lib/api/contracts/credentials'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const organizationCredentialSchema = workspaceCredentialSchema.extend({
  workspaceId: z.null(),
  organizationId: organizationIdSchema,
  type: z.enum(['oauth', 'service_account']),
})
export type OrganizationCredential = z.output<typeof organizationCredentialSchema>

export const organizationCredentialsQuerySchema = z.object({
  organizationId: organizationIdSchema,
  type: z.enum(['oauth', 'service_account']).optional(),
  providerId: z.string().min(1).max(255).optional(),
})
export type OrganizationCredentialsQuery = z.input<typeof organizationCredentialsQuerySchema>

export const createOrganizationCredentialBodySchema = createCredentialFieldsSchema
  .omit({ workspaceId: true })
  .extend({
    organizationId: organizationIdSchema,
    type: z.enum(['oauth', 'service_account']),
  })
  .superRefine(refineCredentialCreate)
export type CreateOrganizationCredentialBody = z.input<
  typeof createOrganizationCredentialBodySchema
>

export const createOrganizationCredentialDraftBodySchema = z
  .object({
    ...createCredentialDraftBodySchema.shape,
    workspaceId: z.never().optional(),
    organizationId: organizationIdSchema,
  })
  .superRefine(refineOAuthClientConfigForProvider)
export type CreateOrganizationCredentialDraftBody = z.input<
  typeof createOrganizationCredentialDraftBodySchema
>

export const listOrganizationCredentialsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organization-credentials',
  query: organizationCredentialsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ credentials: z.array(organizationCredentialSchema) }),
  },
})
export const listOrganizationOAuthCredentialsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organization-credentials/oauth',
  query: organizationCredentialsQuerySchema,
  response: { mode: 'json', schema: z.object({ credentials: z.array(oauthCredentialSchema) }) },
})
export const createOrganizationCredentialContract = defineRouteContract({
  method: 'POST',
  path: '/api/organization-credentials',
  body: createOrganizationCredentialBodySchema,
  response: {
    mode: 'json',
    status: [200, 201],
    schema: z.object({ credential: organizationCredentialSchema }),
  },
})
export const createOrganizationCredentialDraftContract = defineRouteContract({
  method: 'POST',
  path: '/api/organization-credentials/draft',
  body: createOrganizationCredentialDraftBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true), draftId: z.string().min(1) }),
  },
})

export const updateOrganizationCredentialBodySchema = z.intersection(
  updateCredentialByIdBodySchema,
  z.object({ organizationId: organizationIdSchema })
)
export type UpdateOrganizationCredentialBody = z.input<
  typeof updateOrganizationCredentialBodySchema
>
export const updateOrganizationCredentialContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/organization-credentials/[id]',
  params: credentialIdParamsSchema,
  body: updateOrganizationCredentialBodySchema,
  response: { mode: 'json', schema: z.object({ credential: organizationCredentialSchema }) },
})
