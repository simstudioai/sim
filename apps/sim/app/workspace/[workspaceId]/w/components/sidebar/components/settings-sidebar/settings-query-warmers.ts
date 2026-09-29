import type { QueryClient } from '@tanstack/react-query'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { forkLineageQueryOptions } from '@/ee/workspace-forking/hooks/workspace-fork'
import { apiKeysQueryOptions } from '@/hooks/queries/api-key-list'
import { customToolsQueryOptions } from '@/hooks/queries/custom-tools'
import {
  personalEnvironmentQueryOptions,
  workspaceEnvironmentQueryOptions,
} from '@/hooks/queries/environment'
import { pendingInvitationsQueryOptions } from '@/hooks/queries/invitations'
import { mcpServersQueryOptions } from '@/hooks/queries/mcp'
import { organizationBillingSummaryOptions } from '@/hooks/queries/organization-billing-summary'
import { subscriptionDataQueryOptions } from '@/hooks/queries/subscription-data'
import { workspaceCredentialListQueryOptions } from '@/hooks/queries/utils/fetch-workspace-credentials'
import { prefetchQueryOnIntent } from '@/hooks/queries/utils/prefetch-query-on-intent'
import { workflowMcpServersQueryOptions } from '@/hooks/queries/workflow-mcp-servers'

/**
 * Each section's first-content queries, started on navigation intent so they load alongside the
 * route payload instead of after the section mounts.
 */
const SETTINGS_QUERY_WARMERS: Partial<
  Record<SettingsSection, (queryClient: QueryClient, context: SettingsQueryWarmContext) => void>
> = {
  secrets: (queryClient, { workspaceId }) => {
    prefetchQueryOnIntent(queryClient, personalEnvironmentQueryOptions())
    prefetchQueryOnIntent(queryClient, workspaceEnvironmentQueryOptions(workspaceId))
    prefetchQueryOnIntent(
      queryClient,
      workspaceCredentialListQueryOptions(workspaceId, 'env_workspace')
    )
  },
  forks: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, forkLineageQueryOptions(workspaceId)),
  teammates: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, pendingInvitationsQueryOptions(workspaceId)),
  apikeys: (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, apiKeysQueryOptions(workspaceId, 'combined')),
  'custom-tools': (queryClient, { workspaceId }) =>
    prefetchQueryOnIntent(queryClient, customToolsQueryOptions(workspaceId)),
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

/** Starts approved first-content data within the workspace graph's enforced module budget. */
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
