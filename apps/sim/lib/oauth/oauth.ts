import { createLogger } from '@sim/logger'
import {
  AirtableIcon,
  AsanaIcon,
  CalComIcon,
  ConfluenceIcon,
  DropboxIcon,
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleFormsIcon,
  GoogleGroupsIcon,
  GoogleIcon,
  GoogleSheetsIcon,
  HubspotIcon,
  JiraIcon,
  LinearIcon,
  LinkedInIcon,
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
  ShopifyIcon,
  SlackIcon,
  SpotifyIcon,
  TrelloIcon,
  VertexIcon,
  WealthboxIcon,
  WebflowIcon,
  WordpressIcon,
  xIcon,
  ZoomIcon,
} from '@/components/icons'
import { env } from '@/lib/core/config/env'
import type { OAuthProviderConfig } from './types'

const logger = createLogger('OAuth')

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    name: 'Google',
    icon: GoogleIcon,
    services: {
      gmail: {
        name: 'Gmail',
        description: 'Automate email workflows and enhance communication efficiency.',
        providerId: 'google-email',
        icon: GmailIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.labels',
        ],
      },
      'google-drive': {
        name: 'Google Drive',
        description: 'Streamline file organization and document workflows.',
        providerId: 'google-drive',
        icon: GoogleDriveIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
      },
      'google-docs': {
        name: 'Google Docs',
        description: 'Create, read, and edit Google Documents programmatically.',
        providerId: 'google-docs',
        icon: GoogleDocsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
      },
      'google-sheets': {
        name: 'Google Sheets',
        description: 'Manage and analyze data with Google Sheets integration.',
        providerId: 'google-sheets',
        icon: GoogleSheetsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
      },
      'google-forms': {
        name: 'Google Forms',
        description: 'Create, modify, and read Google Forms.',
        providerId: 'google-forms',
        icon: GoogleFormsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/forms.body',
          'https://www.googleapis.com/auth/forms.responses.readonly',
        ],
      },
      'google-calendar': {
        name: 'Google Calendar',
        description: 'Schedule and manage events with Google Calendar.',
        providerId: 'google-calendar',
        icon: GoogleCalendarIcon,
        baseProviderIcon: GoogleIcon,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      },
      'google-vault': {
        name: 'Google Vault',
        description: 'Search, export, and manage matters/holds via Google Vault.',
        providerId: 'google-vault',
        icon: GoogleIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/ediscovery',
          'https://www.googleapis.com/auth/devstorage.read_only',
        ],
      },
      'google-groups': {
        name: 'Google Groups',
        description: 'Manage Google Workspace Groups and their members.',
        providerId: 'google-groups',
        icon: GoogleGroupsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/admin.directory.group',
          'https://www.googleapis.com/auth/admin.directory.group.member',
        ],
      },
      'vertex-ai': {
        name: 'Vertex AI',
        description: 'Access Google Cloud Vertex AI for Gemini models with OAuth.',
        providerId: 'vertex-ai',
        icon: VertexIcon,
        baseProviderIcon: VertexIcon,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      },
    },
    defaultService: 'gmail',
  },
  microsoft: {
    name: 'Microsoft',
    icon: MicrosoftIcon,
    services: {
      'microsoft-excel': {
        name: 'Microsoft Excel',
        description: 'Connect to Microsoft Excel and manage spreadsheets.',
        providerId: 'microsoft-excel',
        icon: MicrosoftExcelIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
      },
      'microsoft-planner': {
        name: 'Microsoft Planner',
        description: 'Connect to Microsoft Planner and manage tasks.',
        providerId: 'microsoft-planner',
        icon: MicrosoftPlannerIcon,
        baseProviderIcon: MicrosoftIcon,
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
        name: 'Microsoft Teams',
        description: 'Connect to Microsoft Teams and manage messages.',
        providerId: 'microsoft-teams',
        icon: MicrosoftTeamsIcon,
        baseProviderIcon: MicrosoftIcon,
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
        name: 'Outlook',
        description: 'Connect to Outlook and manage emails.',
        providerId: 'outlook',
        icon: OutlookIcon,
        baseProviderIcon: MicrosoftIcon,
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
        name: 'OneDrive',
        description: 'Connect to OneDrive and manage files.',
        providerId: 'onedrive',
        icon: MicrosoftOneDriveIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
      },
      sharepoint: {
        name: 'SharePoint',
        description: 'Connect to SharePoint and manage sites.',
        providerId: 'sharepoint',
        icon: MicrosoftSharepointIcon,
        baseProviderIcon: MicrosoftIcon,
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
    defaultService: 'outlook',
  },
  github: {
    name: 'GitHub',
    icon: GithubIcon,
    services: {
      github: {
        name: 'GitHub',
        description: 'Manage repositories, issues, and pull requests.',
        providerId: 'github-repo',
        icon: GithubIcon,
        baseProviderIcon: GithubIcon,
        scopes: ['repo', 'user:email', 'read:user', 'workflow'],
      },
    },
    defaultService: 'github',
  },
  x: {
    name: 'X',
    icon: xIcon,
    services: {
      x: {
        name: 'X',
        description: 'Read and post tweets on X (formerly Twitter).',
        providerId: 'x',
        icon: xIcon,
        baseProviderIcon: xIcon,
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
      },
    },
    defaultService: 'x',
  },
  confluence: {
    name: 'Confluence',
    icon: ConfluenceIcon,
    services: {
      confluence: {
        name: 'Confluence',
        description: 'Access Confluence content and documentation.',
        providerId: 'confluence',
        icon: ConfluenceIcon,
        baseProviderIcon: ConfluenceIcon,
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
    name: 'Jira',
    icon: JiraIcon,
    services: {
      jira: {
        name: 'Jira',
        description: 'Access Jira projects, issues, and Service Management.',
        providerId: 'jira',
        icon: JiraIcon,
        baseProviderIcon: JiraIcon,
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
          // Jira Service Management scopes
          'read:servicedesk:jira-service-management',
          'read:requesttype:jira-service-management',
          'read:request:jira-service-management',
          'write:request:jira-service-management',
          'read:request.comment:jira-service-management',
          'write:request.comment:jira-service-management',
          'read:customer:jira-service-management',
          'write:customer:jira-service-management',
          'read:servicedesk.customer:jira-service-management',
          'write:servicedesk.customer:jira-service-management',
          'read:organization:jira-service-management',
          'write:organization:jira-service-management',
          'read:servicedesk.organization:jira-service-management',
          'write:servicedesk.organization:jira-service-management',
          'read:organization.user:jira-service-management',
          'write:organization.user:jira-service-management',
          'read:organization.property:jira-service-management',
          'write:organization.property:jira-service-management',
          'read:organization.profile:jira-service-management',
          'write:organization.profile:jira-service-management',
          'read:queue:jira-service-management',
          'read:request.sla:jira-service-management',
          'read:request.status:jira-service-management',
          'write:request.status:jira-service-management',
          'read:request.participant:jira-service-management',
          'write:request.participant:jira-service-management',
          'read:request.approval:jira-service-management',
          'write:request.approval:jira-service-management',
        ],
      },
    },
    defaultService: 'jira',
  },
  airtable: {
    name: 'Airtable',
    icon: AirtableIcon,
    services: {
      airtable: {
        name: 'Airtable',
        description: 'Manage Airtable bases, tables, and records.',
        providerId: 'airtable',
        icon: AirtableIcon,
        baseProviderIcon: AirtableIcon,
        scopes: ['data.records:read', 'data.records:write', 'user.email:read', 'webhook:manage'],
      },
    },
    defaultService: 'airtable',
  },
  notion: {
    name: 'Notion',
    icon: NotionIcon,
    services: {
      notion: {
        name: 'Notion',
        description: 'Connect to your Notion workspace to manage pages and databases.',
        providerId: 'notion',
        icon: NotionIcon,
        baseProviderIcon: NotionIcon,
        scopes: [],
      },
    },
    defaultService: 'notion',
  },
  linear: {
    name: 'Linear',
    icon: LinearIcon,
    services: {
      linear: {
        name: 'Linear',
        description: 'Manage issues and projects in Linear.',
        providerId: 'linear',
        icon: LinearIcon,
        baseProviderIcon: LinearIcon,
        scopes: ['read', 'write'],
      },
    },
    defaultService: 'linear',
  },
  dropbox: {
    name: 'Dropbox',
    icon: DropboxIcon,
    services: {
      dropbox: {
        name: 'Dropbox',
        description: 'Upload, download, share, and manage files in Dropbox.',
        providerId: 'dropbox',
        icon: DropboxIcon,
        baseProviderIcon: DropboxIcon,
        scopes: [
          'account_info.read',
          'files.metadata.read',
          'files.metadata.write',
          'files.content.read',
          'files.content.write',
          'sharing.read',
          'sharing.write',
        ],
      },
    },
    defaultService: 'dropbox',
  },
  shopify: {
    name: 'Shopify',
    icon: ShopifyIcon,
    services: {
      shopify: {
        name: 'Shopify',
        description: 'Manage products, orders, and customers in your Shopify store.',
        providerId: 'shopify',
        icon: ShopifyIcon,
        baseProviderIcon: ShopifyIcon,
        scopes: [
          'write_products',
          'write_orders',
          'write_customers',
          'write_inventory',
          'read_locations',
          'write_merchant_managed_fulfillment_orders',
        ],
      },
    },
    defaultService: 'shopify',
  },
  slack: {
    name: 'Slack',
    icon: SlackIcon,
    services: {
      slack: {
        name: 'Slack',
        description: 'Send messages using a bot for Slack.',
        providerId: 'slack',
        icon: SlackIcon,
        baseProviderIcon: SlackIcon,
        scopes: [
          'channels:read',
          'channels:history',
          'groups:read',
          'groups:history',
          'chat:write',
          'chat:write.public',
          'im:write',
          'im:history',
          'im:read',
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
    name: 'Reddit',
    icon: RedditIcon,
    services: {
      reddit: {
        name: 'Reddit',
        description: 'Access Reddit data and content from subreddits.',
        providerId: 'reddit',
        icon: RedditIcon,
        baseProviderIcon: RedditIcon,
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
    name: 'Wealthbox',
    icon: WealthboxIcon,
    services: {
      wealthbox: {
        name: 'Wealthbox',
        description: 'Manage contacts, notes, and tasks in your Wealthbox CRM.',
        providerId: 'wealthbox',
        icon: WealthboxIcon,
        baseProviderIcon: WealthboxIcon,
        scopes: ['login', 'data'],
      },
    },
    defaultService: 'wealthbox',
  },
  webflow: {
    name: 'Webflow',
    icon: WebflowIcon,
    services: {
      webflow: {
        name: 'Webflow',
        description: 'Manage Webflow CMS collections, sites, and content.',
        providerId: 'webflow',
        icon: WebflowIcon,
        baseProviderIcon: WebflowIcon,
        scopes: ['cms:read', 'cms:write', 'sites:read', 'sites:write'],
      },
    },
    defaultService: 'webflow',
  },
  trello: {
    name: 'Trello',
    icon: TrelloIcon,
    services: {
      trello: {
        name: 'Trello',
        description: 'Manage Trello boards, cards, and workflows.',
        providerId: 'trello',
        icon: TrelloIcon,
        baseProviderIcon: TrelloIcon,
        scopes: ['read', 'write'],
      },
    },
    defaultService: 'trello',
  },
  asana: {
    name: 'Asana',
    icon: AsanaIcon,
    services: {
      asana: {
        name: 'Asana',
        description: 'Manage Asana projects, tasks, and workflows.',
        providerId: 'asana',
        icon: AsanaIcon,
        baseProviderIcon: AsanaIcon,
        scopes: ['default'],
      },
    },
    defaultService: 'asana',
  },
  calcom: {
    name: 'Cal.com',
    icon: CalComIcon,
    services: {
      calcom: {
        name: 'Cal.com',
        description: 'Manage Cal.com bookings, event types, and schedules.',
        providerId: 'calcom',
        icon: CalComIcon,
        baseProviderIcon: CalComIcon,
        scopes: [],
      },
    },
    defaultService: 'calcom',
  },
  pipedrive: {
    name: 'Pipedrive',
    icon: PipedriveIcon,
    services: {
      pipedrive: {
        name: 'Pipedrive',
        description: 'Manage deals, contacts, and sales pipeline in Pipedrive CRM.',
        providerId: 'pipedrive',
        icon: PipedriveIcon,
        baseProviderIcon: PipedriveIcon,
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
    name: 'HubSpot',
    icon: HubspotIcon,
    services: {
      hubspot: {
        name: 'HubSpot',
        description: 'Access and manage your HubSpot CRM data.',
        providerId: 'hubspot',
        icon: HubspotIcon,
        baseProviderIcon: HubspotIcon,
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
  linkedin: {
    name: 'LinkedIn',
    icon: LinkedInIcon,
    services: {
      linkedin: {
        name: 'LinkedIn',
        description: 'Share posts and access profile data on LinkedIn.',
        providerId: 'linkedin',
        icon: LinkedInIcon,
        baseProviderIcon: LinkedInIcon,
        scopes: ['profile', 'openid', 'email', 'w_member_social'],
      },
    },
    defaultService: 'linkedin',
  },
  salesforce: {
    name: 'Salesforce',
    icon: SalesforceIcon,
    services: {
      salesforce: {
        name: 'Salesforce',
        description: 'Access and manage your Salesforce CRM data.',
        providerId: 'salesforce',
        icon: SalesforceIcon,
        baseProviderIcon: SalesforceIcon,
        scopes: ['api', 'refresh_token', 'openid', 'offline_access'],
      },
    },
    defaultService: 'salesforce',
  },
  zoom: {
    name: 'Zoom',
    icon: ZoomIcon,
    services: {
      zoom: {
        name: 'Zoom',
        description: 'Create and manage Zoom meetings, users, and recordings.',
        providerId: 'zoom',
        icon: ZoomIcon,
        baseProviderIcon: ZoomIcon,
        scopes: [
          'user:read:user',
          'meeting:write:meeting',
          'meeting:read:meeting',
          'meeting:read:list_meetings',
          'meeting:update:meeting',
          'meeting:delete:meeting',
          'meeting:read:invitation',
          'meeting:read:list_past_participants',
          'cloud_recording:read:list_user_recordings',
          'cloud_recording:read:list_recording_files',
          'cloud_recording:delete:recording_file',
        ],
      },
    },
    defaultService: 'zoom',
  },
  wordpress: {
    name: 'WordPress',
    icon: WordpressIcon,
    services: {
      wordpress: {
        name: 'WordPress',
        description: 'Manage posts, pages, media, comments, and more on WordPress sites.',
        providerId: 'wordpress',
        icon: WordpressIcon,
        baseProviderIcon: WordpressIcon,
        scopes: ['global'],
      },
    },
    defaultService: 'wordpress',
  },
  spotify: {
    name: 'Spotify',
    icon: SpotifyIcon,
    services: {
      spotify: {
        name: 'Spotify',
        description: 'Search music, manage playlists, control playback, and access your library.',
        providerId: 'spotify',
        icon: SpotifyIcon,
        baseProviderIcon: SpotifyIcon,
        scopes: [
          'user-read-private',
          'user-read-email',
          'user-library-read',
          'user-library-modify',
          'playlist-read-private',
          'playlist-read-collaborative',
          'playlist-modify-public',
          'playlist-modify-private',
          'user-read-playback-state',
          'user-modify-playback-state',
          'user-read-currently-playing',
          'user-read-recently-played',
          'user-top-read',
          'user-follow-read',
          'user-follow-modify',
          'user-read-playback-position',
          'ugc-image-upload',
        ],
      },
    },
    defaultService: 'spotify',
  },
}

interface ProviderAuthConfig {
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  useBasicAuth: boolean
  additionalHeaders?: Record<string, string>
  supportsRefreshTokenRotation?: boolean
  /**
   * If true, the refresh token is sent in the Authorization header as Bearer token
   * instead of in the request body. Used by Cal.com.
   */
  refreshTokenInAuthHeader?: boolean
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
        supportsRefreshTokenRotation: true,
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
    case 'calcom': {
      const clientId = env.CALCOM_CLIENT_ID
      if (!clientId) {
        throw new Error('Missing CALCOM_CLIENT_ID')
      }
      return {
        tokenEndpoint: 'https://app.cal.com/api/auth/oauth/refreshToken',
        clientId,
        clientSecret: '',
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        // Cal.com requires refresh token in Authorization header, not body
        refreshTokenInAuthHeader: true,
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
        supportsRefreshTokenRotation: true,
      }
    }
    case 'microsoft':
    case 'outlook':
    case 'onedrive':
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
        supportsRefreshTokenRotation: true,
      }
    }
    case 'dropbox': {
      const { clientId, clientSecret } = getCredentials(
        env.DROPBOX_CLIENT_ID,
        env.DROPBOX_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
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
        additionalHeaders: {
          'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        },
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
    case 'linkedin': {
      const { clientId, clientSecret } = getCredentials(
        env.LINKEDIN_CLIENT_ID,
        env.LINKEDIN_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
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
        supportsRefreshTokenRotation: true,
      }
    }
    case 'shopify': {
      // Shopify access tokens don't expire and don't support refresh tokens
      // This configuration is provided for completeness but won't be used for token refresh
      const { clientId, clientSecret } = getCredentials(
        env.SHOPIFY_CLIENT_ID,
        env.SHOPIFY_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://accounts.shopify.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'zoom': {
      const { clientId, clientSecret } = getCredentials(env.ZOOM_CLIENT_ID, env.ZOOM_CLIENT_SECRET)
      return {
        tokenEndpoint: 'https://zoom.us/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'wordpress': {
      // WordPress.com does NOT support refresh tokens
      // Users will need to re-authorize when tokens expire (~2 weeks)
      const { clientId, clientSecret } = getCredentials(
        env.WORDPRESS_CLIENT_ID,
        env.WORDPRESS_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://public-api.wordpress.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'spotify': {
      const { clientId, clientSecret } = getCredentials(
        env.SPOTIFY_CLIENT_ID,
        env.SPOTIFY_CLIENT_SECRET
      )
      return {
        tokenEndpoint: 'https://accounts.spotify.com/api/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
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
  }

  // Handle refresh token placement
  if (config.refreshTokenInAuthHeader) {
    // Cal.com style: refresh token in Authorization header as Bearer token
    headers.Authorization = `Bearer ${refreshToken}`
  } else {
    // Standard OAuth: refresh token in request body
    bodyParams.refresh_token = refreshToken
  }

  if (config.useBasicAuth) {
    // Use Basic Authentication - credentials in Authorization header only
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${basicAuth}`
  } else {
    // Use body credentials - include client credentials in request body
    bodyParams.client_id = config.clientId
    if (config.clientSecret) {
      bodyParams.client_secret = config.clientSecret
    }
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
function getBaseProviderForService(providerId: string): string {
  if (providerId in OAUTH_PROVIDERS) {
    return providerId
  }

  for (const [baseProvider, config] of Object.entries(OAUTH_PROVIDERS)) {
    for (const service of Object.values(config.services)) {
      if (service.providerId === providerId) {
        return baseProvider
      }
    }
  }

  throw new Error(`Unknown OAuth provider: ${providerId}`)
}

export async function refreshOAuthToken(
  providerId: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; refreshToken: string } | null> {
  try {
    const provider = getBaseProviderForService(providerId)

    const config = getProviderAuthConfig(provider)

    const { headers, bodyParams } = buildAuthRequest(config, refreshToken)

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: new URLSearchParams(bodyParams).toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorData = errorText

      try {
        errorData = JSON.parse(errorText)
      } catch (_e) {
        // Not JSON, keep as text
      }

      logger.error('Token refresh failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        parsedError: errorData,
        providerId,
        tokenEndpoint: config.tokenEndpoint,
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!refreshToken,
        refreshTokenPrefix: refreshToken ? `${refreshToken.substring(0, 10)}...` : 'none',
      })
      throw new Error(`Failed to refresh token: ${response.status} ${errorText}`)
    }

    const data = await response.json()

    const accessToken = data.access_token

    let newRefreshToken = null
    if (config.supportsRefreshTokenRotation && data.refresh_token) {
      newRefreshToken = data.refresh_token
      logger.info(`Received new refresh token from ${provider}`)
    }

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
