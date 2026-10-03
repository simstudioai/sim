import { startOrganizationAccountConnection } from '@/lib/credential-groups/application/organization-accounts'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { resolvePersonalSearchConnection } from '@/lib/knowledge/application/personal-search-integrations'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'

interface ConnectPersonalSearchIntegrationInput {
  organizationId: string
  target: SearchConnectionTarget
  oauthCompletionId: string
}

/** A user click validates the requested control before starting the ordinary source enrollment. */
export const connectPersonalSearchIntegration = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.connectPersonalSearchIntegration,
  resolveContext: ({ input }: { input: ConnectPersonalSearchIntegrationInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, request }) {
    const { target } = await resolvePersonalSearchConnection.execute({ principal, input })
    const result = await startOrganizationAccountConnection.execute({
      principal,
      request,
      input: {
        organizationId: input.organizationId,
        optionId: target.optionId,
        oauthCompletionId: input.oauthCompletionId,
        connectionIntent: target.credentialId
          ? { kind: 'reconnect', credentialId: target.credentialId }
          : { kind: 'create' },
      },
    })
    return {
      url: result.authorizationUrl ?? result.invitationLink,
    }
  },
})
