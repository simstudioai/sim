import type { ReactNode } from 'react'
import {
  AirtableIcon,
  AsanaIcon,
  ConfluenceIcon,
  DiscordIcon,
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleFormsIcon,
  GoogleIcon,
  GoogleSheetsIcon,
  HubspotIcon,
  JiraIcon,
  LinearIcon,
  MicrosoftExcelIcon,
  MicrosoftIcon,
  MicrosoftOneDriveIcon,
  MicrosoftPlannerIcon,
  MicrosoftSharepointIcon,
  MicrosoftTeamsIcon,
  NotionIcon,
  OutlookIcon,
  PipedriveIcon,
  RedditIcon,
  SalesforceIcon,
  SlackIcon,
  SupabaseIcon,
  TrelloIcon,
  WealthboxIcon,
  WebflowIcon,
  xIcon,
} from '@/components/icons'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

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
  | 'trello'
  | 'wealthbox'
  | 'webflow'
  | 'asana'
  | 'pipedrive'
  | 'hubspot'
  | 'salesforce'
  | string

export type OAuthService =
  | 'google'
  | 'google-email'
  | 'google-drive'
  | 'google-docs'
  | 'google-sheets'
  | 'google-calendar'
  | 'google-vault'
  | 'google-forms'
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
  scopeHints?: string[]
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
          'https://www.googleapis.com/auth/gmail.labels',
        ],
        scopeHints: ['gmail', 'mail'],
      },
      'google-drive': {
        id: 'google-drive',
        name: 'Google Drive',
        description: 'Streamline file organization and document workflows.',
        providerId: 'google-drive',
        icon: (props) => GoogleDriveIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file',
        ],
        scopeHints: ['drive'],
      },
      'google-docs': {
        id: 'google-docs',
        name: 'Google Docs',
        description: 'Create, read, and edit Google Documents programmatically.',
        providerId: 'google-docs',
        icon: (props) => GoogleDocsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file',
        ],
        scopeHints: ['docs'],
      },
      'google-sheets': {
        id: 'google-sheets',
        name: 'Google Sheets',
        description: 'Manage and analyze data with Google Sheets integration.',
        providerId: 'google-sheets',
        icon: (props) => GoogleSheetsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file',
        ],
        scopeHints: ['sheets'],
      },
      'google-forms': {
        id: 'google-forms',
        name: 'Google Forms',
        description: 'Retrieve Google Form responses.',
        providerId: 'google-forms',
        icon: (props) => GoogleFormsIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/forms.responses.readonly',
        ],
        scopeHints: ['forms'],
      },
      'google-calendar': {
        id: 'google-calendar',
        name: 'Google Calendar',
        description: 'Schedule and manage events with Google Calendar.',
        providerId: 'google-calendar',
        icon: (props) => GoogleCalendarIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: ['https://www.googleapis.com/auth/calendar'],
        scopeHints: ['calendar'],
      },
      'google-vault': {
        id: 'google-vault',
        name: 'Google Vault',
        description: 'Search, export, and manage matters/holds via Google Vault.',
        providerId: 'google-vault',
        icon: (props) => GoogleIcon(props),
        baseProviderIcon: (props) => GoogleIcon(props),
        scopes: [
          'https://www.googleapis.com/auth/ediscovery',
          'https://www.googleapis.com/auth/devstorage.read_only',
        ],
        scopeHints: ['ediscovery', 'devstorage'],
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
      'microsoft-planner': {
        id: 'microsoft-planner',
        name: 'Microsoft Planner',
        description: 'Connect to Microsoft Planner and manage tasks.',
        providerId: 'microsoft-planner',
        icon: (props) => MicrosoftPlannerIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: [
          'openid',
          'profile',
          'email',
          'Group.ReadWrite.All',
          'Group.Read.All',
          'Tasks.ReadWrite',
          'offline_access',
        ],
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
          'ChatMessage.Send',
          'Channel.ReadBasic.All',
          'ChannelMessage.Send',
          'ChannelMessage.Read.All',
          'ChannelMessage.ReadWrite',
          'ChannelMember.Read.All',
          'Group.Read.All',
          'Group.ReadWrite.All',
          'Team.ReadBasic.All',
          'TeamMember.Read.All',
          'offline_access',
          'Files.Read',
          'Sites.Read.All',
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
      onedrive: {
        id: 'onedrive',
        name: 'OneDrive',
        description: 'Connect to OneDrive and manage files.',
        providerId: 'onedrive',
        icon: (props) => MicrosoftOneDriveIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
      },
      sharepoint: {
        id: 'sharepoint',
        name: 'SharePoint',
        description: 'Connect to SharePoint and manage sites.',
        providerId: 'sharepoint',
        icon: (props) => MicrosoftSharepointIcon(props),
        baseProviderIcon: (props) => MicrosoftIcon(props),
        scopes: [
          'openid',
          'profile',
          'email',
          'Sites.Read.All',
          'Sites.ReadWrite.All',
          'Sites.Manage.All',
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
        scopes: [
          'read:confluence-content.all',
          'read:confluence-space.summary',
          'read:space:confluence',
          'read:space-details:confluence',
          'write:confluence-content',
          'write:confluence-space',
          'write:confluence-file',
          'read:page:confluence',
          'write:page:confluence',
          'read:comment:confluence',
          'write:comment:confluence',
          'delete:comment:confluence',
          'delete:attachment:confluence',
          'read:content:confluence',
          'delete:page:confluence',
          'read:label:confluence',
          'write:label:confluence',
          'read:attachment:confluence',
          'write:attachment:confluence',
          'search:confluence',
          'read:me',
          'offline_access',
        ],
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
          'write:issue:jira',
          'read:project:jira',
          'read:issue-type:jira',
          'read:me',
          'offline_access',
          'read:issue-meta:jira',
          'read:issue-security-level:jira',
          'read:issue.vote:jira',
          'read:issue.changelog:jira',
          'read:avatar:jira',
          'read:issue:jira',
          'read:status:jira',
          'read:user:jira',
          'read:field-configuration:jira',
          'read:issue-details:jira',
          'read:issue-event:jira',
          'delete:issue:jira',
          'write:comment:jira',
          'read:comment:jira',
          'delete:comment:jira',
          'read:attachment:jira',
          'delete:attachment:jira',
          'write:issue-worklog:jira',
          'read:issue-worklog:jira',
          'delete:issue-worklog:jira',
          'write:issue-link:jira',
          'delete:issue-link:jira',
          'manage:jira-webhook',
          'read:webhook:jira',
          'write:webhook:jira',
          'delete:webhook:jira',
          'read:issue.property:jira',
          'read:comment.property:jira',
          'read:jql:jira',
          'read:field:jira',
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
        scopes: ['data.records:read', 'data.records:write', 'user.email:read', 'webhook:manage'],
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
          'channels:history',
          'groups:read',
          'groups:history',
          'chat:write',
          'chat:write.public',
          'users:read',
          'files:write',
          'files:read',
          'canvases:write',
          'reactions:write',
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
        scopes: [
          'identity',
          'read',
          'submit',
          'vote',
          'save',
          'edit',
          'subscribe',
          'history',
          'privatemessages',
          'account',
          'mysubreddits',
          'flair',
          'report',
          'modposts',
          'modflair',
          'modmail',
        ],
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
  webflow: {
    id: 'webflow',
    name: 'Webflow',
    icon: (props) => WebflowIcon(props),
    services: {
      webflow: {
        id: 'webflow',
        name: 'Webflow',
        description: 'Manage Webflow CMS collections, sites, and content.',
        providerId: 'webflow',
        icon: (props) => WebflowIcon(props),
        baseProviderIcon: (props) => WebflowIcon(props),
        scopes: ['cms:read', 'cms:write', 'sites:read', 'sites:write'],
      },
    },
    defaultService: 'webflow',
  },
  trello: {
    id: 'trello',
    name: 'Trello',
    icon: (props) => TrelloIcon(props),
    services: {
      trello: {
        id: 'trello',
        name: 'Trello',
        description: 'Manage Trello boards, cards, and workflows.',
        providerId: 'trello',
        icon: (props) => TrelloIcon(props),
        baseProviderIcon: (props) => TrelloIcon(props),
        scopes: ['read', 'write'],
      },
    },
    defaultService: 'trello',
  },
  asana: {
    id: 'asana',
    name: 'Asana',
    icon: (props) => AsanaIcon(props),
    services: {
      asana: {
        id: 'asana',
        name: 'Asana',
        description: 'Manage Asana projects, tasks, and workflows.',
        providerId: 'asana',
        icon: (props) => AsanaIcon(props),
        baseProviderIcon: (props) => AsanaIcon(props),
        scopes: ['default'],
      },
    },
    defaultService: 'asana',
  },
  pipedrive: {
    id: 'pipedrive',
    name: 'Pipedrive',
    icon: (props) => PipedriveIcon(props),
    services: {
      pipedrive: {
        id: 'pipedrive',
        name: 'Pipedrive',
        description: 'Manage deals, contacts, and sales pipeline in Pipedrive CRM.',
        providerId: 'pipedrive',
        icon: (props) => PipedriveIcon(props),
        baseProviderIcon: (props) => PipedriveIcon(props),
        scopes: [
          'base',
          'deals:full',
          'contacts:full',
          'leads:full',
          'activities:full',
          'mail:full',
          'projects:full',
        ],
      },
    },
    defaultService: 'pipedrive',
  },
  hubspot: {
    id: 'hubspot',
    name: 'HubSpot',
    icon: (props) => HubspotIcon(props),
    services: {
      hubspot: {
        id: 'hubspot',
        name: 'HubSpot',
        description: 'Access and manage your HubSpot CRM data.',
        providerId: 'hubspot',
        icon: (props) => HubspotIcon(props),
        baseProviderIcon: (props) => HubspotIcon(props),
        scopes: [
          'crm.objects.contacts.read',
          'crm.objects.contacts.write',
          'crm.objects.companies.read',
          'crm.objects.companies.write',
          'crm.objects.deals.read',
          'crm.objects.deals.write',
          'crm.objects.owners.read',
          'crm.objects.users.read',
          'crm.objects.users.write',
          'crm.objects.marketing_events.read',
          'crm.objects.marketing_events.write',
          'crm.objects.line_items.read',
          'crm.objects.line_items.write',
          'crm.objects.quotes.read',
          'crm.objects.quotes.write',
          'crm.objects.appointments.read',
          'crm.objects.appointments.write',
          'crm.objects.carts.read',
          'crm.objects.carts.write',
          'crm.import',
          'crm.lists.read',
          'crm.lists.write',
          'tickets',
        ],
      },
    },
    defaultService: 'hubspot',
  },
  salesforce: {
    id: 'salesforce',
    name: 'Salesforce',
    icon: (props) => SalesforceIcon(props),
    services: {
      salesforce: {
        id: 'salesforce',
        name: 'Salesforce',
        description: 'Access and manage your Salesforce CRM data.',
        providerId: 'salesforce',
        icon: (props) => SalesforceIcon(props),
        baseProviderIcon: (props) => SalesforceIcon(props),
        scopes: ['api', 'refresh_token', 'openid'],
      },
    },
    defaultService: 'salesforce',
  },
}

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

export function getServiceIdFromScopes(provider: OAuthProvider, scopes: string[]): string {
  const { baseProvider, featureType } = parseProvider(provider)
  const providerConfig = OAUTH_PROVIDERS[baseProvider] || OAUTH_PROVIDERS[provider]
  if (!providerConfig) {
    return provider
  }

  if (featureType !== 'default' && providerConfig.services[featureType]) {
    return featureType
  }

  const normalizedScopes = (scopes || []).map((s) => s.toLowerCase())
  for (const service of Object.values(providerConfig.services)) {
    const hints = (service.scopeHints || []).map((h) => h.toLowerCase())
    if (hints.length === 0) continue
    if (normalizedScopes.some((scope) => hints.some((hint) => scope.includes(hint)))) {
      return service.id
    }
  }

  return providerConfig.defaultService
}

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

export function getServiceConfigByProviderId(providerId: string): OAuthServiceConfig | null {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    for (const service of Object.values(provider.services)) {
      if (service.providerId === providerId || service.id === providerId) {
        return service
      }
    }
  }

  return null
}

export function getCanonicalScopesForProvider(providerId: string): string[] {
  const service = getServiceConfigByProviderId(providerId)
  return service?.scopes ? [...service.scopes] : []
}

export function normalizeScopes(scopes: string[]): string[] {
  const seen = new Set<string>()
  for (const scope of scopes) {
    const trimmed = scope.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
    }
  }
  return Array.from(seen)
}

export interface ScopeEvaluation {
  canonicalScopes: string[]
  grantedScopes: string[]
  missingScopes: string[]
  extraScopes: string[]
  requiresReauthorization: boolean
}

export function evaluateScopeCoverage(
  providerId: string,
  grantedScopes: string[]
): ScopeEvaluation {
  const canonicalScopes = getCanonicalScopesForProvider(providerId)
  const normalizedGranted = normalizeScopes(grantedScopes)

  const canonicalSet = new Set(canonicalScopes)
  const grantedSet = new Set(normalizedGranted)

  const missingScopes = canonicalScopes.filter((scope) => !grantedSet.has(scope))
  const extraScopes = normalizedGranted.filter((scope) => !canonicalSet.has(scope))

  return {
    canonicalScopes,
    grantedScopes: normalizedGranted,
    missingScopes,
    extraScopes,
    requiresReauthorization: missingScopes.length > 0,
  }
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
  if (provider === 'onedrive') {
    return {
      baseProvider: 'microsoft',
      featureType: 'onedrive',
    }
  }
  if (provider === 'sharepoint') {
    return {
      baseProvider: 'microsoft',
      featureType: 'sharepoint',
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
    case 'onedrive': {
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
    case 'sharepoint': {
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
        supportsRefreshTokenRotation: true,
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
    case 'webflow': {
      const { clientId, clientSecret } = getCredentials(
        env.WEBFLOW_CLIENT_ID,
        env.WEBFLOW_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://api.webflow.com/oauth/access_token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'asana': {
      const { clientId, clientSecret } = getCredentials(
        env.ASANA_CLIENT_ID,
        env.ASANA_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://app.asana.com/-/oauth_token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'pipedrive': {
      const { clientId, clientSecret } = getCredentials(
        env.PIPEDRIVE_CLIENT_ID,
        env.PIPEDRIVE_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://oauth.pipedrive.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'hubspot': {
      const { clientId, clientSecret } = getCredentials(
        env.HUBSPOT_CLIENT_ID,
        env.HUBSPOT_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://api.hubapi.com/oauth/v1/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'salesforce': {
      const { clientId, clientSecret } = getCredentials(
        env.SALESFORCE_CLIENT_ID,
        env.SALESFORCE_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://login.salesforce.com/services/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
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
