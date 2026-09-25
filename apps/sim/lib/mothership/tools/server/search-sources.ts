import {
  type OrganizationSearchSourcesInput,
  type OrganizationSearchSourcesOutput,
  organizationSearchSourcesInputSchema,
  organizationSearchSourcesOutputSchema,
} from '@/lib/api/contracts/mothership-search-sources'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import {
  approveSearchIntegration,
  listSearchIntegrations,
} from '@/lib/knowledge/application/search-integrations'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'
import { prepareSearchSource } from '@/lib/knowledge/application/sim-search'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import type { BaseServerTool } from '@/lib/mothership/tools/server/base-tool'
import { organizationRoutes } from '@/lib/navigation/paths'
import { canConnectPersonally, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { searchSetupAccessParam, searchSetupParam } from '@/lib/sim-search/search-params'

/** Organization Search controls reuse the product operations and its credential collection UI. */
export const organizationSearchSourcesServerTool: BaseServerTool<
  OrganizationSearchSourcesInput,
  OrganizationSearchSourcesOutput
> = {
  name: 'search_sources',
  inputSchema: organizationSearchSourcesInputSchema,
  outputSchema: organizationSearchSourcesOutputSchema,
  async execute(args, context) {
    if (context?.requestMode !== 'agent' && context?.requestMode !== 'plan')
      throw new OrchestrationError('forbidden', 'Search source controls require Mothership')
    const trusted = requireTrustedOrganizationCopilotContext(context)
    const principal = createTrustedOrganizationCopilotPrincipal(
      { ...trusted, delegationId: `copilot-tool:${trusted.toolCallId}` },
      {
        audience: knowledgeDelegationPolicy.audience,
        ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
      }
    )
    await authorizeOrganizationChatDelegation.execute({ principal })
    context?.abortSignal?.throwIfAborted()
    context?.userStopSignal?.throwIfAborted()
    const input = organizationSearchSourcesInputSchema.parse(args)
    const owner = { organizationId: trusted.organizationId }
    switch (input.action) {
      case 'list': {
        const { action, ...filters } = input
        return {
          action,
          ...(await listSearchSources.execute({ principal, input: { ...owner, ...filters } })),
        }
      }
      case 'get': {
        const page = await listSearchSources.execute({
          principal,
          input: { ...owner, connectorId: input.connectorId },
        })
        const source = page.sources[0]
        if (!source) throw new OrchestrationError('not_found', 'Search source not found')
        return { action: input.action, source }
      }
      case 'providers':
        return {
          action: input.action,
          providers: await listSearchIntegrations.execute({ principal, input: owner }),
        }
      case 'approve':
        return {
          action: input.action,
          ...(await approveSearchIntegration.execute({
            principal,
            input: { ...owner, connectorType: input.connectorType, approved: input.approved },
          })),
        }
      case 'setup': {
        await prepareSearchSource.authorize({
          principal,
          input: { ...owner, connectorType: input.connectorType, accessMode: input.accessMode },
        })
        const entry = SEARCH_SOURCE_TYPES.find(([type]) => type === input.connectorType)
        if (!entry || !searchSetupParam.parser.parse(input.connectorType))
          throw new OrchestrationError('validation', 'This Search source is not supported')
        const [, meta] = entry
        if (input.accessMode === 'admin' ? !meta.mirrorsSourceAcls : !canConnectPersonally(meta))
          throw new OrchestrationError(
            'validation',
            'This Search source does not support that access mode'
          )
        const query = new URLSearchParams({ [searchSetupParam.key]: input.connectorType })
        if (input.accessMode === 'members') query.set(searchSetupAccessParam.key, 'members')
        return {
          action: input.action,
          connectorType: input.connectorType,
          name: meta.name,
          accessMode: input.accessMode,
          setupUrl: `${organizationRoutes(trusted.organizationId).settingsSection('integrations')}?${query}`,
          status: 'requires_user_setup',
        }
      }
    }
  },
}
