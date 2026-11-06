import { assistantSearchSourceForProvider } from '@/lib/assistant-actions/providers'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { findCredentialGroupProviderFromProviderId } from '@/lib/credential-groups/providers'
import type { DbOrTx } from '@/lib/db/types'
import { projectIntegrationToolsForViewer } from '@/lib/integrations/tool-projection'
import {
  listOrganizationSearchApprovals,
  requireOrganizationSearchApproval,
} from '@/lib/knowledge/search/integration-policy'
import { projectAssistantConnectedAccountTool } from '@/lib/mothership/assistant/connected-account-tool'
import { isAssistantIntegrationTool } from '@/lib/mothership/assistant/tool-policy'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'
import { requiresScopedRetrieval } from '@/lib/sim-search/live/policy-schema'
import { livePolicyFor, loadLiveSearchPolicies } from '@/lib/sim-search/live/policy-store'

/** Settings and execution expose the same administrator-authorized, personal-account operations. */
export async function loadAssistantIntegrationTools(
  scope: { organizationId: string; userId: string },
  executor?: DbOrTx
) {
  const [visibility, config] = await Promise.all([
    getBlockVisibility({ userId: scope.userId, orgId: scope.organizationId }, executor),
    getUserPermissionConfigForOrganization(scope.organizationId, executor),
  ])
  const tools = projectIntegrationToolsForViewer(visibility, config)
    .tools.map((entry) => ({
      ...entry,
      config: projectAssistantConnectedAccountTool(entry.config),
    }))
    .filter(({ config: tool }) => isAssistantIntegrationTool(tool) && tool.oauth)
  const providers = [
    ...new Set(
      tools.flatMap(({ config: tool }) => {
        const provider =
          tool.oauth && findCredentialGroupProviderFromProviderId(tool.oauth.provider)
        return provider ? [provider] : []
      })
    ),
  ]
  return { tools, config, providers }
}

/** Direct operations cannot bypass a Search source's administrator-defined content boundary. */
export async function requireAssistantProviderAccess(organizationId: string, providerId: string) {
  const source = assistantSearchSourceForProvider(providerId)
  if (!source) return
  await requireOrganizationSearchApproval(organizationId, source)
  const policies = await loadLiveSearchPolicies({ organizationId })
  if (requiresScopedRetrieval(source, livePolicyFor(policies, source)))
    throw new OrchestrationError(
      'forbidden',
      'This organization restricts content access for this app. Use search_workspace and read_document within that scope.'
    )
}

/**
 * The same boundary as {@link requireAssistantProviderAccess} for a read that checks several
 * providers: one load of the organization's decisions, then a pure answer per provider.
 */
export async function loadAssistantProviderAccess(organizationId: string) {
  const [approvals, policies] = await Promise.all([
    listOrganizationSearchApprovals(organizationId),
    loadLiveSearchPolicies({ organizationId }),
  ])
  return (providerId: string) => {
    const source = assistantSearchSourceForProvider(providerId)
    if (!source) return true
    return (
      approvals.get(source) === true &&
      !requiresScopedRetrieval(source, livePolicyFor(policies, source))
    )
  }
}
