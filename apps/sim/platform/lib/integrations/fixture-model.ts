import { integrationCenterHref } from '@/platform/lib/integrations/center-navigation'
import type {
  CredentialToolPermissions,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'
import type { MemberSecretSource } from '@/platform/lib/integrations/member-secret-source'
import { platformHref } from '@/platform/lib/navigation'

export type AccountMethod = 'oauth' | 'mcp' | 'slack'

export interface IntegrationAccount {
  id: string
  label: string
  method: AccountMethod
  status: 'active' | 'needs_reauth'
  canReconnect: boolean
  permissions?: CredentialToolPermissions
}

/** The member inventory is projected before the page receives it. */
export interface OrganizationIntegration {
  providerId: string
  name: string
  description: string
  category?: string
  setupGuideUrl: string
  searchResource: string | null
  searchReads: readonly { id: string; label: string }[]
  requestedScopes: readonly { id: string; label: string }[] | null
  accessDescription: string
  availability:
    | 'ready'
    | 'managed'
    | 'unconfigured'
    | 'disabled'
    | 'paused'
    | 'unavailable'
    | 'catalog'
  connectableMethod: AccountMethod | null
  fixtureAuthorization?: true
  canAddCredential: boolean
  credentialProviders: readonly string[]
  credentials: IntegrationCredential[]
}

export interface IntegrationsData {
  integrations: OrganizationIntegration[]
  genericSecrets: MemberSecretSource | null
}

export function memberIntegrationHref(
  path: string,
  search: URLSearchParams,
  query = search.get('q')
) {
  return integrationCenterHref(platformHref(path, search), search, query)
}
