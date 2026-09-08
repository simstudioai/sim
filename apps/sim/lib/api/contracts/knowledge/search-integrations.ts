import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { successResponseSchema } from '@/lib/api/contracts/knowledge/shared'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'

export const searchIntegrationApprovalSchema = z.object({
  connectorType: z.string().min(1, 'connectorType cannot be empty').max(100),
  approved: z.boolean(),
})
export type SearchIntegrationApproval = z.output<typeof searchIntegrationApprovalSchema>

export const listSearchIntegrationsQuerySchema = z.object({ organizationId: organizationIdSchema })
export type ListSearchIntegrationsQuery = z.input<typeof listSearchIntegrationsQuerySchema>
export const listSearchIntegrationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/sim-search/integrations',
  query: listSearchIntegrationsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(searchIntegrationApprovalSchema).max(100)),
  },
})

export const updateSearchIntegrationBodySchema = searchIntegrationApprovalSchema.extend({
  organizationId: organizationIdSchema,
})
export type UpdateSearchIntegrationBody = z.input<typeof updateSearchIntegrationBodySchema>
export const updateSearchIntegrationContract = defineRouteContract({
  method: 'PUT',
  path: '/api/knowledge/sim-search/integrations',
  body: updateSearchIntegrationBodySchema,
  response: { mode: 'json', schema: successResponseSchema(searchIntegrationApprovalSchema) },
})
