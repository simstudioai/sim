import { z } from 'zod'
import { defineResourcePolicyPrincipal } from '@/lib/resource-policies/principals/types'

export const knowledgeConnectorResourcePolicyPrincipalSchema = z
  .object({
    type: z.literal('knowledge_connector'),
    connectorId: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => value === value.trim(), 'Knowledge connector ID must be canonical'),
  })
  .strict()

/**
 * A knowledge connector crawling a source on behalf of the people enrolled in a
 * Credential Group. Granted by the connector's own settings, never from the
 * group's access page, so the selector is internal.
 */
export const knowledgeConnectorResourcePolicyPrincipalDefinition = defineResourcePolicyPrincipal({
  type: 'knowledge_connector',
  schema: knowledgeConnectorResourcePolicyPrincipalSchema,
  label: 'Knowledge connector',
  selector: { type: 'internal' },
  matches: (principal, facts) =>
    facts.currentKnowledgeConnector?.connectorId === principal.connectorId,
})
