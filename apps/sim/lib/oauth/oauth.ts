import type { ReactNode } from 'react'
import {
  AirtableIcon,
  ConfluenceIcon,
  DiscordIcon,
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleIcon,
  GoogleSheetsIcon,
  JiraIcon,
  LinearIcon,
  MicrosoftExcelIcon,
  MicrosoftIcon,
  MicrosoftTeamsIcon,
  NotionIcon,
  OutlookIcon,
  RedditIcon,
  SlackIcon,
  SupabaseIcon,
  WealthboxIcon,
  xIcon,
} from '@/components/icons'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('OAuth')

export type OAuthProvider =
  | 'google'
  | 'github'
  | 'x'
  | 'supabase'
  | 'confluence'
  | 'airtable'
  | 'notion'
  | 'jira'
  | 'discord'
  | 'microsoft'
  | 'linear'
  | 'slack'
  | 'reddit'
  | 'wealthbox'
  | string

export type OAuthService =
  | 'google'
  | 'google-email'
  | 'google-drive'
  | 'google-docs'
  | 'google-sheets'
  | 'google-calendar'
  | 'github'
  | 'x'
  | 'supabase'
  | 'confluence'
  | 'airtable'
  | 'notion'
  | 'jira'
  | 'discord'
  | 'microsoft-excel'
  | 'microsoft-teams'
  | 'outlook'
  | 'linear'
  | 'slack'
  | 'reddit'
  | 'wealthbox'

export interface OAuthProviderConfig {
  id: OAuthProvider
  name: string
  icon: (props: { className?: string }) => ReactNode
  services: Record<string, OAuthServiceConfig>
  defaultService: string
}

export interface OAuthServiceConfig {
  id: string
  name: string
  description: string
  providerId: string
  icon: (props: { className?: string }) => ReactNode
  baseProviderIcon: (props: { className?: string }) => ReactNode
  scopes: string[]
}

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
          'https://www.googleapis.com/auth/gmail.modify',
          // 'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.labels',
        ],
      },
      'google-drive': {
        id: 'google-drive',
        name: 'Google Drive',
        description: 'Streamline file organization and document workflows.',
        providerId: 'google-drive',
        icon: (props) => GoogleDriveIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
      'google-docs': {
        id: 'google-docs',
        name: 'Google Docs',
        description: 'Create, read, and edit Google Documents programmatically.',
        providerId: 'google-docs',
        icon: (props) => GoogleDocsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
      'google-sheets': {
        id: 'google-sheets',
        name: 'Google Sheets',
        description: 'Manage and analyze data with Google Sheets integration.',
        providerId: 'google-sheets',
        icon: (props) => GoogleSheetsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.file',
        ],
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
  microsoft: {
    id: 'microsoft',
    name: 'Microsoft',
    icon: (props) => MicrosoftIcon(props),
    services: {
      'microsoft-excel': {
        id: 'microsoft-excel',
        name: 'Microsoft Excel',
        description: 'Connect to Microsoft Excel and manage spreadsheets.',
        providerId: 'microsoft-excel',
        icon: (props) => MicrosoftExcelIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
      },
      'microsoft-teams': {
        id: 'microsoft-teams',
        name: 'Microsoft Teams',
        description: 'Connect to Microsoft Teams and manage messages.',
        providerId: 'microsoft-teams',
        icon: (props) => MicrosoftTeamsIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: [
          'openid',
          'profile',
          'email',
          'User.Read',
          'Chat.Read',
          'Chat.ReadWrite',
          'Chat.ReadBasic',
          'Channel.ReadBasic.All',
          'ChannelMessage.Send',
          'ChannelMessage.Read.All',
          'Group.Read.All',
          'Group.ReadWrite.All',
          'Team.ReadBasic.All',
          'offline_access',
        ],
      },
      outlook: {
        id: 'outlook',
        name: 'Outlook',
        description: 'Connect to Outlook and manage emails.',
        providerId: 'outlook',
        icon: (props) => OutlookIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: [
          'openid',
          'profile',
          'email',
          'Mail.ReadWrite',
          'Mail.ReadBasic',
          'Mail.Read',
          'Mail.Send',
          'offline_access',
        ],
      },
    },
    defaultService: 'microsoft',
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
        scopes: ['repo', 'user:email', 'read:user', 'workflow'],
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
        description: 'Read and post tweets on X (formerly Twitter).',
        providerId: 'x',
        icon: (props) => xIcon(props),
        baseProviderIcon: (props) => xIcon(props),
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
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
  confluence: {
    id: 'confluence',
    name: 'Confluence',
    icon: (props) => ConfluenceIcon(props),
    services: {
      confluence: {
        id: 'confluence',
        name: 'Confluence',
        description: 'Access Confluence content and documentation.',
        providerId: 'confluence',
        icon: (props) => ConfluenceIcon(props),
        baseProviderIcon: (props) => ConfluenceIcon(props),
        scopes: ['read:page:confluence', 'write:page:confluence', 'read:me', 'offline_access'],
      },
    },
    defaultService: 'confluence',
  },
  jira: {
    id: 'jira',
    name: 'Jira',
    icon: (props) => JiraIcon(props),
    services: {
      jira: {
        id: 'jira',
        name: 'Jira',
        description: 'Access Jira projects and issues.',
        providerId: 'jira',
        icon: (props) => JiraIcon(props),
        baseProviderIcon: (props) => JiraIcon(props),
        scopes: [
          'read:jira-user',
          'read:jira-work',
          'write:jira-work',
          'read:project:jira',
          'read:issue-type:jira',
          'read:me',
          'offline_access',
        ],
      },
    },
    defaultService: 'jira',
  },
  airtable: {
    id: 'airtable',
    name: 'Airtable',
    icon: (props) => AirtableIcon(props),
    services: {
      airtable: {
        id: 'airtable',
        name: 'Airtable',
        description: 'Manage Airtable bases, tables, and records.',
        providerId: 'airtable',
        icon: (props) => AirtableIcon(props),
        baseProviderIcon: (props) => AirtableIcon(props),
        scopes: ['data.records:read', 'data.records:write'],
      },
    },
    defaultService: 'airtable',
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    icon: (props) => DiscordIcon(props),
    services: {
      discord: {
        id: 'discord',
        name: 'Discord',
        description: 'Read and send messages to Discord channels and interact with servers.',
        providerId: 'discord',
        icon: (props) => DiscordIcon(props),
        baseProviderIcon: (props) => DiscordIcon(props),
        scopes: ['identify', 'bot', 'messages.read', 'guilds', 'guilds.members.read'],
      },
    },
    defaultService: 'discord',
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    icon: (props) => NotionIcon(props),
    services: {
      notion: {
        id: 'notion',
        name: 'Notion',
        description: 'Connect to your Notion workspace to manage pages and databases.',
        providerId: 'notion',
        icon: (props) => NotionIcon(props),
        baseProviderIcon: (props) => NotionIcon(props),
        scopes: ['workspace.content', 'workspace.name', 'page.read', 'page.write'],
      },
    },
    defaultService: 'notion',
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    icon: (props) => LinearIcon(props),
    services: {
      linear: {
        id: 'linear',
        name: 'Linear',
        description: 'Manage issues and projects in Linear.',
        providerId: 'linear',
        icon: (props) => LinearIcon(props),
        baseProviderIcon: (props) => LinearIcon(props),
        scopes: ['read', 'write'],
      },
    },
    defaultService: 'linear',
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    icon: (props) => SlackIcon(props),
    services: {
      slack: {
        id: 'slack',
        name: 'Slack',
        description: 'Send messages using a Slack bot.',
        providerId: 'slack',
        icon: (props) => SlackIcon(props),
        baseProviderIcon: (props) => SlackIcon(props),
        scopes: [
          'channels:read',
          'chat:write',
          'chat:write.public',
          'users:read',
          'files:read',
          'links:read',
          'links:write',
        ],
      },
    },
    defaultService: 'slack',
  },
  reddit: {
    id: 'reddit',
    name: 'Reddit',
    icon: (props) => RedditIcon(props),
    services: {
      reddit: {
        id: 'reddit',
        name: 'Reddit',
        description: 'Access Reddit data and content from subreddits.',
        providerId: 'reddit',
        icon: (props) => RedditIcon(props),
        baseProviderIcon: (props) => RedditIcon(props),
        scopes: ['identity', 'read'],
      },
    },
    defaultService: 'reddit',
  },
  wealthbox: {
    id: 'wealthbox',
    name: 'Wealthbox',
    icon: (props) => WealthboxIcon(props),
    services: {
      wealthbox: {
        id: 'wealthbox',
        name: 'Wealthbox',
        description: 'Manage contacts, notes, and tasks in your Wealthbox CRM.',
        providerId: 'wealthbox',
        icon: (props) => WealthboxIcon(props),
        baseProviderIcon: (props) => WealthboxIcon(props),
        scopes: ['login', 'data'],
      },
    },
    defaultService: 'wealthbox',
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
    }
    if (scopes.some((scope) => scope.includes('drive'))) {
      return 'google-drive'
    }
    if (scopes.some((scope) => scope.includes('docs'))) {
      return 'google-docs'
    }
    if (scopes.some((scope) => scope.includes('sheets'))) {
      return 'google-sheets'
    }
    if (scopes.some((scope) => scope.includes('calendar'))) {
      return 'google-calendar'
    }
  } else if (provider === 'microsoft-teams') {
    return 'microsoft-teams'
  } else if (provider === 'outlook') {
    return 'outlook'
  } else if (provider === 'github') {
    return 'github'
  } else if (provider === 'supabase') {
    return 'supabase'
  } else if (provider === 'x') {
    return 'x'
  } else if (provider === 'confluence') {
    return 'confluence'
  } else if (provider === 'jira') {
    return 'jira'
  } else if (provider === 'airtable') {
    return 'airtable'
  } else if (provider === 'notion') {
    return 'notion'
  } else if (provider === 'discord') {
    return 'discord'
  } else if (provider === 'linear') {
    return 'linear'
  } else if (provider === 'slack') {
    return 'slack'
  } else if (provider === 'reddit') {
    return 'reddit'
  } else if (provider === 'wealthbox') {
    return 'wealthbox'
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
  // Handle special cases first
  if (provider === 'outlook') {
    return {
      baseProvider: 'microsoft',
      featureType: 'outlook',
    }
  }

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

interface ProviderAuthConfig {
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  useBasicAuth: boolean
  additionalHeaders?: Record<string, string>
  supportsRefreshTokenRotation?: boolean
}

/**
 * Get OAuth provider configuration for token refresh
 */
function getProviderAuthConfig(provider: string): ProviderAuthConfig {
  const getCredentials = (clientId: string | undefined, clientSecret: string | undefined) => {
    if (!clientId || !clientSecret) {
      throw new Error(`Missing client credentials for provider: ${provider}`)
    }
    return { clientId, clientSecret }
  }

  switch (provider) {
    case 'google': {
      const { clientId, clientSecret } = getCredentials(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'github': {
      const { clientId, clientSecret } = getCredentials(
        env.GITHUB_CLIENT_ID,
        env.GITHUB_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://github.com/login/oauth/access_token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        additionalHeaders: { Accept: 'application/json' },
      }
    }
    case 'x': {
      const { clientId, clientSecret } = getCredentials(env.X_CLIENT_ID, env.X_CLIENT_SECRET)
      return {
        tokenEndpoint: 'https://api.x.com/2/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
      }
    }
    case 'confluence': {
      const { clientId, clientSecret } = getCredentials(
        env.CONFLUENCE_CLIENT_ID,
        env.CONFLUENCE_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'jira': {
      const { clientId, clientSecret } = getCredentials(env.JIRA_CLIENT_ID, env.JIRA_CLIENT_SECRET)
      return {
        tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'airtable': {
      const { clientId, clientSecret } = getCredentials(
        env.AIRTABLE_CLIENT_ID,
        env.AIRTABLE_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://airtable.com/oauth2/v1/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'supabase': {
      const { clientId, clientSecret } = getCredentials(
        env.SUPABASE_CLIENT_ID,
        env.SUPABASE_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://api.supabase.com/v1/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'notion': {
      const { clientId, clientSecret } = getCredentials(
        env.NOTION_CLIENT_ID,
        env.NOTION_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'discord': {
      const { clientId, clientSecret } = getCredentials(
        env.DISCORD_CLIENT_ID,
        env.DISCORD_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://discord.com/api/v10/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
      }
    }
    case 'microsoft': {
      const { clientId, clientSecret } = getCredentials(
        env.MICROSOFT_CLIENT_ID,
        env.MICROSOFT_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'outlook': {
      const { clientId, clientSecret } = getCredentials(
        env.MICROSOFT_CLIENT_ID,
        env.MICROSOFT_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'linear': {
      const { clientId, clientSecret } = getCredentials(
        env.LINEAR_CLIENT_ID,
        env.LINEAR_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://api.linear.app/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
      }
    }
    case 'slack': {
      const { clientId, clientSecret } = getCredentials(
        env.SLACK_CLIENT_ID,
        env.SLACK_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'reddit': {
      const { clientId, clientSecret } = getCredentials(
        env.REDDIT_CLIENT_ID,
        env.REDDIT_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://www.reddit.com/api/v1/access_token',
        clientId,
        clientSecret,
        useBasicAuth: true,
      }
    }
    case 'wealthbox': {
      const { clientId, clientSecret } = getCredentials(
        env.WEALTHBOX_CLIENT_ID,
        env.WEALTHBOX_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://app.crmworkspace.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

/**
 * Build the authentication request headers and body for OAuth token refresh
 */
function buildAuthRequest(
  config: ProviderAuthConfig,
  refreshToken: string
): { headers: Record<string, string>; bodyParams: Record<string, string> } {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...config.additionalHeaders,
  }

  const bodyParams: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }

  if (config.useBasicAuth) {
    // Use Basic Authentication - credentials in Authorization header only
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${basicAuth}`
  } else {
    // Use body credentials - include client credentials in request body
    bodyParams.client_id = config.clientId
    bodyParams.client_secret = config.clientSecret
  }

  return { headers, bodyParams }
}

/**
 * Refresh an OAuth token
 * This is a server-side utility function to refresh OAuth tokens
 * @param providerId The provider ID (e.g., 'google-drive')
 * @param refreshToken The refresh token to use
 * @returns Object containing the new access token and expiration time in seconds, or null if refresh failed
 */
export async function refreshOAuthToken(
  providerId: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; refreshToken: string } | null> {
  try {
    // Get the provider from the providerId (e.g., 'google-drive' -> 'google')
    const provider = providerId.split('-')[0]

    // Get provider configuration
    const config = getProviderAuthConfig(provider)

    // Build authentication request
    const { headers, bodyParams } = buildAuthRequest(config, refreshToken)

    // Refresh the token
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: new URLSearchParams(bodyParams).toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorData = errorText

      // Try to parse the error as JSON for better diagnostics
      try {
        errorData = JSON.parse(errorText)
      } catch (_e) {
        // Not JSON, keep as text
      }

      logger.error('Token refresh failed:', {
        status: response.status,
        error: errorText,
        parsedError: errorData,
        provider,
        providerId,
      })
      throw new Error(`Failed to refresh token: ${response.status} ${errorText}`)
    }

    const data = await response.json()

    // Extract token and expiration (different providers may use different field names)
    const accessToken = data.access_token

    // Handle refresh token rotation for providers that support it
    let newRefreshToken = null
    if (config.supportsRefreshTokenRotation && data.refresh_token) {
      newRefreshToken = data.refresh_token
      logger.info(`Received new refresh token from ${provider}`)
    }

    // Get expiration time - use provider's value or default to 1 hour (3600 seconds)
    // Different providers use different names for this field
    const expiresIn = data.expires_in || data.expiresIn || 3600

    if (!accessToken) {
      logger.warn('No access token found in refresh response', data)
      return null
    }

    logger.info('Token refreshed successfully with expiration', {
      expiresIn,
      hasNewRefreshToken: !!newRefreshToken,
      provider,
    })

    return {
      accessToken,
      expiresIn,
      refreshToken: newRefreshToken || refreshToken, // Return new refresh token if available
    }
  } catch (error) {
    logger.error('Error refreshing token:', { error })
    return null
  }
}
