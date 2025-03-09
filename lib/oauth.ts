import { ReactNode } from 'react'
import {
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleIcon,
  GoogleSheetsIcon,
  SupabaseIcon,
  xIcon,
} from '@/components/icons'

// Define the base OAuth provider type
export type OAuthProvider = 'google' | 'github' | 'x' | 'supabase' | string
export type OAuthService =
  | 'google'
  | 'google-email'
  | 'google-drive'
  | 'google-docs'
  | 'google-sheets'
  | 'github'
  | 'x'
  | 'supabase'

// Define the interface for OAuth provider configuration
export interface OAuthProviderConfig {
  id: OAuthProvider
  name: string
  icon: (props: { className?: string }) => ReactNode
  services: Record<string, OAuthServiceConfig>
  defaultService: string
}

// Define the interface for OAuth service configuration
export interface OAuthServiceConfig {
  id: string
  name: string
  description: string
  providerId: string
  icon: (props: { className?: string }) => ReactNode
  baseProviderIcon: (props: { className?: string }) => ReactNode
  scopes: string[]
}

// Define the available OAuth providers
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    id: 'google',
    name: 'Google',
    icon: (props) => GoogleIcon(props),
    services: {
      gmail: {
        id: 'gmail',
        name: 'Gmail',
        description: 'Automate email workflows and enhance communication efficiency.',
        providerId: 'google-email',
        icon: (props) => GmailIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.readonly',
        ],
      },
      'google-drive': {
        id: 'google-drive',
        name: 'Google Drive',
        description: 'Streamline file organization and document workflows.',
        providerId: 'google-drive',
        icon: (props) => GoogleDriveIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: ['https://www.googleapis.com/auth/drive'],
      },
      'google-docs': {
        id: 'google-docs',
        name: 'Google Docs',
        description: 'Create, read, and edit Google Documents programmatically.',
        providerId: 'google-docs',
        icon: (props) => GoogleDocsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: ['https://www.googleapis.com/auth/documents'],
      },
      'google-sheets': {
        id: 'google-sheets',
        name: 'Google Sheets',
        description: 'Manage and analyze data with Google Sheets integration.',
        providerId: 'google-sheets',
        icon: (props) => GoogleSheetsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      },
      'google-calendar': {
        id: 'google-calendar',
        name: 'Google Calendar',
        description: 'Schedule and manage events with Google Calendar.',
        providerId: 'google-calendar',
        icon: (props) => GoogleCalendarIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: ['https://www.googleapis.com/auth/calendar'],
      },
    },
    defaultService: 'gmail',
  },
  github: {
    id: 'github',
    name: 'GitHub',
    icon: (props) => GithubIcon(props),
    services: {
      github: {
        id: 'github',
        name: 'GitHub',
        description: 'Manage repositories, issues, and pull requests.',
        providerId: 'github-repo',
        icon: (props) => GithubIcon(props),
        baseProviderIcon: (props) => GithubIcon(props),
        scopes: ['repo', 'user'],
      },
      'github-workflow': {
        id: 'github-workflow',
        name: 'GitHub Actions',
        description: 'Trigger and manage GitHub Actions workflows.',
        providerId: 'github-workflow',
        icon: (props) => GithubIcon(props),
        baseProviderIcon: (props) => GithubIcon(props),
        scopes: ['repo', 'workflow'],
      },
    },
    defaultService: 'github',
  },
  x: {
    id: 'x',
    name: 'X',
    icon: (props) => xIcon(props),
    services: {
      x: {
        id: 'x',
        name: 'X',
        description: 'Post tweets and interact with the X API.',
        providerId: 'x',
        icon: (props) => xIcon(props),
        baseProviderIcon: (props) => xIcon(props),
        scopes: [],
      },
    },
    defaultService: 'x',
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    icon: (props) => SupabaseIcon(props),
    services: {
      supabase: {
        id: 'supabase',
        name: 'Supabase',
        description: 'Connect to your Supabase projects and manage data.',
        providerId: 'supabase',
        icon: (props) => SupabaseIcon(props),
        baseProviderIcon: (props) => SupabaseIcon(props),
        scopes: ['database.read', 'database.write', 'projects.read'],
      },
    },
    defaultService: 'supabase',
  },
}

// Helper function to get a service by provider and service ID
export function getServiceByProviderAndId(
  provider: OAuthProvider,
  serviceId?: string
): OAuthServiceConfig {
  const providerConfig = OAUTH_PROVIDERS[provider]
  if (!providerConfig) {
    throw new Error(`Provider ${provider} not found`)
  }

  if (!serviceId) {
    return providerConfig.services[providerConfig.defaultService]
  }

  return (
    providerConfig.services[serviceId] || providerConfig.services[providerConfig.defaultService]
  )
}

// Helper function to determine service ID from scopes
export function getServiceIdFromScopes(provider: OAuthProvider, scopes: string[]): string {
  const providerConfig = OAUTH_PROVIDERS[provider]
  if (!providerConfig) {
    return provider
  }

  if (provider === 'google') {
    if (scopes.some((scope) => scope.includes('gmail') || scope.includes('mail'))) {
      return 'gmail'
    } else if (scopes.some((scope) => scope.includes('drive'))) {
      return 'google-drive'
    } else if (scopes.some((scope) => scope.includes('docs'))) {
      return 'google-docs'
    } else if (scopes.some((scope) => scope.includes('sheets'))) {
      return 'google-sheets'
    } else if (scopes.some((scope) => scope.includes('calendar'))) {
      return 'google-calendar'
    }
  } else if (provider === 'github') {
    if (scopes.some((scope) => scope.includes('workflow'))) {
      return 'github-workflow'
    }
  } else if (provider === 'supabase') {
    return 'supabase'
  }

  return providerConfig.defaultService
}

// Helper function to get provider ID from service ID
export function getProviderIdFromServiceId(serviceId: string): string {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    for (const [id, service] of Object.entries(provider.services)) {
      if (id === serviceId) {
        return service.providerId
      }
    }
  }

  // Default fallback
  return serviceId
}

// Interface for credential objects
export interface Credential {
  id: string
  name: string
  provider: OAuthProvider
  serviceId?: string
  lastUsed?: string
  isDefault?: boolean
}

// Interface for provider configuration
export interface ProviderConfig {
  baseProvider: string
  featureType: string
}

/**
 * Parse a provider string into its base provider and feature type
 * This is a server-safe utility that can be used in both client and server code
 */
export function parseProvider(provider: OAuthProvider): ProviderConfig {
  // Handle compound providers (e.g., 'google-email' -> { baseProvider: 'google', featureType: 'email' })
  const [base, feature] = provider.split('-')

  if (feature) {
    return {
      baseProvider: base,
      featureType: feature,
    }
  }

  // For simple providers, use 'default' as feature type
  return {
    baseProvider: provider,
    featureType: 'default',
  }
}
