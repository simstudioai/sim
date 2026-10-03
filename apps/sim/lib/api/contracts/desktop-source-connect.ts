import { z } from 'zod'
import { startSlackCredentialGroupConfigurationBodySchema } from '@/lib/api/contracts/credential-groups'
import { startGitHubSearchSetupBodySchema } from '@/lib/api/contracts/knowledge/github-setup'
import { connectPersonalSearchIntegrationBodySchema } from '@/lib/api/contracts/knowledge/personal-integrations'
import { knowledgeConnectorParamsSchema } from '@/lib/api/contracts/knowledge/shared'
import { startSlackSearchOAuthBodySchema } from '@/lib/api/contracts/knowledge/slack'
import { startOrganizationAccountConnectionBodySchema } from '@/lib/api/contracts/organization-accounts'
import { organizationIdSchema, resourceOwnerSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const desktopSourceRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slack-search'), body: startSlackSearchOAuthBodySchema }),
  z.object({ kind: z.literal('github-setup'), body: startGitHubSearchSetupBodySchema }),
  z.object({
    kind: z.literal('organization-account'),
    organizationId: organizationIdSchema,
    body: startOrganizationAccountConnectionBodySchema,
  }),
  z.object({
    kind: z.literal('reconnect-account'),
    credentialId: z.string().min(1).max(128),
    completionId: z.string().uuid().optional(),
  }),
  z.object({
    kind: z.literal('personal-search'),
    body: connectPersonalSearchIntegrationBodySchema,
  }),
  z.object({
    kind: z.literal('member-enrollment'),
    params: knowledgeConnectorParamsSchema,
    completionId: z.string().uuid().optional(),
  }),
  z.object({
    kind: z.literal('slack-managed-users'),
    owner: resourceOwnerSchema,
    credentialGroupId: z.string().min(1).max(128),
    body: startSlackCredentialGroupConfigurationBodySchema,
  }),
])
export type DesktopSourceRequest = z.input<typeof desktopSourceRequestSchema>
export const desktopSourceRequestIdSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
})
export type DesktopSourceRequestId = z.output<typeof desktopSourceRequestIdSchema>

export const createDesktopSourceRequestBodySchema = desktopSourceRequestIdSchema.extend({
  request: desktopSourceRequestSchema,
})
export type CreateDesktopSourceRequestBody = z.input<typeof createDesktopSourceRequestBodySchema>

export const createDesktopSourceRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/source-connect',
  body: createDesktopSourceRequestBodySchema,
  response: { mode: 'json', schema: desktopSourceRequestIdSchema },
})
export const consumeDesktopSourceRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/source-connect/consume',
  body: desktopSourceRequestIdSchema,
  response: { mode: 'json', schema: desktopSourceRequestSchema },
})
