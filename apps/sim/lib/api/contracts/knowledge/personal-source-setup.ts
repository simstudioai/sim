import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { successResponseSchema } from '@/lib/api/contracts/knowledge/shared'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import {
  executeSelectorResponseSchema,
  selectorRequestSchema,
} from '@/lib/api/contracts/selectors/execute'
import { MAX_PERSONAL_SOURCE_SETUP_KEYS } from '@/lib/sim-search/personal-source-setup'

const setupOwnerSchema = z.object({
  organizationId: organizationIdSchema,
  connectorType: z.enum(['jira', 'confluence']),
})
const setupCredentialSchema = setupOwnerSchema.extend({
  credentialId: z.string().min(1).max(128),
  domain: z.string().trim().min(1, 'Enter your Atlassian site').max(253),
})

export const personalSourceSetupQuerySchema = setupOwnerSchema.extend({
  completionId: z.string().uuid().optional(),
})
export type PersonalSourceSetupQuery = z.input<typeof personalSourceSetupQuerySchema>

export const personalSourceSetupAccountsSchema = z.object({
  accounts: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().max(512),
        provider: z.enum(['jira', 'confluence']),
        type: z.literal('managed_oauth'),
        scopes: z.array(z.string().max(200)).max(200),
      })
    )
    .max(1000),
  completedCredentialId: z.string().min(1).max(128).nullable(),
})
export type PersonalSourceSetupAccounts = z.output<typeof personalSourceSetupAccountsSchema>

export const personalSourceSetupBodySchema = z.discriminatedUnion('action', [
  setupOwnerSchema
    .extend({ action: z.literal('authorize'), oauthCompletionId: z.string().uuid() })
    .strict(),
  setupCredentialSchema
    .extend({
      action: z.literal('connect'),
      keys: z
        .array(z.string().trim().min(1).max(255))
        .min(1, 'Select at least one project or space')
        .max(
          MAX_PERSONAL_SOURCE_SETUP_KEYS,
          'Choose no more than 1,000 projects or spaces per source'
        ),
    })
    .strict(),
  setupCredentialSchema
    .extend({ action: z.literal('options'), request: selectorRequestSchema })
    .strict(),
])
export type PersonalSourceSetupBody = z.input<typeof personalSourceSetupBodySchema>

export const personalSourceSetupResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authorization'), url: z.string().url() }),
  z.object({
    kind: z.literal('connected'),
    knowledgeBaseId: z.string().min(1).max(200),
    connectorId: z.string().min(1).max(200),
  }),
  ...executeSelectorResponseSchema.options,
])
export type PersonalSourceSetupResult = z.output<typeof personalSourceSetupResultSchema>

export const listPersonalSourceSetupAccountsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/sim-search/personal-source-setup',
  query: personalSourceSetupQuerySchema,
  response: { mode: 'json', schema: successResponseSchema(personalSourceSetupAccountsSchema) },
})

export const personalSourceSetupContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/sim-search/personal-source-setup',
  body: personalSourceSetupBodySchema,
  response: { mode: 'json', schema: successResponseSchema(personalSourceSetupResultSchema) },
})
