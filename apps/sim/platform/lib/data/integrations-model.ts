import type { AssistantToolPermissionsResponse } from '@/lib/api/contracts/assistant-actions'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import {
  type MemberIntegration,
  memberIntegrationEntries,
} from '@/lib/credential-groups/member-integrations'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'
import type { OrganizationIntegration as CenterIntegration } from '@/platform/lib/integrations/fixture-model'
import {
  memberSecretMetadata,
  providerMetadata,
} from '@/platform/lib/integrations/metadata.generated'
import { integrationGuide } from '@/platform/shared/integration-guide'
import {
  type GenericSecrets,
  integrationSegment,
  type OrganizationIntegration,
  type ToolPermissionsModel,
} from '@/platform/shared/integrations'

function availabilityOf(entry: MemberIntegration): OrganizationIntegration['availability'] {
  if (entry.managed) return 'managed'
  return entry.ready ? 'ready' : 'blocked'
}

function memberIntegrationStatus(entry: MemberIntegration) {
  if (entry.managed) return 'Organization managed'
  if (!entry.ready) return entry.description ?? 'Checking availability'
  if (entry.accounts.length)
    return entry.accounts.length === 1 ? '1 account' : `${entry.accounts.length} accounts`
  return 'Not connected'
}

function toOrganizationIntegration(entry: MemberIntegration): OrganizationIntegration {
  const metadata = providerMetadata.find(({ id }) => id === entry.provider)
  return {
    id: integrationSegment(entry.id),
    providerId: entry.provider,
    icon: entry.icon,
    name: entry.name,
    description: metadata?.description ?? `Connect your ${entry.name} account to use it here`,
    category: metadata?.category ?? 'Other',
    ...integrationGuide(entry.provider, metadata),
    searchReads: metadata?.searchReads ?? [],
    requestedScopes: metadata?.requestedScopes ?? null,
    accessDescription: entry.description ?? 'Access follows your account permissions',
    availability: availabilityOf(entry),
    status: memberIntegrationStatus(entry),
    connectionTarget: entry.managed ? undefined : entry.connectionTarget,
    accounts: entry.managed
      ? []
      : entry.accounts.map((account) => ({
          id: account.credentialId,
          label: account.displayName,
          status: account.status,
          canReconnect: entry.reconnectAccountIds.includes(account.credentialId),
          hasToolPermissions: entry.permissionAccountIds.includes(account.credentialId),
          sites: 'sites' in account ? account.sites : [],
        })),
  }
}

/** Policies stay undefined until they load, so nothing is offered as connectable on a failed read. */
export function toOrganizationIntegrations(
  accounts: OrganizationAccountsSettings,
  policies: SearchIntegrationStatus[] | undefined
): OrganizationIntegration[] {
  return memberIntegrationEntries(accounts, policies).map(toOrganizationIntegration)
}

type InventoryAccount = MemberIntegration['accounts'][number]

function credentialType(account: InventoryAccount): IntegrationCredential['type'] {
  if ('mcpServerId' in account) return 'mcp'
  return 'optionId' in account ? 'oauth' : 'service_account'
}

function connectableMethod(target: MemberIntegration['connectionTarget']) {
  if (!target || 'savedProviderId' in target) return null
  return 'mcpServerId' in target ? 'mcp' : 'oauth'
}

/**
 * The live inventory in the integration center's shape. Each account is the viewer's own
 * connection, a personal credential the viewer administers alone.
 */
export function toCenterIntegrations(
  accounts: OrganizationAccountsSettings,
  policies: SearchIntegrationStatus[] | undefined,
  viewer: IntegrationPerson
): CenterIntegration[] {
  return memberIntegrationEntries(accounts, policies).map((entry) => {
    const live = toOrganizationIntegration(entry)
    const availability = entry.managed ? 'managed' : entry.ready ? 'ready' : 'unavailable'
    const credentials = entry.managed ? [] : entry.accounts
    return {
      providerId: entry.provider,
      name: live.name,
      description: live.description,
      category: live.category,
      setupGuideUrl: live.setupGuideUrl,
      searchResource: live.searchResource,
      searchReads: live.searchReads,
      requestedScopes: live.requestedScopes,
      accessDescription: entry.ready ? live.accessDescription : live.status,
      availability,
      connectableMethod: entry.managed ? null : connectableMethod(entry.connectionTarget),
      canAddCredential: availability === 'ready' && Boolean(entry.connectionTarget),
      credentialProviders: [
        ...new Set(
          credentials.map((account) =>
            'providerId' in account ? account.providerId : entry.provider
          )
        ),
      ],
      credentials: credentials.map((account) => ({
        id: account.credentialId,
        appId: entry.provider,
        providerId: 'providerId' in account ? account.providerId : entry.provider,
        type: credentialType(account),
        displayName: account.displayName,
        description: '',
        accountLabel: account.displayName,
        sites: 'sites' in account ? account.sites : [],
        role: 'admin',
        status: account.status,
        canReconnect: entry.reconnectAccountIds.includes(account.credentialId),
        scope: { kind: 'personal', ownerId: viewer.id },
        members: [
          {
            ...viewer,
            userId: viewer.id,
            role: 'admin',
            roleSource: 'explicit',
            explicitAdmin: true,
            status: 'active',
          },
        ],
      })),
    }
  })
}

export function toGenericSecrets(
  source: { mode: SecretSourceMode } | null | undefined
): GenericSecrets | null {
  return source ? { ...memberSecretMetadata, mode: source.mode } : null
}

export function toToolPermissions(data: AssistantToolPermissionsResponse): ToolPermissionsModel {
  return {
    read: data.readPolicy,
    write: data.writePolicy,
    canAutoApprove: data.canAutoApprove,
    accountActive: data.account.active,
    tools: data.tools.map((tool) => ({
      id: tool.toolId,
      label: tool.name,
      description: tool.description,
      kind: tool.effect,
      policy: tool.policy,
      inherited: tool.inherited,
    })),
  }
}
