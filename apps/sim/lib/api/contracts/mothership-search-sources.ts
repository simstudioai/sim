import { z } from 'zod'
import {
  searchSourcePageSchema,
  searchSourceSummarySchema,
} from '@/lib/api/contracts/knowledge/connectors'
import { searchIntegrationApprovalSchema } from '@/lib/api/contracts/knowledge/search-integrations'

const connectorTypeSchema = z.string().trim().min(1).max(100)

/** Organization and actor are supplied only by the authenticated conversation. */
export const organizationSearchSourcesInputSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('list'),
    cursor: z.string().min(1).max(1024).optional(),
    connectorType: connectorTypeSchema.optional(),
    search: z.string().trim().max(200).optional(),
    mine: z.boolean().optional(),
  }),
  z.strictObject({ action: z.literal('get'), connectorId: z.string().min(1).max(255) }),
  z.strictObject({ action: z.literal('providers') }),
  z.strictObject({
    action: z.literal('setup'),
    connectorType: connectorTypeSchema,
    accessMode: z.enum(['admin', 'members']),
  }),
  z.strictObject({
    action: z.literal('approve'),
    connectorType: connectorTypeSchema,
    approved: z.boolean(),
  }),
])
export type OrganizationSearchSourcesInput = z.output<typeof organizationSearchSourcesInputSchema>

export const organizationSearchSourcesOutputSchema = z.discriminatedUnion('action', [
  searchSourcePageSchema.extend({ action: z.literal('list') }),
  z.object({ action: z.literal('get'), source: searchSourceSummarySchema }),
  z.object({
    action: z.literal('providers'),
    providers: z.array(searchIntegrationApprovalSchema).max(100),
  }),
  z.object({
    action: z.literal('setup'),
    connectorType: connectorTypeSchema,
    name: z.string().max(255),
    accessMode: z.enum(['admin', 'members']),
    setupUrl: z.string().max(2048),
    status: z.literal('requires_user_setup'),
  }),
  searchIntegrationApprovalSchema.extend({ action: z.literal('approve'), changed: z.boolean() }),
])
export type OrganizationSearchSourcesOutput = z.output<typeof organizationSearchSourcesOutputSchema>
