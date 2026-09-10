import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { successResponseSchema } from '@/lib/api/contracts/knowledge/shared'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { searchConnectionTargetSchema } from '@/lib/knowledge/search/connection-target'

export const personalSearchIntegrationSchema = z.object({
  name: z.string().max(200),
  providerId: z.string().min(1).max(100),
  connectorType: z.string().min(1).max(100),
  connectorId: z.string().min(1).max(200),
  knowledgeBaseId: z.string().min(1).max(200),
  description: z.string().max(240),
  accounts: z
    .array(
      z.object({
        credentialId: z.string().min(1).max(128),
        displayName: z.string(),
        status: z.enum(['connected', 'reconnect_needed']),
        action: searchConnectionTargetSchema.nullable(),
      })
    )
    .max(100),
  connectionStatus: z.enum(['connected', 'reconnect_needed', 'not_connected', 'unavailable']),
  indexingStatus: z.enum(['indexing', 'indexed', 'not_indexed', 'sync_failed', 'paused']),
  searchableDocuments: z.number().int().nonnegative(),
  action: searchConnectionTargetSchema.nullable(),
})

export const personalSearchIntegrationPageSchema = z.object({
  completedCredentialId: z.string().min(1).max(128).nullable(),
  connections: z.array(personalSearchIntegrationSchema).max(50),
  available: z
    .array(
      z.object({
        name: z.string().max(200),
        description: z.string().max(240),
        target: searchConnectionTargetSchema,
      })
    )
    .max(200),
  nextCursor: z.string().max(1024).nullable(),
})
export type PersonalSearchIntegration = z.output<typeof personalSearchIntegrationSchema>
export type PersonalSearchIntegrationPage = z.output<typeof personalSearchIntegrationPageSchema>

export const personalSearchIntegrationsQuerySchema = z.object({
  completionId: z.string().uuid().optional(),
  organizationId: organizationIdSchema,
  connectorType: z.string().trim().min(1).max(100).optional(),
  connectorId: z.string().min(1).max(200).optional(),
  cursor: z.string().min(1).max(1024).optional(),
})
export type PersonalSearchIntegrationsQuery = z.input<typeof personalSearchIntegrationsQuerySchema>

export const listPersonalSearchIntegrationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/sim-search/personal-integrations',
  query: personalSearchIntegrationsQuerySchema,
  response: { mode: 'json', schema: successResponseSchema(personalSearchIntegrationPageSchema) },
})

export const connectPersonalSearchIntegrationBodySchema = z.object({
  organizationId: organizationIdSchema,
  target: searchConnectionTargetSchema,
  oauthCompletionId: z.string().uuid(),
  sourceConfig: z
    .record(z.string().min(1).max(100), z.string().max(2000))
    .refine((config) => Object.keys(config).length <= 30, 'Too many source configuration fields')
    .optional(),
})
export type ConnectPersonalSearchIntegrationBody = z.input<
  typeof connectPersonalSearchIntegrationBodySchema
>
export const connectPersonalSearchIntegrationContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/sim-search/personal-integrations',
  body: connectPersonalSearchIntegrationBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        url: z.string().url(),
        connectorId: z.string().min(1).max(200),
        knowledgeBaseId: z.string().min(1).max(200),
      })
    ),
  },
})
