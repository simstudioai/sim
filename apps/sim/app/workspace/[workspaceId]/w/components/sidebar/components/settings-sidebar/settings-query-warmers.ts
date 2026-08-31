import type { QueryClient } from '@tanstack/react-query'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { apiKeysQueryOptions } from '@/hooks/queries/api-key-list'
import { byokKeysQueryOptions } from '@/hooks/queries/byok-key-list'
import { mcpServersQueryOptions } from '@/hooks/queries/mcp-server-list'
import { organizationBillingSummaryOptions } from '@/hooks/queries/organization-billing-summary'
import { getSandboxListQueryOptions } from '@/hooks/queries/sandbox-list'
import { subscriptionDataQueryOptions } from '@/hooks/queries/subscription-data'
import { workspaceCredentialListQueryOptions } from '@/hooks/queries/utils/fetch-workspace-credentials'
import { prefetchQueryOnIntent } from '@/hooks/queries/utils/prefetch-query-on-intent'
import { workflowMcpServersQueryOptions } from '@/hooks/queries/workflow-mcp-server-list'

const SETTINGS_QUERY_WARMERS: Partial<
  Record<SettingsSection, (queryClient: QueryClient, context: SettingsQueryWarmContext) => void>
> = {
  secrets: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(
      queryClient,
      workspaceCredentialListQueryOptions(workspaceId, 'env_workspace')
    ),
  apikeys: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, apiKeysQueryOptions(workspaceId, 'combined')),
  sandboxes: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, getSandboxListQueryOptions(workspaceId)),
  byok: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, byokKeysQueryOptions(workspaceId)),
  mcp: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, mcpServersQueryOptions(workspaceId)),
  'workflow-mcp-servers': (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, workflowMcpServersQueryOptions(workspaceId)),
  billing: (queryClient, { billingOrganizationId }) => {
    if (billingOrganizationId) {
      prefetchQueryOnIntent(queryClient, organizationBillingSummaryOptions(billingOrganizationId))
      return
    }
    prefetchQueryOnIntent(queryClient, subscriptionDataQueryOptions(false))
  },
}

export interface SettingsQueryWarmContext {
  workspaceId: string
  billingOrganizationId: string | null
}

/** Starts only the first-content query explicitly approved for a settings section. */
export function warmSettingsSectionQuery(
  queryClient: QueryClient,
  context: SettingsQueryWarmContext,
  section: SettingsSection
): boolean {
  const warmer = SETTINGS_QUERY_WARMERS[section]
  if (!warmer) return false

  warmer(queryClient, context)
  return true
}
