import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import {
  getOrganizationAccountsContract,
  getOrganizationAccountWorkspaceAccessContract,
  listOrganizationAccountPeopleContract,
  listOrganizationAccountPeopleQuerySchema,
} from '@/lib/api/contracts/organization-accounts'
import { getOrganizationAccountWorkspaceAccess } from '@/lib/credential-groups/application/organization-access'
import { listOrganizationAccountPeople } from '@/lib/credential-groups/application/organization-account-management'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import {
  ORGANIZATION_ACCOUNTS_STALE_TIME,
  organizationAccountsKeys,
} from '@/hooks/queries/utils/organization-accounts-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import type { CredentialGroupManagement } from '@/platform/lib/data/credential-group-actions'
import type { CredentialGroupsData } from '@/platform/lib/data/models/connected-accounts'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'
import { credentialGroupCatalog } from '@/platform/lib/integrations/metadata.generated'

/**
 * Fetch only the active view. The organization contract decides which integrations are available.
 * `management` carries what the live edits send back: the group, its saved options (by id, so the
 * server keeps their scopes) and the workspace access revision. People is read a page at a time in
 * the browser; `state` seeds its first page under the browser's key.
 */
export async function readCredentialGroups(
  id: string,
  tab: string,
  query: Record<string, string | string[] | undefined>
): Promise<{
  data: CredentialGroupsData
  management: CredentialGroupManagement
  state: DehydratedState
}> {
  const { principal } = await requireSessionViewer()
  const input = { organizationId: id }
  const settings = await asRouteResponse(
    getOrganizationAccountsContract,
    await getOrganizationAccountsSettings.execute({ principal, input })
  )
  const group = settings.credentialGroup
  const oauth = new Set([
    ...settings.availableProviders,
    ...(group?.options.map((option) => option.provider) ?? []),
  ])
  const managed = new Set([
    ...settings.availableMcpConnectors,
    ...(group?.mcpServers.map((server) => server.managedConnectorId) ?? []),
  ])
  const catalog = credentialGroupCatalog.filter((item) =>
    item.method === 'oauth' ? oauth.has(item.provider) : managed.has(item.provider)
  )
  const access =
    group && settings.canManage && tab === 'workspace-access'
      ? await asRouteResponse(
          getOrganizationAccountWorkspaceAccessContract,
          await getOrganizationAccountWorkspaceAccess.execute({ principal, input })
        )
      : null
  const queryClient = makeQueryClient()
  if (group && settings.canManage && tab === 'people') {
    const filter = query['credential-group-people']
    const search = typeof filter === 'string' ? filter.trim() : ''
    await queryClient.prefetchInfiniteQuery({
      queryKey: organizationAccountsKeys.people(id, search),
      initialPageParam: undefined as string | undefined,
      staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
      queryFn: async () =>
        asRouteResponse(
          listOrganizationAccountPeopleContract,
          await listOrganizationAccountPeople.execute({
            principal,
            input: {
              ...input,
              ...listOrganizationAccountPeopleQuerySchema.parse({ search: search || undefined }),
            },
          })
        ),
    })
  }
  const management: CredentialGroupManagement = {
    groupId: group?.id ?? null,
    options:
      group?.options.map((option) => {
        const common = { id: option.id, label: option.label, required: option.required }
        return option.provider === 'slack'
          ? {
              ...common,
              provider: 'slack' as const,
              slackBotCredentialId: option.slackBotCredentialId,
            }
          : { ...common, provider: option.provider }
      }) ?? [],
    accessRevision: access?.revision ?? 0,
    databricksConfigured: Boolean(
      group?.mcpServers.some((server) => server.managedConnectorId === 'databricks')
    ),
  }
  const data: CredentialGroupsData = {
    canManage: settings.canManage,
    setup: Boolean(group),
    catalog,
    configured: [
      ...(group?.options.map((option) => `oauth:${option.provider}`) ?? []),
      ...(group?.mcpServers
        .filter((server) => server.enabled || server.managedConnectorId !== 'databricks')
        .map((server) => `mcp:${server.managedConnectorId}`) ?? []),
    ],
    workspaces: access?.workspaces ?? [],
    credentialTypes:
      access?.credentialTypes.map((type) => ({ value: type.id, label: type.label })) ?? [],
    grants:
      access?.grants.map((grant) => ({
        workspaceId: grant.workspaceId,
        types: grant.access.mode === 'all' ? 'all' : grant.access.credentialTypes,
      })) ?? [],
  }
  return { data, management, state: dehydrate(queryClient) }
}
