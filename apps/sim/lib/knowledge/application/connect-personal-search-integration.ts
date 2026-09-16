import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { resolvePersonalSearchConnection } from '@/lib/knowledge/application/personal-search-integrations'
import { connectSimSearchConnector } from '@/lib/knowledge/application/sim-search'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'

interface ConnectPersonalSearchIntegrationInput {
  organizationId: string
  target: SearchConnectionTarget
  oauthCompletionId: string
  sourceConfig?: Record<string, string>
}

/** A user click validates the requested control before starting the ordinary source enrollment. */
export const connectPersonalSearchIntegration = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.connectPersonalSearchIntegration,
  resolveContext: ({ input }: { input: ConnectPersonalSearchIntegrationInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, request }) {
    const { target } = await resolvePersonalSearchConnection.execute({ principal, input })
    return connectSimSearchConnector.execute({
      principal,
      request,
      input: {
        organizationId: input.organizationId,
        connectorType: target.connectorType,
        connectorId: target.connectorId,
        sourceConfig: input.sourceConfig,
        oauthCompletionId: input.oauthCompletionId,
        connectionIntent: target.credentialId
          ? { kind: 'reconnect', credentialId: target.credentialId }
          : { kind: 'create' },
      },
    })
  },
})
