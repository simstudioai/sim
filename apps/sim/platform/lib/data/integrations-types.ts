import type { ComponentType } from 'react'
import type {
  AssistantToolPermissionsResponse,
  UpdateAssistantToolPermissionsBody,
} from '@/lib/api/contracts/assistant-actions'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { LIVE_SEARCH_PROVIDER_IDS } from '@/lib/sim-search/live/provider-catalog'

export type ToolPolicy = AssistantToolPermissionsResponse['readPolicy']

export interface IntegrationAccount {
  id: string
  label: string
  status: 'active' | 'needs_reauth'
  canReconnect: boolean
  hasToolPermissions: boolean
}

/** The member inventory is projected before the page receives it. */
export interface OrganizationIntegration {
  /** The `/integrations/[provider]` segment. */
  id: string
  providerId: string
  icon: ComponentType<{ className?: string }>
  name: string
  description: string
  category: string
  setupGuideUrl: string
  searchResource: string | null
  searchReads: readonly { id: string; label: string }[]
  requestedScopes: readonly { id: string; label: string }[] | null
  accessDescription: string
  /** `blocked` carries its reason in `status`. */
  availability: 'ready' | 'managed' | 'blocked'
  status: string
  /** The free connection slot, absent when every slot holds an account. */
  connectionTarget?: { optionId: string } | { mcpServerId: string }
  accounts: readonly IntegrationAccount[]
}

export interface GenericSecrets {
  name: string
  description: string
  setupGuideUrl: string
  mode: SecretSourceMode
}

export interface ToolPermissionsModel {
  read: ToolPolicy
  write: ToolPolicy
  canAutoApprove: boolean
  accountActive: boolean
  tools: readonly {
    id: string
    label: string
    description: string
    kind: 'read' | 'write'
    policy: ToolPolicy
    inherited: boolean
  }[]
}

export type ToolPermissionChange = UpdateAssistantToolPermissionsBody['change']

/** The segment for Generic Secrets' read-only view; `/integrations/secrets` is the personal editor. */
export const GENERIC_SECRETS_SEGMENT = 'generic-secrets'

const LIVE_SEARCH_SEGMENTS: ReadonlySet<string> = new Set(LIVE_SEARCH_PROVIDER_IDS)

/**
 * Maps an inventory id (`source:gmail`, `app:notion`) to its URL segment. An Assistant app can share
 * a provider id with a Search source that has no member accounts, so it takes the bare segment only
 * when no source could claim it. Anything else is left as it came.
 */
export function integrationSegment(inventoryId: string): string {
  const [kind, provider] = inventoryId.split(':')
  if (kind === 'source' && provider) return provider
  if (kind === 'app' && provider)
    return LIVE_SEARCH_SEGMENTS.has(provider) ? `${provider}-app` : provider
  return inventoryId
}

export function integrationPath(organizationId: string, segment: string) {
  return `${organizationRoutes(organizationId).integrations}/${encodeURIComponent(segment)}`
}

export function isConnectable(integration: OrganizationIntegration) {
  return integration.availability === 'ready' && Boolean(integration.connectionTarget)
}

export function accountStatus(integration: OrganizationIntegration) {
  return integration.availability === 'blocked' ? integration.status : 'Connected'
}
