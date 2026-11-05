import 'server-only'
import {
  getOrganizationAccountsContract,
  getOrganizationAccountWorkspaceAccessContract,
  listOrganizationAccountPeopleContract,
} from '@/lib/api/contracts/organization-accounts'
import type { CredentialGroupsData } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/model'
import { serverRequestJson } from '@/platform/lib/data/server-request'
import { credentialGroupCatalog } from '@/platform/lib/integrations/metadata.generated'

/** Fetch only the active view. The organization contract decides which integrations are available. */
export async function readCredentialGroups(
  id: string,
  tab: string,
  query: Record<string, string | string[] | undefined>
): Promise<CredentialGroupsData> {
  const settings = await serverRequestJson(getOrganizationAccountsContract, { params: { id } })
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
      ? await serverRequestJson(getOrganizationAccountWorkspaceAccessContract, { params: { id } })
      : null
  const filter = query['credential-group-people']
  const people =
    group && settings.canManage && tab === 'people'
      ? await serverRequestJson(listOrganizationAccountPeopleContract, {
          params: { id },
          query: {
            search: typeof filter === 'string' ? filter : undefined,
            cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
          },
        })
      : null
  return {
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
    nextCursor: people?.nextCursor,
    people:
      people?.enrollments.map((person) => ({
        email: person.email,
        revoked: person.status === 'revoked',
        accounts: [
          ...person.connections
            .filter((entry) => entry.status === 'active')
            .map(
              (entry) =>
                `${credentialGroupCatalog.find((item) => item.method === 'oauth' && item.provider === entry.provider)?.name ?? 'GitLab'}${entry.count > 1 ? ` · ${entry.count}` : ''}`
            ),
          ...person.mcpConnections
            .filter((entry) => entry.status === 'active')
            .map((entry) => entry.name),
        ],
      })) ?? [],
  }
}
