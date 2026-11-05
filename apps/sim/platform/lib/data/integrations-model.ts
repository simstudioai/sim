import { SIM_DOCS_URL } from '@sim/utils/site'
import type { AssistantToolPermissionsResponse } from '@/lib/api/contracts/assistant-actions'
import type { SearchIntegrationStatus } from '@/lib/api/contracts/knowledge/search-integrations'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import {
  type MemberIntegration,
  memberIntegrationEntries,
} from '@/lib/credential-groups/member-integrations'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import {
  type GenericSecrets,
  integrationSegment,
  type OrganizationIntegration,
  type ToolPermissionsModel,
} from '@/platform/lib/data/integrations-types'
import {
  memberSecretMetadata,
  providerMetadata,
} from '@/platform/lib/integrations/metadata.generated'

const CONNECT_ACCOUNT_GUIDE = `${SIM_DOCS_URL}/search/connect-your-account`

function availabilityOf(entry: MemberIntegration): OrganizationIntegration['availability'] {
  if (entry.managed) return 'managed'
  return entry.ready ? 'ready' : 'blocked'
}

function memberIntegrationStatus(entry: MemberIntegration) {
  if (entry.managed) return 'Organization managed'
  if (!entry.ready) return entry.description ?? 'Checking availability'
  if (
    entry.accounts.some(
      (account) =>
        account.status === 'needs_reauth' &&
        entry.reconnectAccountIds.includes(account.credentialId)
    )
  )
    return 'Reconnect needed'
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
    setupGuideUrl: metadata?.setupGuideUrl ?? CONNECT_ACCOUNT_GUIDE,
    searchResource: metadata?.searchResource ?? null,
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
