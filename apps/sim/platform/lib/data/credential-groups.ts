import 'server-only'
import {
  getOrganizationAccountsContract,
  getOrganizationAccountWorkspaceAccessContract,
  listOrganizationAccountPeopleContract,
  listOrganizationAccountPeopleQuerySchema,
} from '@/lib/api/contracts/organization-accounts'
import { getOrganizationAccountWorkspaceAccess } from '@/lib/credential-groups/application/organization-access'
import { listOrganizationAccountPeople } from '@/lib/credential-groups/application/organization-account-management'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import type { CredentialGroupsData } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/model'
import type { CredentialGroupManagement } from '@/platform/lib/data/credential-group-actions'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'
import { credentialGroupCatalog } from '@/platform/lib/integrations/metadata.generated'

/**
 * Fetch only the active view. The organization contract decides which integrations are available.
 * `management` carries what the live edits send back: the group, its saved options (by id, so the
 * server keeps their scopes) and the workspace access revision.
 */
export async function readCredentialGroups(
  id: string,
  tab: string,
  query: Record<string, string | string[] | undefined>
): Promise<{ data: CredentialGroupsData; management: CredentialGroupManagement }> {
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
  const filter = query['credential-group-people']
  const people =
    group && settings.canManage && tab === 'people'
      ? await asRouteResponse(
          listOrganizationAccountPeopleContract,
          await listOrganizationAccountPeople.execute({
            principal,
            input: {
              ...input,
              ...listOrganizationAccountPeopleQuerySchema.parse({
                search: typeof filter === 'string' ? filter : undefined,
                cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
              }),
            },
          })
        )
      : null
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
    nextCursor: people?.nextCursor,
    people:
      people?.enrollments.map((person) => ({
        id: person.id,
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
  return { data, management }
}
