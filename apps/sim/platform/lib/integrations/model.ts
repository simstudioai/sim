import { platformHref } from '@/platform/design-system/navigation'
import type { MemberSecretSource } from '@/platform/lib/integrations/member-secret-source'

export type AccountMethod = 'oauth' | 'mcp' | 'slack'
export type ToolPolicy = 'allow' | 'ask' | 'block'

export interface IntegrationAccount {
  id: string
  label: string
  method: AccountMethod
  status: 'active' | 'needs_reauth'
  canReconnect: boolean
  permissions?: {
    read: ToolPolicy
    write: ToolPolicy
    canAutoApprove: boolean
    tools: {
      id: string
      label: string
      description?: string
      kind: 'read' | 'write'
      override: ToolPolicy | null
    }[]
  }
}

/** The member inventory is projected before the page receives it. */
export interface OrganizationIntegration {
  providerId: string
  name: string
  description: string
  requestedScopes: readonly { id: string; label: string }[] | null
  accessDescription: string
  availability: 'ready' | 'managed' | 'unconfigured' | 'disabled' | 'paused' | 'unavailable'
  connectableMethod: AccountMethod | null
  connectionCandidate?: IntegrationAccount
  fixtureAuthorization?: true
  accounts: IntegrationAccount[]
}

export interface IntegrationsData {
  integrations: OrganizationIntegration[]
  genericSecrets: MemberSecretSource | null
}

export function memberIntegrationHref(path: string, search: Pick<URLSearchParams, 'get'>) {
  const destination = platformHref(path, search)
  const query = search.get('q')
  if (!query) return destination
  return `${destination}${destination.includes('?') ? '&' : '?'}${new URLSearchParams({ q: query })}`
}

export function memberStatus(item: OrganizationIntegration) {
  switch (item.availability) {
    case 'managed':
      return 'Organization managed'
    case 'unconfigured':
      return 'Not configured'
    case 'disabled':
      return 'Disabled by your organization'
    case 'paused':
      return 'Connections paused'
    case 'unavailable':
      return 'Currently unavailable'
  }
  if (item.accounts.some((account) => account.status === 'needs_reauth' && account.canReconnect))
    return 'Reconnect needed'
  const count = item.accounts.length
  return count ? `${count} ${count === 1 ? 'account' : 'accounts'}` : 'Not connected'
}
