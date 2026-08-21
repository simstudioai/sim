import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import {
  AirtableIcon,
  AsanaIcon,
  AtlassianIcon,
  AttioIcon,
  AzureIcon,
  BitbucketIcon,
  BoxCompanyIcon,
  CalComIcon,
  ClaudeIcon,
  ClickUpIcon,
  ConfluenceIcon,
  DocuSignIcon,
  DropboxIcon,
  GmailIcon,
  GoogleAdsIcon,
  GoogleBigQueryIcon,
  GoogleCalendarIcon,
  GoogleChatIcon,
  GoogleContactsIcon,
  GoogleDocsIcon,
  GoogleDriveIcon,
  GoogleFormsIcon,
  GoogleGroupsIcon,
  GoogleIcon,
  GoogleMeetIcon,
  GoogleSheetsIcon,
  GoogleTasksIcon,
  GoogleVaultIcon,
  HarmonicIcon,
  HubspotIcon,
  InstagramIcon,
  JiraIcon,
  LinearIcon,
  LinkedInIcon,
  MicrosoftDataverseIcon,
  MicrosoftExcelIcon,
  MicrosoftIcon,
  MicrosoftOneDriveIcon,
  MicrosoftPlannerIcon,
  MicrosoftSharepointIcon,
  MicrosoftTeamsIcon,
  MondayIcon,
  NetSuiteIcon,
  NotionIcon,
  OutlookIcon,
  PipedriveIcon,
  RedditIcon,
  SalesforceIcon,
  ShopifyIcon,
  SlackIcon,
  SnowflakeIcon,
  SpotifyIcon,
  TikTokIcon,
  TrelloIcon,
  VertexIcon,
  WealthboxIcon,
  WebflowIcon,
  WordpressIcon,
  xIcon,
  ZohoDeskIcon,
  ZoomIcon,
} from '@/components/icons'
import { env } from '@/lib/core/config/env'
import {
  type OAuthClientCapabilityField,
  type OAuthClientCapabilityId,
  requireOAuthClientCapability,
} from '@/lib/core/config/env-capabilities'
import { isSlackExtendedScopesEnabled } from '@/lib/core/config/env-flags'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getDocusignOAuthUrl } from '@/lib/oauth/docusign'
import { parseInstagramLongLivedToken } from '@/lib/oauth/instagram'
import {
  SALESFORCE_ADDITIONAL_PROVIDER_IDS,
  SALESFORCE_LOGIN_HOSTS,
  SALESFORCE_PROVIDER_ID_LABELS,
} from '@/lib/oauth/salesforce'
import { REDDIT_USER_AGENT } from '@/tools/reddit/constants'
import type { OAuthProviderConfig } from './types'

const logger = createLogger('OAuth')

/**
 * Slack scopes requested only where the app is approved for them, gated by
 * {@link isSlackExtendedScopesEnabled}. Slack rejects the entire authorization
 * with "unapproved permissions requested" when any requested scope is not on the
 * app's approved list, so these stay out of the default grant.
 */
const SLACK_APPROVAL_GATED_SCOPES = isSlackExtendedScopesEnabled
  ? (['assistant:write', 'app_mentions:read', 'im:history'] as const)
  : ([] as const)

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  'claude-platform': {
    name: 'Claude Platform',
    icon: ClaudeIcon,
    services: {
      'claude-platform': {
        name: 'Claude Platform',
        description: 'Run Claude Platform Managed Agents from your workflows.',
        providerId: 'claude-platform',
        serviceAccountProviderId: 'claude-platform-service-account',
        icon: ClaudeIcon,
        baseProviderIcon: ClaudeIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'claude-platform',
  },
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
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.labels',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-drive': {
        name: 'Google Drive',
        description: 'Streamline file organization and document workflows.',
        providerId: 'google-drive',
        icon: GoogleDriveIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-docs': {
        name: 'Google Docs',
        description: 'Create, read, and edit Google Documents programmatically.',
        providerId: 'google-docs',
        icon: GoogleDocsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-sheets': {
        name: 'Google Sheets',
        description: 'Manage and analyze data with Google Sheets integration.',
        providerId: 'google-sheets',
        icon: GoogleSheetsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive',
        ],
        serviceAccountProviderId: 'google-service-account',
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
        serviceAccountProviderId: 'google-service-account',
      },
      'google-calendar': {
        name: 'Google Calendar',
        description: 'Schedule and manage events with Google Calendar.',
        providerId: 'google-calendar',
        icon: GoogleCalendarIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/calendar',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-contacts': {
        name: 'Google Contacts',
        description: 'Create, read, update, and search contacts with Google Contacts.',
        providerId: 'google-contacts',
        icon: GoogleContactsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/contacts',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-ads': {
        name: 'Google Ads',
        description: 'Query campaigns, ad groups, and performance metrics in Google Ads.',
        providerId: 'google-ads',
        icon: GoogleAdsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/adwords',
        ],
      },
      'google-bigquery': {
        name: 'Google BigQuery',
        description: 'Query, list, and insert data in Google BigQuery.',
        providerId: 'google-bigquery',
        icon: GoogleBigQueryIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/bigquery',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-tasks': {
        name: 'Google Tasks',
        description: 'Create, manage, and organize tasks with Google Tasks.',
        providerId: 'google-tasks',
        icon: GoogleTasksIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/tasks',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-vault': {
        name: 'Google Vault',
        description: 'Search, export, and manage matters/holds via Google Vault.',
        providerId: 'google-vault',
        icon: GoogleVaultIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/ediscovery',
          // Least-privilege scope for read-only consumers. The knowledge base
          // connector only lists matters, holds, and saved queries, all of which
          // accept ediscovery.readonly; the block's export tools still need the
          // read-write scope above.
          'https://www.googleapis.com/auth/ediscovery.readonly',
          'https://www.googleapis.com/auth/devstorage.read_only',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-groups': {
        name: 'Google Groups',
        description: 'Manage Google Workspace Groups and their members.',
        providerId: 'google-groups',
        icon: GoogleGroupsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/admin.directory.group',
          'https://www.googleapis.com/auth/admin.directory.group.member',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      /**
       * Deliberately declares no `serviceAccountProviderId`, unlike every sibling
       * Google service. A Google service-account JWT cannot reach user-scoped Chat
       * data without domain-wide delegation, so offering service-account auth here
       * would surface a credential path that always fails. Enterprises that
       * authenticate other Google connectors through a delegated service account must
       * attach a per-user OAuth credential for Chat.
       */
      'google-chat': {
        name: 'Google Chat',
        description: 'Read Google Chat spaces and messages the signed-in user can access.',
        providerId: 'google-chat',
        icon: GoogleChatIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/chat.spaces.readonly',
          'https://www.googleapis.com/auth/chat.messages.readonly',
        ],
      },
      'google-meet': {
        name: 'Google Meet',
        description: 'Create and manage Google Meet meeting spaces and conferences.',
        providerId: 'google-meet',
        icon: GoogleMeetIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/meetings.space.created',
          'https://www.googleapis.com/auth/meetings.space.readonly',
        ],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-service-account': {
        name: 'Google Service Account',
        description: 'Authenticate with a JSON key file from Google Cloud Console.',
        providerId: 'google-service-account',
        icon: GoogleIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [],
        authType: 'service_account',
      },
      'vertex-ai': {
        name: 'Vertex AI',
        description: 'Access Google Cloud Vertex AI for Gemini models with OAuth.',
        providerId: 'vertex-ai',
        icon: VertexIcon,
        baseProviderIcon: VertexIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/cloud-platform',
        ],
      },
    },
    defaultService: 'gmail',
  },
  microsoft: {
    name: 'Microsoft',
    icon: MicrosoftIcon,
    services: {
      'microsoft-ad': {
        name: 'Azure AD',
        description: 'Connect to Azure AD (Microsoft Entra ID) and manage users and groups.',
        providerId: 'microsoft-ad',
        icon: AzureIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [
          'openid',
          'profile',
          'email',
          'User.ReadWrite.All',
          'Group.ReadWrite.All',
          'GroupMember.ReadWrite.All',
          'LicenseAssignment.Read.All',
          'LicenseAssignment.ReadWrite.All',
          'UserAuthenticationMethod.ReadWrite.All',
          'AuditLog.Read.All',
          'Application.Read.All',
          'AppRoleAssignment.ReadWrite.All',
          'RoleManagement.ReadWrite.Directory',
          'Device.Read.All',
          'Policy.Read.All',
          'offline_access',
        ],
      },
      'microsoft-dataverse': {
        name: 'Microsoft Dataverse',
        description: 'Connect to Microsoft Dataverse and manage records.',
        providerId: 'microsoft-dataverse',
        icon: MicrosoftDataverseIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [
          'openid',
          'profile',
          'email',
          'https://dynamics.microsoft.com/user_impersonation',
          'offline_access',
        ],
      },
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
        description: 'Connect to Outlook and manage emails and calendar events.',
        providerId: 'outlook',
        icon: OutlookIcon,
        baseProviderIcon: MicrosoftIcon,
        /**
         * `Calendars.ReadWrite` backs the Outlook calendar operations. Graph documents it
         * as the sole accepted permission for creating and updating events and for
         * accept / tentativelyAccept / decline ("Higher: Not available"), and it is
         * supported for both work/school and personal Microsoft accounts.
         *
         * Do NOT add `Calendars.ReadWrite.Shared` here. This provider is shared by work
         * and personal Outlook accounts, and the `.Shared` calendar scopes are not
         * confirmed supported for personal Microsoft accounts — requesting one risks
         * failing consent for personal users, which would take mail access down with it.
         * That is the same reasoning that kept `findMeetingTimes` out of this integration.
         * The consequence is that calendar operations target calendars the account owns;
         * picking a calendar shared by another user may return 403 from Graph.
         *
         * Microsoft only grants newly-added scopes on a fresh authorization, so users who
         * connected Outlook before `Calendars.ReadWrite` existed must reconnect
         * (re-consent) before the calendar operations will work.
         *
         * @see https://learn.microsoft.com/en-us/graph/permissions-reference
         */
        scopes: [
          'openid',
          'profile',
          'email',
          'Mail.ReadWrite',
          'Mail.ReadBasic',
          'Mail.Read',
          'Mail.Send',
          'Calendars.ReadWrite',
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
        scopes: [
          'tweet.read',
          'tweet.write',
          'tweet.moderate.write',
          'users.read',
          'follows.read',
          'follows.write',
          'bookmark.read',
          'bookmark.write',
          'like.read',
          'like.write',
          'block.read',
          'block.write',
          'mute.read',
          'mute.write',
          'offline.access',
        ],
      },
    },
    defaultService: 'x',
  },
  tiktok: {
    name: 'TikTok',
    icon: TikTokIcon,
    services: {
      tiktok: {
        name: 'TikTok',
        description: 'Read profile info and videos, and upload drafts to the TikTok inbox.',
        providerId: 'tiktok',
        icon: TikTokIcon,
        baseProviderIcon: TikTokIcon,
        scopes: [
          'user.info.basic',
          'user.info.profile',
          'user.info.stats',
          'video.upload',
          'video.list',
        ],
      },
    },
    defaultService: 'tiktok',
  },
  atlassian: {
    name: 'Atlassian',
    icon: AtlassianIcon,
    services: {
      'atlassian-service-account': {
        name: 'Atlassian Service Account',
        description:
          'Authenticate as an Atlassian service account using a scoped API token from admin.atlassian.com.',
        providerId: 'atlassian-service-account',
        icon: AtlassianIcon,
        baseProviderIcon: AtlassianIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'atlassian-service-account',
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
        serviceAccountProviderId: 'atlassian-service-account',
        scopes: [
          'read:confluence-content.all',
          'read:confluence-space.summary',
          'read:space:confluence',
          'write:confluence-content',
          'write:confluence-space',
          'write:confluence-file',
          'read:page:confluence',
          'write:page:confluence',
          'read:comment:confluence',
          'write:comment:confluence',
          'delete:comment:confluence',
          'delete:attachment:confluence',
          'delete:page:confluence',
          'read:label:confluence',
          'write:label:confluence',
          'read:attachment:confluence',
          'write:attachment:confluence',
          'search:confluence',
          'read:me',
          'offline_access',
          'read:hierarchical-content:confluence',
          'read:content.metadata:confluence',
          'read:user:confluence',
          'read:confluence-user',
          'read:task:confluence',
          'write:task:confluence',
          'write:space:confluence',
          'delete:space:confluence',
          'read:blogpost:confluence',
          'write:blogpost:confluence',
          'delete:blogpost:confluence',
          'read:content.property:confluence',
          'write:content.property:confluence',
          'read:space.property:confluence',
          'write:space.property:confluence',
          'read:space.permission:confluence',
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
        serviceAccountProviderId: 'atlassian-service-account',
        scopes: [
          'read:jira-user',
          'read:jira-work',
          'write:jira-work',
          'read:me',
          'offline_access',
          'read:issue.vote:jira',
          'read:user:jira',
          'delete:issue:jira',
          'delete:comment:jira',
          'delete:attachment:jira',
          'delete:issue-worklog:jira',
          'delete:issue-link:jira',
          // Jira Service Management scopes. The classic scopes are required: Atlassian
          // enforces an endpoint's granular scope set as all-of, and several JSM request
          // endpoints include scopes outside this list in their granular sets.
          'read:servicedesk-request',
          'write:servicedesk-request',
          'manage:servicedesk-customer',
          'read:servicedesk:jira-service-management',
          'read:requesttype:jira-service-management',
          'read:request:jira-service-management',
          'write:request:jira-service-management',
          'read:request.comment:jira-service-management',
          'write:request.comment:jira-service-management',
          'read:servicedesk.customer:jira-service-management',
          'write:servicedesk.customer:jira-service-management',
          'read:organization:jira-service-management',
          'write:organization:jira-service-management',
          'read:servicedesk.organization:jira-service-management',
          'write:servicedesk.organization:jira-service-management',
          'read:queue:jira-service-management',
          'read:request.sla:jira-service-management',
          'read:request.status:jira-service-management',
          'write:request.status:jira-service-management',
          'read:request.participant:jira-service-management',
          'write:request.participant:jira-service-management',
          'read:request.approval:jira-service-management',
          'write:request.approval:jira-service-management',
          'read:cmdb-object:jira',
          'write:cmdb-object:jira',
          'delete:cmdb-object:jira',
          'read:cmdb-schema:jira',
          'read:cmdb-type:jira',
          'read:cmdb-attribute:jira',
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
        serviceAccountProviderId: 'airtable-service-account',
        icon: AirtableIcon,
        baseProviderIcon: AirtableIcon,
        scopes: [
          'data.records:read',
          'data.records:write',
          'schema.bases:read',
          'user.email:read',
          'webhook:manage',
        ],
      },
    },
    defaultService: 'airtable',
  },
  bitbucket: {
    name: 'Bitbucket',
    icon: BitbucketIcon,
    services: {
      bitbucket: {
        name: 'Bitbucket',
        description: 'Read repositories, collaborate on pull requests, and manage pipelines.',
        providerId: 'bitbucket',
        icon: BitbucketIcon,
        baseProviderIcon: BitbucketIcon,
        scopes: [
          'account',
          'repository',
          'repository:write',
          'pullrequest',
          'pullrequest:write',
          'pipeline',
          'pipeline:write',
        ],
      },
    },
    defaultService: 'bitbucket',
  },
  notion: {
    name: 'Notion',
    icon: NotionIcon,
    services: {
      notion: {
        name: 'Notion',
        description: 'Connect to your Notion workspace to manage pages and databases.',
        providerId: 'notion',
        serviceAccountProviderId: 'notion-service-account',
        icon: NotionIcon,
        baseProviderIcon: NotionIcon,
        scopes: [],
      },
    },
    defaultService: 'notion',
  },
  clickup: {
    name: 'ClickUp',
    icon: ClickUpIcon,
    services: {
      clickup: {
        name: 'ClickUp',
        description: 'Manage tasks, lists, and comments in ClickUp.',
        providerId: 'clickup',
        serviceAccountProviderId: 'clickup-service-account',
        icon: ClickUpIcon,
        baseProviderIcon: ClickUpIcon,
        scopes: [],
      },
    },
    defaultService: 'clickup',
  },
  linear: {
    name: 'Linear',
    icon: LinearIcon,
    services: {
      linear: {
        name: 'Linear',
        description: 'Manage issues and projects in Linear.',
        providerId: 'linear',
        serviceAccountProviderId: 'linear-service-account',
        icon: LinearIcon,
        baseProviderIcon: LinearIcon,
        scopes: ['read', 'write'],
      },
    },
    defaultService: 'linear',
  },
  monday: {
    name: 'Monday.com',
    icon: MondayIcon,
    services: {
      monday: {
        name: 'Monday.com',
        description: 'Manage boards, items, and groups in Monday.com.',
        providerId: 'monday',
        serviceAccountProviderId: 'monday-service-account',
        icon: MondayIcon,
        baseProviderIcon: MondayIcon,
        scopes: [
          'boards:read',
          'boards:write',
          'updates:read',
          'updates:write',
          'webhooks:read',
          'webhooks:write',
          'me:read',
        ],
      },
    },
    defaultService: 'monday',
  },
  box: {
    name: 'Box',
    icon: BoxCompanyIcon,
    services: {
      box: {
        name: 'Box',
        description: 'Manage files, folders, and e-signatures with Box.',
        providerId: 'box',
        icon: BoxCompanyIcon,
        baseProviderIcon: BoxCompanyIcon,
        scopes: ['root_readwrite', 'sign_requests.readwrite'],
        serviceAccountProviderId: 'box-service-account',
      },
    },
    defaultService: 'box',
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
        serviceAccountProviderId: 'shopify-service-account',
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
        description: 'Use Slack messaging, files, reactions, views, and canvases.',
        providerId: 'slack',
        serviceAccountProviderId: 'slack-custom-bot',
        icon: SlackIcon,
        baseProviderIcon: SlackIcon,
        scopes: [
          'channels:read',
          'channels:history',
          'channels:manage',
          'groups:read',
          'groups:history',
          'groups:write',
          'chat:write',
          'chat:write.public',
          ...SLACK_APPROVAL_GATED_SCOPES,
          'im:write',
          'im:read',
          'users:read',
          // TODO: Add 'users:read.email' once Slack app review is approved
          'files:write',
          'files:read',
          'canvases:read',
          'canvases:write',
          'reactions:write',
          'reactions:read',
          // TODO: Add 'pins:read' once Slack app review is approved
        ],
      },
    },
    defaultService: 'slack',
  },
  snowflake: {
    name: 'Snowflake',
    icon: SnowflakeIcon,
    services: {
      snowflake: {
        name: 'Snowflake',
        description: 'Query data and manage warehouses and tasks in Snowflake.',
        providerId: 'snowflake',
        serviceAccountProviderId: 'snowflake-service-account',
        icon: SnowflakeIcon,
        baseProviderIcon: SnowflakeIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'snowflake',
  },
  netsuite: {
    name: 'Oracle NetSuite',
    icon: NetSuiteIcon,
    services: {
      netsuite: {
        name: 'Oracle NetSuite',
        description:
          'Manage NetSuite records, queries, datasets, batches, metadata, and asynchronous jobs.',
        providerId: 'netsuite',
        serviceAccountProviderId: 'netsuite-service-account',
        icon: NetSuiteIcon,
        baseProviderIcon: NetSuiteIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'netsuite',
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
        serviceAccountProviderId: 'wealthbox-service-account',
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
        serviceAccountProviderId: 'webflow-service-account',
        icon: WebflowIcon,
        baseProviderIcon: WebflowIcon,
        scopes: ['cms:read', 'cms:write', 'sites:read', 'sites:write', 'forms:read'],
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
        serviceAccountProviderId: 'trello-service-account',
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
        serviceAccountProviderId: 'asana-service-account',
        icon: AsanaIcon,
        baseProviderIcon: AsanaIcon,
        scopes: ['default'],
      },
    },
    defaultService: 'asana',
  },
  attio: {
    name: 'Attio',
    icon: AttioIcon,
    services: {
      attio: {
        name: 'Attio',
        description: 'Manage records, notes, tasks, lists, comments, and more in Attio CRM.',
        providerId: 'attio',
        serviceAccountProviderId: 'attio-service-account',
        icon: AttioIcon,
        baseProviderIcon: AttioIcon,
        scopes: [
          'record_permission:read-write',
          'object_configuration:read-write',
          'list_configuration:read-write',
          'list_entry:read-write',
          'note:read-write',
          'task:read-write',
          'comment:read-write',
          'user_management:read',
          'webhook:read-write',
        ],
      },
    },
    defaultService: 'attio',
  },
  calcom: {
    name: 'Cal.com',
    icon: CalComIcon,
    services: {
      calcom: {
        name: 'Cal.com',
        description: 'Manage Cal.com bookings, event types, and schedules.',
        providerId: 'calcom',
        serviceAccountProviderId: 'calcom-service-account',
        icon: CalComIcon,
        baseProviderIcon: CalComIcon,
        scopes: [],
      },
    },
    defaultService: 'calcom',
  },
  docusign: {
    name: 'DocuSign',
    icon: DocuSignIcon,
    services: {
      docusign: {
        name: 'DocuSign',
        description: 'Send documents for e-signature with DocuSign.',
        providerId: 'docusign',
        icon: DocuSignIcon,
        baseProviderIcon: DocuSignIcon,
        scopes: ['signature', 'extended'],
      },
    },
    defaultService: 'docusign',
  },
  pipedrive: {
    name: 'Pipedrive',
    icon: PipedriveIcon,
    services: {
      pipedrive: {
        name: 'Pipedrive',
        description: 'Manage deals, contacts, and sales pipeline in Pipedrive CRM.',
        providerId: 'pipedrive',
        serviceAccountProviderId: 'pipedrive-service-account',
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
        serviceAccountProviderId: 'hubspot-service-account',
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
          'crm.objects.marketing_events.read',
          'crm.objects.line_items.read',
          'crm.objects.line_items.write',
          'crm.objects.quotes.read',
          'crm.objects.appointments.read',
          'crm.objects.appointments.write',
          'crm.objects.carts.read',
          'sales-email-read',
          'crm.lists.read',
          'crm.lists.write',
          'tickets',
          'oauth',
        ],
      },
    },
    defaultService: 'hubspot',
  },
  harmonic: {
    name: 'Harmonic',
    icon: HarmonicIcon,
    services: {
      harmonic: {
        name: 'Harmonic',
        description: 'Search and enrich people with Harmonic data.',
        providerId: 'harmonic',
        serviceAccountProviderId: 'harmonic-service-account',
        icon: HarmonicIcon,
        baseProviderIcon: HarmonicIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'harmonic',
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
  instagram: {
    name: 'Instagram',
    icon: InstagramIcon,
    services: {
      instagram: {
        name: 'Instagram',
        description: 'Publish content, moderate comments, and message on Instagram.',
        providerId: 'instagram',
        icon: InstagramIcon,
        baseProviderIcon: InstagramIcon,
        scopes: [
          'instagram_business_basic',
          'instagram_business_content_publish',
          'instagram_business_manage_comments',
          'instagram_business_manage_messages',
          'instagram_business_manage_insights',
        ],
      },
    },
    defaultService: 'instagram',
  },
  salesforce: {
    name: 'Salesforce',
    icon: SalesforceIcon,
    services: {
      salesforce: {
        name: 'Salesforce',
        description: 'Access and manage your Salesforce CRM data.',
        providerId: 'salesforce',
        additionalProviderIds: SALESFORCE_ADDITIONAL_PROVIDER_IDS,
        providerIdLabels: SALESFORCE_PROVIDER_ID_LABELS,
        providerIdPickerHint: 'Sandbox orgs sign in at test.salesforce.com, not production.',
        serviceAccountProviderId: 'salesforce-service-account',
        icon: SalesforceIcon,
        baseProviderIcon: SalesforceIcon,
        scopes: ['api', 'refresh_token', 'openid'],
      },
    },
    defaultService: 'salesforce',
  },
  'zoho-desk': {
    name: 'Zoho Desk',
    icon: ZohoDeskIcon,
    services: {
      'zoho-desk': {
        name: 'Zoho Desk',
        description:
          'Manage Zoho Desk tickets, comments, threads, and contacts. Connecting with OAuth requires a Zoho account in the US data center; a Self Client also supports the EU, IN, and AU data centers.',
        providerId: 'zoho-desk',
        serviceAccountProviderId: 'zoho-desk-service-account',
        icon: ZohoDeskIcon,
        baseProviderIcon: ZohoDeskIcon,
        // Kept to what the tools and the webhook trigger exercise. NOTE: Zoho
        // lists `Desk.organization.READ , Desk.basic.READ` for GET /organizations
        // and `Desk.departments.READ , Desk.basic.READ` for GET /departments, and
        // does not document whether that comma means AND or OR. Both bootstrap
        // endpoints are assumed covered by Desk.basic.READ alone - verify against
        // a live Desk org and widen here if either returns SCOPE_MISMATCH.
        // tickets (incl. threads/comments), contacts (get_contact), basic
        // (list_organizations), agents (the `assigneeId` picker lists agents),
        // webhook create/delete (the trigger provisions and tears down its own
        // subscription), and profile (OAuth getUserInfo).
        // Desk.search.READ, Desk.webhooks.READ and Desk.webhooks.UPDATE were
        // requested but unused - no tool searches, and the provider never lists
        // or edits a subscription.
        scopes: [
          // READ + UPDATE rather than tickets.ALL: no tool creates or deletes a
          // ticket, and ALL additionally grants ticket DELETE. Threads, comments
          // and attachments live under the tickets module and are covered by
          // these two. NOTE: Zoho publishes no scope line for the attachment
          // content sub-path - verify attachment download against a live account
          // before merge and widen here if it returns SCOPE_MISMATCH.
          'Desk.tickets.READ',
          'Desk.tickets.UPDATE',
          'Desk.contacts.READ',
          // READ only: the knowledge base connector syncs Help Center articles
          // via GET /articles and GET /articles/{id}; nothing authors one.
          'Desk.articles.READ',
          // GET /organizations documents `Desk.organization.READ , Desk.basic.READ`.
          // Sibling endpoints spell the same construction "requires X and Y"
          // (dependencyMappings, roles), so the comma is AND, not OR.
          'Desk.organization.READ',
          // READ only: the agent picker for `assigneeId` lists agents, and no
          // tool creates, edits or deletes one.
          'Desk.agents.READ',
          'Desk.basic.READ',
          'Desk.webhooks.CREATE',
          'Desk.webhooks.DELETE',
          'aaaserver.profile.READ',
        ],
      },
    },
    defaultService: 'zoho-desk',
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
        serviceAccountProviderId: 'zoom-service-account',
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
  /**
   * If true, the token endpoint expects a JSON body with Content-Type: application/json
   * instead of the default application/x-www-form-urlencoded. Used by Notion.
   */
  useJsonBody?: boolean
  /**
   * Token refresh strategy. `instagram_long_lived` uses Meta's GET
   * `refresh_access_token?grant_type=ig_refresh_token` flow instead of a
   * standard OAuth refresh_token POST.
   */
  refreshStrategy?: 'standard' | 'instagram_long_lived'
  /**
   * Body param name to use for the client identifier instead of the standard `client_id`.
   * TikTok requires `client_key` instead.
   */
  clientIdParamName?: string
}

function getConfiguredClientCredentials<const TCapabilityId extends OAuthClientCapabilityId>(
  providerId: TCapabilityId,
  clientIdField: NoInfer<OAuthClientCapabilityField<TCapabilityId>>,
  clientSecretField?: NoInfer<OAuthClientCapabilityField<TCapabilityId>>
): Pick<ProviderAuthConfig, 'clientId' | 'clientSecret'> {
  const { values } = requireOAuthClientCapability(providerId, env)
  return {
    clientId: values[clientIdField],
    clientSecret: clientSecretField ? values[clientSecretField] : '',
  }
}

/**
 * Get OAuth provider configuration for token refresh
 */
function getProviderAuthConfig(provider: string): ProviderAuthConfig {
  switch (provider) {
    case 'google': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'google',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'x': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'x',
        'X_CLIENT_ID',
        'X_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.x.com/2/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'tiktok': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'tiktok',
        'TIKTOK_CLIENT_ID',
        'TIKTOK_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://open.tiktokapis.com/v2/oauth/token/',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        // TikTok requires `client_key` in the token request body instead of `client_id`.
        clientIdParamName: 'client_key',
      }
    }
    case 'confluence': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'confluence',
        'CONFLUENCE_CLIENT_ID',
        'CONFLUENCE_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'jira',
        'JIRA_CLIENT_ID',
        'JIRA_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'calcom': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'calcom',
        'CALCOM_CLIENT_ID'
      )
      return {
        tokenEndpoint: 'https://app.cal.com/api/auth/oauth/refreshToken',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        // Cal.com requires refresh token in Authorization header, not body
        refreshTokenInAuthHeader: true,
      }
    }
    case 'airtable': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'airtable',
        'AIRTABLE_CLIENT_ID',
        'AIRTABLE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://airtable.com/oauth2/v1/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'bitbucket': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'bitbucket',
        'BITBUCKET_CLIENT_ID',
        'BITBUCKET_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://bitbucket.org/site/oauth2/access_token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'notion': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'notion',
        'NOTION_CLIENT_ID',
        'NOTION_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
        useJsonBody: true,
      }
    }
    case 'microsoft':
    case 'outlook':
    case 'onedrive':
    case 'sharepoint': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'microsoft',
        'MICROSOFT_CLIENT_ID',
        'MICROSOFT_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'clickup': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'clickup',
        'CLICKUP_CLIENT_ID',
        'CLICKUP_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.clickup.com/api/v2/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'linear': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'linear',
        'LINEAR_CLIENT_ID',
        'LINEAR_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.linear.app/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'attio': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'attio',
        'ATTIO_CLIENT_ID',
        'ATTIO_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://app.attio.com/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
      }
    }
    case 'box': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'box',
        'BOX_CLIENT_ID',
        'BOX_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.box.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        // Box refresh tokens are single-use: "the Refresh Token is invalidated and a
        // new Refresh Token is returned" and "A Refresh Token is valid for 60 days and
        // can be used to obtain a new Access Token and Refresh Token only once."
        // (developer.box.com/guides/authentication/tokens/refresh). Without rotation the
        // new token is discarded and the credential dies on the second refresh.
        supportsRefreshTokenRotation: true,
      }
    }
    case 'docusign': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'docusign',
        'DOCUSIGN_CLIENT_ID',
        'DOCUSIGN_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: getDocusignOAuthUrl('/oauth/token'),
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'dropbox': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'dropbox',
        'DROPBOX_CLIENT_ID',
        'DROPBOX_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'slack': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'slack',
        'SLACK_CLIENT_ID',
        'SLACK_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'reddit',
        'REDDIT_CLIENT_ID',
        'REDDIT_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://www.reddit.com/api/v1/access_token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        additionalHeaders: {
          'User-Agent': REDDIT_USER_AGENT,
        },
      }
    }
    case 'wealthbox': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'wealthbox',
        'WEALTHBOX_CLIENT_ID',
        'WEALTHBOX_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'webflow',
        'WEBFLOW_CLIENT_ID',
        'WEBFLOW_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'asana',
        'ASANA_CLIENT_ID',
        'ASANA_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'pipedrive',
        'PIPEDRIVE_CLIENT_ID',
        'PIPEDRIVE_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'hubspot',
        'HUBSPOT_CLIENT_ID',
        'HUBSPOT_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'linkedin',
        'LINKEDIN_CLIENT_ID',
        'LINKEDIN_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'instagram': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'instagram',
        'INSTAGRAM_CLIENT_ID',
        'INSTAGRAM_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://graph.instagram.com/refresh_access_token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
        refreshStrategy: 'instagram_long_lived',
      }
    }
    case 'salesforce':
    case 'salesforce-sandbox': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'salesforce',
        'SALESFORCE_CLIENT_ID',
        'SALESFORCE_CLIENT_SECRET'
      )
      // A refresh token is only redeemable at the authorization server that
      // issued it: a sandbox token posted to login.salesforce.com fails with
      // `invalid_grant`. One Connected App's consumer key is valid at both
      // hosts, so only the endpoint differs.
      return {
        tokenEndpoint: `https://${SALESFORCE_LOGIN_HOSTS[provider]}/services/oauth2/token`,
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'shopify': {
      // Shopify access tokens don't expire and don't support refresh tokens
      // This configuration is provided for completeness but won't be used for token refresh
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'shopify',
        'SHOPIFY_CLIENT_ID',
        'SHOPIFY_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'zoom',
        'ZOOM_CLIENT_ID',
        'ZOOM_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://zoom.us/oauth/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'wordpress': {
      // WordPress.com does NOT support refresh tokens
      // Users will need to re-authorize when tokens expire (~2 weeks)
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'wordpress',
        'WORDPRESS_CLIENT_ID',
        'WORDPRESS_CLIENT_SECRET'
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
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'spotify',
        'SPOTIFY_CLIENT_ID',
        'SPOTIFY_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://accounts.spotify.com/api/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'monday': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'monday',
        'MONDAY_CLIENT_ID',
        'MONDAY_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://auth.monday.com/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'zoho-desk': {
      // Zoho's refresh_token grant returns a new access token but no new refresh
      // token, so rotation stays off (the existing refresh token is preserved).
      // The refresh must target the accounts server of the data center that issued
      // the token - "if location=eu, you will need to make access token request to
      // https://accounts.zoho.eu" (zoho.com/accounts/protocol/oauth/multi-dc.html).
      // accounts.zoho.com is correct here because the authorize and code-exchange
      // legs in lib/auth/connectors/providers.ts are also pinned to the US accounts
      // server, so every refresh token in the system is US-issued. Making refresh
      // DC-aware requires making the grant DC-aware first (read the `accounts-server`
      // callback param) and threading the credential's persisted `__zoho_domain__`
      // marker into refreshOAuthToken, which today only receives the token string.
      // Data residency for API calls is already honored via that persisted Desk base.
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'zoho-desk',
        'ZOHO_CLIENT_ID',
        'ZOHO_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://accounts.zoho.com/oauth/v2/token',
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
): { headers: Record<string, string>; bodyParams: Record<string, string>; useJsonBody?: boolean } {
  const headers: Record<string, string> = {
    'Content-Type': config.useJsonBody ? 'application/json' : 'application/x-www-form-urlencoded',
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
    bodyParams[config.clientIdParamName || 'client_id'] = config.clientId
    if (config.clientSecret) {
      bodyParams.client_secret = config.clientSecret
    }
  }

  return { headers, bodyParams, useJsonBody: config.useJsonBody }
}

/**
 * Resolves the key {@link getProviderAuthConfig} is switched on for a stored
 * credential's provider id.
 *
 * Normally that is the base provider, because every service in a family
 * refreshes against the same endpoint with the same client. A provider id
 * listed in a service's `additionalProviderIds` is the exception: it names a
 * *different* authorization server for the same service, so it must reach
 * `getProviderAuthConfig` intact — collapsing it to the base would silently
 * refresh a sandbox token against the production endpoint.
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
      if (service.additionalProviderIds?.includes(providerId)) {
        return providerId
      }
    }
  }

  throw new Error(`Unknown OAuth provider: ${providerId}`)
}

export interface RefreshTokenSuccess {
  ok: true
  accessToken: string
  expiresIn: number
  refreshToken: string
}

export interface RefreshTokenFailure {
  ok: false
  errorCode?: string
  message?: string
}

export type RefreshTokenResult = RefreshTokenSuccess | RefreshTokenFailure

function extractErrorCode(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'error' in value) {
    const error = (value as { error: unknown }).error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: unknown }).code
      if (typeof code === 'string' || typeof code === 'number') return String(code)
    }
  }
  return undefined
}

/**
 * Hard deadline on the token-endpoint exchange. This function does not coalesce
 * on its own; its sole production caller (`performCoalescedRefresh` in the OAuth
 * utils) shares one in-flight refresh across concurrent callers for a credential.
 * Without this bound a hung endpoint would wedge every joiner on that key until
 * the undici socket defaults (~5 min) gave up.
 */
const TOKEN_REFRESH_TIMEOUT_MS = 15_000

async function refreshInstagramLongLivedToken(
  config: ProviderAuthConfig,
  longLivedToken: string,
  providerId: string
): Promise<RefreshTokenResult> {
  const url = new URL(config.tokenEndpoint)
  url.searchParams.set('grant_type', 'ig_refresh_token')
  url.searchParams.set('access_token', longLivedToken)

  const response = await fetch(url.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
  })

  const responseText = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Instagram token refresh response',
  })
  let responseData: unknown = responseText
  try {
    responseData = JSON.parse(responseText)
  } catch {
    responseData = responseText
  }

  if (!response.ok) {
    const errorSummary = truncate(responseText, 1000)
    logger.error('Instagram long-lived token refresh failed:', {
      status: response.status,
      statusText: response.statusText,
      error: errorSummary,
      parsedError: responseData,
      providerId,
      tokenEndpoint: config.tokenEndpoint,
    })
    return {
      ok: false,
      errorCode: extractErrorCode(responseData),
      message: `Failed to refresh token: ${response.status} ${errorSummary}`,
    }
  }

  const payload = parseInstagramLongLivedToken(responseData)
  if (!payload) {
    logger.warn('Invalid Instagram refresh response', { providerId })
    return { ok: false, message: 'Invalid Instagram token refresh response' }
  }

  logger.info('Instagram long-lived token refreshed successfully', {
    expiresIn: payload.expires_in,
    providerId,
  })

  // Instagram returns a new long-lived token; store it as both access and refresh.
  return {
    ok: true,
    accessToken: payload.access_token,
    expiresIn: payload.expires_in,
    refreshToken: payload.access_token,
  }
}

export async function refreshOAuthToken(
  providerId: string,
  refreshToken: string
): Promise<RefreshTokenResult> {
  try {
    const provider = getBaseProviderForService(providerId)

    const config = getProviderAuthConfig(provider)

    if (config.refreshStrategy === 'instagram_long_lived') {
      return await refreshInstagramLongLivedToken(config, refreshToken, providerId)
    }

    const { headers, bodyParams, useJsonBody } = buildAuthRequest(config, refreshToken)

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: useJsonBody ? JSON.stringify(bodyParams) : new URLSearchParams(bodyParams).toString(),
      signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorData: unknown = errorText

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
      })
      return {
        ok: false,
        errorCode: extractErrorCode(errorData),
        message: `Failed to refresh token: ${response.status} ${errorText}`,
      }
    }

    const data = await response.json()

    if (data && typeof data === 'object' && data.ok === false) {
      logger.error('Token refresh failed:', {
        status: response.status,
        statusText: response.statusText,
        error: data.error,
        parsedError: data,
        providerId,
        tokenEndpoint: config.tokenEndpoint,
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!refreshToken,
      })
      return {
        ok: false,
        errorCode: typeof data.error === 'string' ? data.error : undefined,
        message: `Failed to refresh token: ${data.error ?? 'unknown'}`,
      }
    }

    const accessToken = data.access_token

    let newRefreshToken = null
    if (config.supportsRefreshTokenRotation && data.refresh_token) {
      newRefreshToken = data.refresh_token
      logger.info(`Received new refresh token from ${provider}`)
    }

    const expiresIn = data.expires_in || data.expiresIn || 3600

    if (!accessToken) {
      // Log only the shape, never `data` itself - on a partial success it can
      // carry live tokens.
      logger.warn('No access token found in refresh response', {
        providerId,
        responseKeys: Object.keys(data ?? {}),
      })
      return { ok: false, message: 'No access token in refresh response' }
    }

    logger.info('Token refreshed successfully with expiration', {
      expiresIn,
      hasNewRefreshToken: !!newRefreshToken,
      provider,
    })

    return {
      ok: true,
      accessToken,
      expiresIn,
      refreshToken: newRefreshToken || refreshToken, // Return new refresh token if available
    }
  } catch (error) {
    const message = toError(error).message
    logger.error('Error refreshing token:', { error: message })
    return { ok: false, message }
  }
}
