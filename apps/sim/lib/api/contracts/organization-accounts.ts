import { z } from 'zod'
import {
  credentialGroupOptionInputSchema,
  credentialGroupProviderSchema,
  credentialGroupSchema,
  startSlackCredentialGroupConfigurationBodySchema,
  startSlackCredentialGroupConfigurationContract,
  updateCredentialGroupBodySchema,
} from '@/lib/api/contracts/credential-groups'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

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
  body: startSlackCredentialGroupConfigurationBodySchema,
  response: startSlackCredentialGroupConfigurationContract.response,
})
export type OrganizationAccountsSettings = z.output<
  typeof getOrganizationAccountsContract.response.schema
>
export type EnsureOrganizationAccountsBody = z.input<typeof ensureOrganizationAccountsContract.body>
export type UpdateOrganizationAccountsBody = z.input<typeof updateCredentialGroupBodySchema>
