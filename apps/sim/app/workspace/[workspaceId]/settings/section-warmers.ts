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
 * Each code-split section's module, shared by its `dynamic()` body and the navigation-intent
 * warmer so a section's chunk can start loading on hover or press rather than after its route.
 */
export const SECTION_MODULES = {
  admin: () => import('@/app/workspace/[workspaceId]/settings/components/admin/admin'),
  apikeys: () => import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys'),
  byok: () => import('@/app/workspace/[workspaceId]/settings/components/byok/byok'),
  forks: () => import('@/ee/workspace-forking/components/forks'),
  secrets: () => import('@/app/workspace/[workspaceId]/settings/components/secrets/secrets'),
  'connected-accounts': () =>
    import('@/ee/credential-groups/components/organization-connected-accounts'),
  sandboxes: () => import('@/app/workspace/[workspaceId]/settings/components/sandboxes/sandboxes'),
  'custom-tools': () =>
    import('@/app/workspace/[workspaceId]/settings/components/custom-tools/custom-tools'),
  inbox: () => import('@/app/workspace/[workspaceId]/settings/components/inbox/inbox'),
  mcp: () => import('@/app/workspace/[workspaceId]/settings/components/mcp/mcp'),
  mothership: () =>
    import('@/app/workspace/[workspaceId]/settings/components/mothership/mothership'),
  'recently-deleted': () =>
    import('@/app/workspace/[workspaceId]/settings/components/recently-deleted/recently-deleted'),
  'self-host': () =>
    import('@/app/workspace/[workspaceId]/settings/components/self-host/self-host'),
  billing: () => import('@/app/workspace/[workspaceId]/settings/components/billing/billing'),
  teammates: () => import('@/app/workspace/[workspaceId]/settings/components/teammates/teammates'),
  organization: () =>
    import('@/app/workspace/[workspaceId]/settings/components/team-management/team-management'),
  'workflow-mcp-servers': () =>
    import(
      '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/workflow-mcp-servers'
    ),
  'access-control': () => import('@/ee/access-control/components/access-control'),
  requests: () => import('@/ee/access-requests/components/access-requests-settings'),
  'custom-blocks': () => import('@/ee/custom-blocks/components/custom-blocks'),
  'audit-logs': () => import('@/ee/audit-logs/components/audit-logs'),
  sso: () => import('@/ee/sso/components/sso-settings'),
  'data-retention': () => import('@/ee/data-retention/components/data-retention-settings'),
  'data-drains': () => import('@/ee/data-drains/components/data-drains-settings'),
  security: () => import('@/components/settings/organization-security'),
  usage: () => import('@/ee/organization-usage/components/usage-monitoring'),
  desktop: () => import('@/app/workspace/[workspaceId]/settings/components/desktop/desktop'),
  browser: () => import('@/app/workspace/[workspaceId]/settings/components/browser/browser'),
  terminal: () => import('@/app/workspace/[workspaceId]/settings/components/terminal/terminal'),
  whitelabeling: () => import('@/ee/whitelabeling/components/whitelabeling-settings'),
} satisfies Partial<Record<SettingsSection, () => Promise<unknown>>>

/** Each section's first-content queries. */
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

/**
 * Warms a section on sidebar navigation intent: its code-split chunk and its first-content
 * queries start alongside the route payload instead of after the section mounts.
 */
export function warmSettingsSection(
  queryClient: QueryClient,
  context: SettingsQueryWarmContext,
  section: SettingsSection
): void {
  // A failed warm is not an error: the section's own load reports it if the navigation happens.
  SECTION_MODULES[section as keyof typeof SECTION_MODULES]?.().catch(() => {})
  SETTINGS_QUERY_WARMERS[section]?.(queryClient, context)
}
