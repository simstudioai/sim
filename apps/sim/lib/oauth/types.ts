import type { ReactNode } from 'react'

export type OAuthProvider =
  | 'google'
  | 'google-email'
  | 'google-drive'
  | 'google-docs'
  | 'google-sheets'
  | 'google-calendar'
  | 'google-vault'
  | 'google-forms'
  | 'google-groups'
  | 'vertex-ai'
  | 'github'
  | 'github-repo'
  | 'x'
  | 'confluence'
  | 'airtable'
  | 'notion'
  | 'jira'
  | 'dropbox'
  | 'microsoft'
  | 'microsoft-excel'
  | 'microsoft-planner'
  | 'microsoft-teams'
  | 'outlook'
  | 'onedrive'
  | 'sharepoint'
  | 'linear'
  | 'slack'
  | 'reddit'
  | 'trello'
  | 'wealthbox'
  | 'webflow'
  | 'asana'
  | 'pipedrive'
  | 'hubspot'
  | 'salesforce'
  | 'linkedin'
  | 'shopify'
  | 'zoom'
  | 'wordpress'
  | 'spotify'
  | 'calcom'

export type OAuthService =
  | 'google'
  | 'google-email'
  | 'google-drive'
  | 'google-docs'
  | 'google-sheets'
  | 'google-calendar'
  | 'google-vault'
  | 'google-forms'
  | 'google-groups'
  | 'vertex-ai'
  | 'github'
  | 'x'
  | 'confluence'
  | 'airtable'
  | 'notion'
  | 'jira'
  | 'dropbox'
  | 'microsoft-excel'
  | 'microsoft-teams'
  | 'microsoft-planner'
  | 'sharepoint'
  | 'outlook'
  | 'linear'
  | 'slack'
  | 'reddit'
  | 'wealthbox'
  | 'onedrive'
  | 'webflow'
  | 'trello'
  | 'asana'
  | 'pipedrive'
  | 'hubspot'
  | 'salesforce'
  | 'linkedin'
  | 'shopify'
  | 'zoom'
  | 'wordpress'
  | 'spotify'
  | 'calcom'

export interface OAuthProviderConfig {
  name: string
  icon: (props: { className?: string }) => ReactNode
  services: Record<string, OAuthServiceConfig>
  defaultService: string
}

export interface OAuthServiceConfig {
  name: string
  description: string
  providerId: string
  icon: (props: { className?: string }) => ReactNode
  baseProviderIcon: (props: { className?: string }) => ReactNode
  scopes: string[]
}

/**
 * Service metadata without React components - safe for server-side use
 */
export interface OAuthServiceMetadata {
  providerId: string
  name: string
  description: string
  baseProvider: string
}

export interface ScopeEvaluation {
  canonicalScopes: string[]
  grantedScopes: string[]
  missingScopes: string[]
  extraScopes: string[]
  requiresReauthorization: boolean
}

export interface Credential {
  id: string
  name: string
  provider: OAuthProvider
  serviceId?: string
  lastUsed?: string
  isDefault?: boolean
  scopes?: string[]
  canonicalScopes?: string[]
  missingScopes?: string[]
  extraScopes?: string[]
  requiresReauthorization?: boolean
}

export interface ProviderConfig {
  baseProvider: string
  featureType: string
}
