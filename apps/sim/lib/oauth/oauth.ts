import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
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
import { redactExactSensitiveValues } from '@/lib/core/security/redaction'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getDocusignOAuthUrl } from '@/lib/oauth/docusign'
import { parseInstagramLongLivedToken } from '@/lib/oauth/instagram'
import { MONDAY_OAUTH_TOKEN_URL, resolveMondayAccessTokenExpiresAt } from '@/lib/oauth/monday'
import {
  SALESFORCE_ADDITIONAL_PROVIDER_IDS,
  SALESFORCE_LOGIN_HOSTS,
  SALESFORCE_PROVIDER_ID_LABELS,
} from '@/lib/oauth/salesforce'
import { REDDIT_USER_AGENT } from '@/tools/reddit/constants'
import { OAUTH_SCOPES } from './scopes'
import type { OAuthProviderConfig } from './types'

const logger = createLogger('OAuth')

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
        scopes: [...OAUTH_SCOPES['claude-platform']],
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
        scopes: [...OAUTH_SCOPES.gmail],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-drive': {
        name: 'Google Drive',
        description: 'Streamline file organization and document workflows.',
        providerId: 'google-drive',
        icon: GoogleDriveIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-drive']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-docs': {
        name: 'Google Docs',
        description: 'Create, read, and edit Google Documents programmatically.',
        providerId: 'google-docs',
        icon: GoogleDocsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-docs']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-sheets': {
        name: 'Google Sheets',
        description: 'Manage and analyze data with Google Sheets integration.',
        providerId: 'google-sheets',
        icon: GoogleSheetsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-sheets']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-forms': {
        name: 'Google Forms',
        description: 'Create, modify, and read Google Forms.',
        providerId: 'google-forms',
        icon: GoogleFormsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-forms']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-calendar': {
        name: 'Google Calendar',
        description: 'Schedule and manage events with Google Calendar.',
        providerId: 'google-calendar',
        icon: GoogleCalendarIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-calendar']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-contacts': {
        name: 'Google Contacts',
        description: 'Create, read, update, and search contacts with Google Contacts.',
        providerId: 'google-contacts',
        icon: GoogleContactsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-contacts']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-ads': {
        name: 'Google Ads',
        description: 'Query campaigns, ad groups, and performance metrics in Google Ads.',
        providerId: 'google-ads',
        icon: GoogleAdsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-ads']],
      },
      'google-bigquery': {
        name: 'Google BigQuery',
        description: 'Query, list, and insert data in Google BigQuery.',
        providerId: 'google-bigquery',
        icon: GoogleBigQueryIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-bigquery']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-tasks': {
        name: 'Google Tasks',
        description: 'Create, manage, and organize tasks with Google Tasks.',
        providerId: 'google-tasks',
        icon: GoogleTasksIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-tasks']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-vault': {
        name: 'Google Vault',
        description: 'Search, export, and manage matters/holds via Google Vault.',
        providerId: 'google-vault',
        icon: GoogleVaultIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-vault']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-groups': {
        name: 'Google Groups',
        description: 'Manage Google Workspace Groups and their members.',
        providerId: 'google-groups',
        icon: GoogleGroupsIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-groups']],
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
        scopes: [...OAUTH_SCOPES['google-chat']],
      },
      'google-meet': {
        name: 'Google Meet',
        description: 'Create and manage Google Meet meeting spaces and conferences.',
        providerId: 'google-meet',
        icon: GoogleMeetIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-meet']],
        serviceAccountProviderId: 'google-service-account',
      },
      'google-service-account': {
        name: 'Google Service Account',
        description: 'Authenticate with a JSON key file from Google Cloud Console.',
        providerId: 'google-service-account',
        icon: GoogleIcon,
        baseProviderIcon: GoogleIcon,
        scopes: [...OAUTH_SCOPES['google-service-account']],
        authType: 'service_account',
      },
      'vertex-ai': {
        name: 'Vertex AI',
        description: 'Access Google Cloud Vertex AI for Gemini models with OAuth.',
        providerId: 'vertex-ai',
        icon: VertexIcon,
        baseProviderIcon: VertexIcon,
        scopes: [...OAUTH_SCOPES['vertex-ai']],
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
        scopes: [...OAUTH_SCOPES['microsoft-ad']],
      },
      'microsoft-dataverse': {
        name: 'Microsoft Dataverse',
        description: 'Connect to Microsoft Dataverse and manage records.',
        providerId: 'microsoft-dataverse',
        icon: MicrosoftDataverseIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [...OAUTH_SCOPES['microsoft-dataverse']],
      },
      'microsoft-excel': {
        name: 'Microsoft Excel',
        description: 'Connect to Microsoft Excel and manage spreadsheets.',
        providerId: 'microsoft-excel',
        icon: MicrosoftExcelIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [...OAUTH_SCOPES['microsoft-excel']],
      },
      'microsoft-planner': {
        name: 'Microsoft Planner',
        description: 'Connect to Microsoft Planner and manage tasks.',
        providerId: 'microsoft-planner',
        icon: MicrosoftPlannerIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [...OAUTH_SCOPES['microsoft-planner']],
      },
      'microsoft-teams': {
        name: 'Microsoft Teams',
        description: 'Connect to Microsoft Teams and manage messages.',
        providerId: 'microsoft-teams',
        icon: MicrosoftTeamsIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [...OAUTH_SCOPES['microsoft-teams']],
      },
      'microsoft-word': {
        name: 'Microsoft Word',
        description: 'Connect to Microsoft Word and manage documents.',
        providerId: 'microsoft-word',
        icon: MicrosoftWordIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [...OAUTH_SCOPES['microsoft-word']],
      },
      outlook: {
        name: 'Outlook',
        description: 'Connect to Outlook and manage emails and calendar events.',
        providerId: 'outlook',
        icon: OutlookIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [...OAUTH_SCOPES.outlook],
      },
      onedrive: {
        name: 'OneDrive',
        description: 'Connect to OneDrive and manage files.',
        providerId: 'onedrive',
        icon: MicrosoftOneDriveIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [...OAUTH_SCOPES.onedrive],
      },
      sharepoint: {
        name: 'SharePoint',
        description: 'Connect to SharePoint and manage sites.',
        providerId: 'sharepoint',
        icon: MicrosoftSharepointIcon,
        baseProviderIcon: MicrosoftIcon,
        scopes: [...OAUTH_SCOPES.sharepoint],
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
        scopes: [...OAUTH_SCOPES.x],
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
        scopes: [...OAUTH_SCOPES.tiktok],
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
        scopes: [...OAUTH_SCOPES['atlassian-service-account']],
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
        scopes: [...OAUTH_SCOPES.confluence],
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
        scopes: [...OAUTH_SCOPES.jira],
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
        scopes: [...OAUTH_SCOPES.airtable],
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
        scopes: [...OAUTH_SCOPES.bitbucket],
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
        scopes: [...OAUTH_SCOPES.notion],
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
        scopes: [...OAUTH_SCOPES.clickup],
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
        scopes: [...OAUTH_SCOPES.linear],
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
        scopes: [...OAUTH_SCOPES.monday],
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
        scopes: [...OAUTH_SCOPES.box],
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
        scopes: [...OAUTH_SCOPES.dropbox],
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
        scopes: [...OAUTH_SCOPES.shopify],
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
        scopes: [...OAUTH_SCOPES.slack, ...SLACK_APPROVAL_GATED_SCOPES],
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
        scopes: [...OAUTH_SCOPES.snowflake],
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
        scopes: [...OAUTH_SCOPES.netsuite],
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
        scopes: [...OAUTH_SCOPES.reddit],
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
        scopes: [...OAUTH_SCOPES.wealthbox],
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
        scopes: [...OAUTH_SCOPES.webflow],
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
        scopes: [...OAUTH_SCOPES.trello],
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
        scopes: [...OAUTH_SCOPES.asana],
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
        scopes: [...OAUTH_SCOPES.attio],
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
        scopes: [...OAUTH_SCOPES.calcom],
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
        scopes: [...OAUTH_SCOPES.docusign],
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
        scopes: [...OAUTH_SCOPES.pipedrive],
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
        scopes: [...OAUTH_SCOPES.hubspot],
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
        scopes: [...OAUTH_SCOPES.harmonic],
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
        scopes: [...OAUTH_SCOPES.linkedin],
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
        scopes: [...OAUTH_SCOPES.instagram],
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
        scopes: [...OAUTH_SCOPES.salesforce],
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
        scopes: [...OAUTH_SCOPES['zoho-desk']],
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
        scopes: [...OAUTH_SCOPES.zoom],
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
        scopes: [...OAUTH_SCOPES.wordpress],
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
        scopes: [...OAUTH_SCOPES.spotify],
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
        tokenEndpoint: MONDAY_OAUTH_TOKEN_URL,
        clientId,
        clientSecret,
        useBasicAuth: false,
        useJsonBody: true,
        supportsRefreshTokenRotation: true,
      }
    }
    case 'manageengine-sdp': {
      // ServiceDesk Plus Cloud authenticates through Zoho, so the grant is the
      // same one Zoho Desk uses and shares its client credentials: scopes are
      // chosen per authorization request, not per API-console client, so one
      // registered client serves both products.
      //
      // Rotation stays off for the same reason as zoho-desk below - Zoho's
      // refresh_token grant returns a new access token but no new refresh token.
      // accounts.zoho.com is correct because the authorize and code-exchange
      // legs in lib/auth/connectors/providers.ts are pinned to the US accounts
      // server, so every refresh token in the system is US-issued. Data
      // residency for API calls is honored separately, via the block's data
      // center selector.
      // Keyed on the `zoho-desk` capability, which is what
      // `resolveOAuthClientCapabilityId('manageengine-sdp')` aliases to — the
      // capability names the env pair, not the product.
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

function safeOAuthErrorCode(value: unknown, secrets: string[]): string | undefined {
  const errorCode = extractErrorCode(value)
  if (!errorCode) return undefined
  const safeCode = redactExactSensitiveValues(errorCode, secrets).trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(safeCode) ? safeCode : undefined
}

/**
 * Hard deadline on the token-endpoint exchange. This function does not coalesce
 * on its own; its sole production caller (`performCoalescedRefresh` in the OAuth
 * utils) shares one in-flight refresh across concurrent callers for a credential.
 * Without this bound a hung endpoint would wedge every joiner on that key until
 * the undici socket defaults (~5 min) gave up.
 */
const TOKEN_REFRESH_TIMEOUT_MS = 15_000

function parseOAuthResponse(responseText: string): unknown {
  try {
    return JSON.parse(responseText)
  } catch {
    return responseText
  }
}

function oauthResponseRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const OAUTH_RESPONSE_OMITTED = '[token endpoint response omitted]'

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
    redirect: 'error',
    signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
  })

  const responseText = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Instagram token refresh response',
  })
  const responseData = parseOAuthResponse(responseText)

  if (!response.ok) {
    const exactSecrets = [longLivedToken, config.clientSecret ?? '']
    const errorCode = safeOAuthErrorCode(responseData, exactSecrets)
    logger.error('Instagram long-lived token refresh failed:', {
      status: response.status,
      error: OAUTH_RESPONSE_OMITTED,
      errorCode,
      providerId,
      tokenEndpoint: config.tokenEndpoint,
    })
    return {
      ok: false,
      errorCode,
      message: `Failed to refresh token: ${response.status} ${OAUTH_RESPONSE_OMITTED}`,
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
  const exactSecrets = [refreshToken]
  try {
    const provider = getBaseProviderForService(providerId)

    const config = getProviderAuthConfig(provider)
    if (config.clientSecret) exactSecrets.push(config.clientSecret)

    if (config.refreshStrategy === 'instagram_long_lived') {
      return await refreshInstagramLongLivedToken(config, refreshToken, providerId)
    }

    const { headers, bodyParams, useJsonBody } = buildAuthRequest(config, refreshToken)

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: useJsonBody ? JSON.stringify(bodyParams) : new URLSearchParams(bodyParams).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
    })

    const responseText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'OAuth token refresh response',
    })
    const responseData = parseOAuthResponse(responseText)

    if (!response.ok) {
      const errorCode = safeOAuthErrorCode(responseData, exactSecrets)

      logger.error('Token refresh failed:', {
        status: response.status,
        error: OAUTH_RESPONSE_OMITTED,
        errorCode,
        providerId,
        tokenEndpoint: config.tokenEndpoint,
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!refreshToken,
      })
      return {
        ok: false,
        errorCode,
        message: `Failed to refresh token: ${response.status} ${OAUTH_RESPONSE_OMITTED}`,
      }
    }

    const data = oauthResponseRecord(responseData)
    if (!data) {
      logger.warn('Invalid OAuth token refresh response', { providerId })
      return { ok: false, message: 'Invalid OAuth token refresh response' }
    }

    if (data.ok === false) {
      const errorCode = safeOAuthErrorCode(data, exactSecrets)
      logger.error('Token refresh failed:', {
        status: response.status,
        error: OAUTH_RESPONSE_OMITTED,
        errorCode,
        providerId,
        tokenEndpoint: config.tokenEndpoint,
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!refreshToken,
      })
      return {
        ok: false,
        errorCode,
        message: `Failed to refresh token: ${OAUTH_RESPONSE_OMITTED}`,
      }
    }

    const accessToken =
      typeof data.access_token === 'string' && data.access_token.length > 0
        ? data.access_token
        : undefined

    let newRefreshToken: string | undefined
    if (
      config.supportsRefreshTokenRotation &&
      typeof data.refresh_token === 'string' &&
      data.refresh_token.length > 0
    ) {
      newRefreshToken = data.refresh_token
      logger.info(`Received new refresh token from ${provider}`)
    }
    if (provider === 'monday' && !newRefreshToken) {
      logger.warn('Monday token refresh response omitted its rotating refresh token')
      return { ok: false, message: 'Invalid Monday token refresh response' }
    }

    const rawExpiresIn = data.expires_in ?? data.expiresIn
    const parsedExpiresIn =
      typeof rawExpiresIn === 'number' || typeof rawExpiresIn === 'string'
        ? Number(rawExpiresIn)
        : Number.NaN
    const responseExpiresIn =
      Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0 ? parsedExpiresIn : undefined
    const expiresIn =
      provider === 'monday' && accessToken
        ? Math.max(
            1,
            Math.ceil(
              (resolveMondayAccessTokenExpiresAt(accessToken, responseExpiresIn).getTime() -
                Date.now()) /
                1000
            )
          )
        : (responseExpiresIn ?? 3600)

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
      refreshToken: newRefreshToken ?? refreshToken,
    }
  } catch (error) {
    const normalized = toError(error)
    const message =
      normalized.name === 'PayloadSizeLimitError' || normalized.message.startsWith('OAuth client ')
        ? normalized.message
        : 'Token refresh failed'
    logger.error('Error refreshing token', { errorType: normalized.name })
    return { ok: false, message }
  }
}
