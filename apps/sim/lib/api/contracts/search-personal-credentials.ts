import { z } from 'zod'
import {
  createCredentialFieldsSchema,
  refineCredentialCreate,
} from '@/lib/api/contracts/credentials'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

const saveSearchPersonalCredentialBodySchema = createCredentialFieldsSchema
  .pick({
    apiToken: true,
    domain: true,
    providerWorkspaceId: true,
    clientId: true,
    clientSecret: true,
    orgId: true,
    displayName: true,
    description: true,
  })
  .extend({
    organizationId: organizationIdSchema,
    providerId: z.enum(['jama-service-account', 'flow-service-account']),
    credentialId: z.string().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((data, ctx) => refineCredentialCreate({ ...data, type: 'service_account' }, ctx))

export type SaveSearchPersonalCredentialBody = z.input<
  typeof saveSearchPersonalCredentialBodySchema
>

export const saveSearchPersonalCredentialContract = defineRouteContract({
  method: 'POST',
  path: '/api/search/personal-credentials',
  body: saveSearchPersonalCredentialBodySchema,
  response: { mode: 'json', schema: z.object({ credentialId: z.string() }) },
})

const removeSearchPersonalCredentialBodySchema = z
  .object({
    organizationId: organizationIdSchema,
    credentialId: z.string().min(1).max(255),
  })
  .strict()

export type RemoveSearchPersonalCredentialBody = z.input<
  typeof removeSearchPersonalCredentialBodySchema
>

export const removeSearchPersonalCredentialContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/search/personal-credentials',
  body: removeSearchPersonalCredentialBodySchema,
  response: { mode: 'json', schema: z.object({ success: z.literal(true) }) },
})
