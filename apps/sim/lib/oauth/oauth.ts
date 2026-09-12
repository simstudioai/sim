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
  GithubIcon,
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
  ManageEngineIcon,
  MicrosoftDataverseIcon,
  MicrosoftExcelIcon,
  MicrosoftIcon,
  MicrosoftOneDriveIcon,
  MicrosoftPlannerIcon,
  MicrosoftSharepointIcon,
  MicrosoftTeamsIcon,
  MicrosoftWordIcon,
  MondayIcon,
  NetSuiteIcon,
  NotionIcon,
  OutlookIcon,
  PipedriveIcon,
  QuickBooksIcon,
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
import { isSlackExtendedScopesEnabled } from '@/lib/core/config/env-flags'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import {
  SALESFORCE_ADDITIONAL_PROVIDER_IDS,
  SALESFORCE_PROVIDER_ID_LABELS,
} from '@/lib/oauth/salesforce'
import type { OAuthProviderConfig } from '@/lib/oauth/types'

/**
 * Slack scopes requested only where the app is approved for them, gated by
 * {@link isSlackExtendedScopesEnabled}. Slack rejects the entire authorization
 * with "unapproved permissions requested" when any requested scope is not on the
 * app's approved list, so these stay out of the default grant.
 */
export function getSlackApprovalGatedScopes(enabled: boolean): readonly string[] {
  return enabled ? ['assistant:write', 'app_mentions:read', 'im:history'] : []
}

const SLACK_APPROVAL_GATED_SCOPES = getSlackApprovalGatedScopes(isSlackExtendedScopesEnabled)

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  'github-repositories': {
    name: 'GitHub',
    icon: GithubIcon,
    services: {
      'github-repositories': {
        name: 'GitHub',
        description: 'Search repository files through your GitHub App access.',
        providerId: 'github-repositories',
        serviceAccountProviderId: GITHUB_INSTALLATION_PROVIDER_ID,
        icon: GithubIcon,
        baseProviderIcon: GithubIcon,
        scopes: [],
      },
    },
    defaultService: 'github-repositories',
  },
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
      'microsoft-word': {
        name: 'Microsoft Word',
        description: 'Connect to Microsoft Word and manage documents.',
        providerId: 'microsoft-word',
        icon: MicrosoftWordIcon,
        baseProviderIcon: MicrosoftIcon,
        /**
         * Word documents are ordinary drive items, so the integration reads and
         * writes them through the Files permissions rather than a Word-specific
         * scope — Microsoft Graph exposes no Word API of its own.
         *
         * The `.All` variants are what make the SharePoint drive the block
         * exposes actually work: `Files.ReadWrite` alone covers only the signed-in
         * user's own OneDrive, so a document library would be rejected for
         * insufficient privileges. Both are user-consentable, so this does not
         * push the integration behind admin consent, and neither grants access to
         * anything the signed-in account could not already open.
         *
         * @see https://learn.microsoft.com/en-us/graph/permissions-reference
         */
        scopes: [
          'openid',
          'profile',
          'email',
          'Files.Read',
          'Files.ReadWrite',
          'Files.Read.All',
          'Files.ReadWrite.All',
          'offline_access',
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
          'read:group:confluence',
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
          'webhook',
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
  'manageengine-sdp': {
    name: 'ManageEngine ServiceDesk Plus',
    icon: ManageEngineIcon,
    services: {
      'manageengine-sdp': {
        name: 'ManageEngine ServiceDesk Plus',
        description:
          'Manage ServiceDesk Plus Cloud requests, notes, problems, changes, assets, and knowledge base solutions. Connecting requires a Zoho account in the US data center — the authorize and token-exchange legs are pinned to accounts.zoho.com, and a Zoho access token is only valid in the data center that issued it.',
        providerId: 'manageengine-sdp',
        icon: ManageEngineIcon,
        baseProviderIcon: ManageEngineIcon,
        // ServiceDesk Plus Cloud scopes are `SDPOnDemand.<module>.<operation>`
        // (getting-started/oauth-2.0.html). Enumerated per operation rather
        // than requested as the broader `.ALL` group scopes, so the consent
        // screen names exactly what the block can do.
        //
        // The five modules here are the ones the tools cover. Notably absent:
        // the standalone Tasks module (/api/v3/tasks). Its endpoints are
        // documented but the scope table publishes no `tasks` entry, and
        // guessing one would put an unverified scope on every user's consent
        // screen - so those tools are deliberately not implemented.
        scopes: [
          'SDPOnDemand.requests.CREATE',
          'SDPOnDemand.requests.READ',
          'SDPOnDemand.requests.UPDATE',
          'SDPOnDemand.requests.DELETE',
          'SDPOnDemand.problems.CREATE',
          'SDPOnDemand.problems.READ',
          'SDPOnDemand.problems.UPDATE',
          'SDPOnDemand.problems.DELETE',
          'SDPOnDemand.changes.CREATE',
          'SDPOnDemand.changes.READ',
          'SDPOnDemand.changes.UPDATE',
          'SDPOnDemand.changes.DELETE',
          'SDPOnDemand.assets.CREATE',
          'SDPOnDemand.assets.READ',
          'SDPOnDemand.assets.UPDATE',
          'SDPOnDemand.assets.DELETE',
          'SDPOnDemand.solutions.CREATE',
          'SDPOnDemand.solutions.READ',
          'SDPOnDemand.solutions.UPDATE',
          'SDPOnDemand.solutions.DELETE',
          // Zoho account profile, used by getUserInfo to label the credential.
          'aaaserver.profile.READ',
        ],
      },
    },
    defaultService: 'manageengine-sdp',
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
  quickbooks: {
    name: 'QuickBooks',
    icon: QuickBooksIcon,
    services: {
      quickbooks: {
        name: 'QuickBooks',
        description:
          'Access company data and manage customers, vendors, and items in QuickBooks Online.',
        providerId: 'quickbooks',
        icon: QuickBooksIcon,
        baseProviderIcon: QuickBooksIcon,
        scopes: ['openid', 'profile', 'email', 'com.intuit.quickbooks.accounting'],
        clientConfiguration: {
          redirectPath: '/api/auth/oauth2/callback/quickbooks',
          fields: [
            {
              id: 'clientId',
              label: 'Client ID',
              placeholder: 'Enter your Intuit app client ID',
              secret: false,
            },
            {
              id: 'clientSecret',
              label: 'Client secret',
              placeholder: 'Enter your Intuit app client secret',
              secret: true,
            },
            {
              id: 'environment',
              label: 'Environment',
              placeholder: 'Select an Intuit environment',
              secret: false,
              options: [
                { value: 'sandbox', label: 'Sandbox' },
                { value: 'production', label: 'Production' },
              ],
              hint: 'Use the environment that matches the credentials in your Intuit app.',
            },
            {
              id: 'webhookVerifierToken',
              label: 'Webhook verifier token',
              placeholder: 'Enter your Intuit app webhook verifier token',
              secret: true,
              hint: 'Used only to authenticate QuickBooks webhook triggers for this Intuit app.',
            },
          ],
        },
      },
    },
    defaultService: 'quickbooks',
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
