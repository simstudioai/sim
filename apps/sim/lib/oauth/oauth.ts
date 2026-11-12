import {
  type OAuthClientCapabilityField,
  type OAuthClientCapabilityId,
  requireOAuthClientCapability,
} from '@sim/deployment-config/env-capabilities'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  AffinityIcon,
  AgentMailIcon,
  AgentPhoneIcon,
  AhrefsIcon,
  AirtableIcon,
  AlgoliaIcon,
  AmplitudeIcon,
  ApifyIcon,
  ApolloIcon,
  AsanaIcon,
  AshbyIcon,
  AtlassianIcon,
  AttioIcon,
  AzureDataExplorerIcon,
  AzureIcon,
  BitbucketIcon,
  BoxCompanyIcon,
  BrexIcon,
  BrightDataIcon,
  BrowserUseIcon,
  BufferIcon,
  CalComIcon,
  CalendlyIcon,
  CbInsightsIcon,
  CheckrIcon,
  CirclebackIcon,
  ClaudeIcon,
  ClerkIcon,
  ClickUpIcon,
  CloudflareIcon,
  CodaIcon,
  ConfluenceIcon,
  ConvexIcon,
  CrowdStrikeIcon,
  CrunchbaseIcon,
  CursorIcon,
  DatabricksIcon,
  DatadogIcon,
  DaytonaIcon,
  DevinIcon,
  DiscordIcon,
  DocuSignIcon,
  DropboxIcon,
  DubIcon,
  DynatraceIcon,
  ElevenLabsIcon,
  EmailBisonIcon,
  EnrichSoIcon,
  ExtendIcon,
  FathomIcon,
  FirefliesIcon,
  FivetranIcon,
  FlintIcon,
  FlowIcon,
  GammaIcon,
  GaugeIcon,
  GithubIcon,
  GitLabIcon,
  GmailIcon,
  GongIcon,
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
  GrafanaIcon,
  GrainIcon,
  GranolaIcon,
  GreenhouseIcon,
  HarmonicIcon,
  HelpScoutIcon,
  HexIcon,
  HiggsfieldIcon,
  HubspotIcon,
  HuggingFaceIcon,
  IAMIcon,
  IncidentioIcon,
  InfisicalIcon,
  InstagramIcon,
  InstantlyIcon,
  IntercomIcon,
  IntuneIcon,
  JamaIcon,
  JiraIcon,
  JotformIcon,
  JupyterIcon,
  KalshiIcon,
  LangsmithIcon,
  LaunchDarklyIcon,
  LemlistIcon,
  LinearIcon,
  LinkedInIcon,
  LinqIcon,
  LogfireIcon,
  LoopsIcon,
  LumaIcon,
  MailchimpIcon,
  MailgunIcon,
  ManageEngineIcon,
  Mem0Icon,
  MicrosoftDataverseIcon,
  MicrosoftExcelIcon,
  MicrosoftIcon,
  MicrosoftOneDriveIcon,
  MicrosoftPlannerIcon,
  MicrosoftSharepointIcon,
  MicrosoftSqlIcon,
  MicrosoftTeamsIcon,
  MicrosoftWordIcon,
  MondayIcon,
  MySQLIcon,
  NetSuiteIcon,
  NewRelicIcon,
  NotionIcon,
  OktaIcon,
  OracleIcon,
  OtterIcon,
  OutlookIcon,
  PagerDutyIcon,
  PersonaIcon,
  PipedriveIcon,
  PlaneIcon,
  PlanetScaleIcon,
  PostgresIcon,
  PowerBIIcon,
  ProfoundIcon,
  PulseIcon,
  QdrantIcon,
  QuartrIcon,
  QuickBooksIcon,
  QuiverIcon,
  RailwayIcon,
  RampIcon,
  RB2BIcon,
  RedditIcon,
  ReductoIcon,
  ResendIcon,
  RipplingIcon,
  RocketlaneIcon,
  RootlyIcon,
  SailPointIcon,
  SalesforceIcon,
  SendgridIcon,
  SentryIcon,
  ServiceNowIcon,
  ShopifyIcon,
  SimilarwebIcon,
  SixtyfourIcon,
  SlackIcon,
  SmartleadIcon,
  SnowflakeIcon,
  SplunkIcon,
  SportmonksIcon,
  SpotifyIcon,
  SquareIcon,
  StripeIcon,
  SupabaseIcon,
  TailscaleIcon,
  TavilyIcon,
  TelegramIcon,
  ThriveIcon,
  TikTokIcon,
  TinybirdIcon,
  TrelloIcon,
  TriggerDevIcon,
  TwilioIcon,
  TypeformIcon,
  UpstashIcon,
  UptimeRobotIcon,
  VantaIcon,
  VercelIcon,
  VertexIcon,
  WealthboxIcon,
  WebflowIcon,
  WhatsAppIcon,
  WordpressIcon,
  xIcon,
  YouComIcon,
  YouTubeIcon,
  ZendeskIcon,
  ZepIcon,
  ZohoDeskIcon,
  ZoomIcon,
  ZoomInfoIcon,
} from '@/components/icons'
import { env } from '@/lib/core/config/env'
import { isSlackExtendedScopesEnabled } from '@/lib/core/config/env-flags'
import { redactExactSensitiveValues } from '@/lib/core/security/redaction'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { APOLLO_TOKEN_URL } from '@/lib/oauth/apollo'
import { getDocusignOAuthUrl } from '@/lib/oauth/docusign'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import {
  GITHUB_TOKEN_URL,
  parseGitHubRepositoriesTokenResponse,
} from '@/lib/oauth/github-repositories'
import {
  GREENHOUSE_TOKEN_URL,
  getGreenhouseRefreshErrorCode,
  parseGreenhouseTokens,
} from '@/lib/oauth/greenhouse'
import { parseInstagramLongLivedToken } from '@/lib/oauth/instagram'
import { MONDAY_OAUTH_TOKEN_URL, resolveMondayAccessTokenExpiresAt } from '@/lib/oauth/monday'
import type { QuickBooksOAuthClientConfig } from '@/lib/oauth/quickbooks-client-config'
import { QUICKBOOKS_TOKEN_URL } from '@/lib/oauth/quickbooks-constants'
import { isCredentialRevocationError } from '@/lib/oauth/refresh-error-codes'
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
export function getSlackApprovalGatedScopes(enabled: boolean): readonly string[] {
  return enabled ? ['assistant:write', 'app_mentions:read', 'im:history'] : []
}

const SLACK_APPROVAL_GATED_SCOPES = getSlackApprovalGatedScopes(isSlackExtendedScopesEnabled)

const JIRA_DEFAULT_TOOL_SCOPES = [
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
]

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  greenhouse: {
    name: 'Greenhouse',
    icon: GreenhouseIcon,
    services: {
      greenhouse: {
        name: 'Greenhouse',
        description: 'Manage recruiting candidates, applications, jobs, and hiring activity.',
        providerId: 'greenhouse',
        serviceAccountProviderId: 'greenhouse-service-account',
        icon: GreenhouseIcon,
        baseProviderIcon: GreenhouseIcon,
        scopes: [
          'harvest:application_stages:list',
          'harvest:applications:convert_to_candidate',
          'harvest:applications:create',
          'harvest:applications:destroy',
          'harvest:applications:hire',
          'harvest:applications:list',
          'harvest:applications:move',
          'harvest:applications:reject',
          'harvest:applications:unreject',
          'harvest:applications:update',
          'harvest:applied_candidate_tags:create',
          'harvest:applied_candidate_tags:destroy',
          'harvest:applied_candidate_tags:list',
          'harvest:attachments:create',
          'harvest:attachments:destroy',
          'harvest:attachments:list',
          'harvest:candidate_educations:list',
          'harvest:candidate_employments:list',
          'harvest:candidate_tags:create',
          'harvest:candidate_tags:list',
          'harvest:candidates:create',
          'harvest:candidates:destroy',
          'harvest:candidates:list',
          'harvest:candidates:update',
          'harvest:close_reasons:list',
          'harvest:custom_field_options:list',
          'harvest:custom_fields:list',
          'harvest:departments:list',
          'harvest:email_templates:list',
          'harvest:interviews:list',
          'harvest:job_hiring_managers:list',
          'harvest:job_interview_stages:list',
          'harvest:job_owners:list',
          'harvest:jobs:list',
          'harvest:notes:create',
          'harvest:notes:list',
          'harvest:offers:list',
          'harvest:offices:list',
          'harvest:openings:list',
          'harvest:prospect_pool_stages:list',
          'harvest:prospect_pools:list',
          'harvest:referrers:list',
          'harvest:rejection_reasons:list',
          'harvest:scorecards:list',
          'harvest:sources:list',
          'harvest:users:list',
        ],
      },
    },
    defaultService: 'greenhouse',
  },

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
        /**
         * A JSON-key service account the Google Ads account added as a user signs in as itself
         * (https://developers.google.com/google-ads/api/docs/oauth/service-accounts). Keyless
         * Google credentials stay refused here: Ads is not in `GOOGLE_KEYLESS_SERVICES`, since
         * Google documents no Workload Identity Federation path for it.
         */
        serviceAccountProviderId: 'google-service-account',
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
        description:
          'Access Google Cloud Vertex AI for Gemini models with OAuth or a Google service account.',
        providerId: 'vertex-ai',
        icon: VertexIcon,
        baseProviderIcon: VertexIcon,
        scopes: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/cloud-platform',
        ],
        serviceAccountProviderId: 'google-service-account',
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
        serviceAccountProviderId: 'microsoft-app-service-account',
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
      'azure-data-explorer': {
        name: 'Azure Data Explorer',
        description:
          'Query and manage Azure Data Explorer clusters as a Microsoft Entra app registration.',
        providerId: 'azure-data-explorer',
        icon: AzureDataExplorerIcon,
        baseProviderIcon: MicrosoftIcon,
        serviceAccountProviderId: 'microsoft-app-service-account',
        authType: 'service_account',
        scopes: [],
      },
      'microsoft-dataverse': {
        name: 'Microsoft Dataverse',
        description: 'Connect to Microsoft Dataverse and manage records.',
        providerId: 'microsoft-dataverse',
        icon: MicrosoftDataverseIcon,
        baseProviderIcon: MicrosoftIcon,
        serviceAccountProviderId: 'microsoft-app-service-account',
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
        scopes: [
          'openid',
          'profile',
          'email',
          'Files.Read',
          'Files.ReadWrite',
          'Sites.Read.All',
          'offline_access',
        ],
      },
      'microsoft-intune': {
        name: 'Microsoft Intune',
        description: 'Read managed devices and policies, and request remote device actions.',
        providerId: 'microsoft-intune',
        icon: IntuneIcon,
        baseProviderIcon: MicrosoftIcon,
        serviceAccountProviderId: 'microsoft-app-service-account',
        scopes: [
          'openid',
          'profile',
          'email',
          'DeviceManagementManagedDevices.Read.All',
          'DeviceManagementConfiguration.Read.All',
          'DeviceManagementManagedDevices.PrivilegedOperations.All',
          'offline_access',
        ],
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
      'microsoft-powerbi': {
        name: 'Power BI',
        description: 'Connect to Power BI and query semantic models, reports, and refresh history.',
        providerId: 'microsoft-powerbi',
        icon: PowerBIIcon,
        baseProviderIcon: MicrosoftIcon,
        serviceAccountProviderId: 'microsoft-app-service-account',
        scopes: [
          'https://analysis.windows.net/powerbi/api/Workspace.Read.All',
          'https://analysis.windows.net/powerbi/api/Report.Read.All',
          'https://analysis.windows.net/powerbi/api/Dataset.ReadWrite.All',
          'openid',
          'profile',
          'email',
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
        serviceAccountProviderId: 'microsoft-app-service-account',
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
        scopes: [...JIRA_DEFAULT_TOOL_SCOPES, 'write:sprint:jira-software'],
        defaultToolScopes: JIRA_DEFAULT_TOOL_SCOPES,
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
        serviceAccountProviderId: 'bitbucket-service-account',
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
  aws: {
    name: 'AWS',
    icon: IAMIcon,
    services: {
      aws: {
        name: 'AWS',
        description:
          'Use AWS services with saved access keys, an assumed IAM role, or a keyless role trusted through Sim OIDC.',
        providerId: 'aws',
        serviceAccountProviderId: 'aws-service-account',
        authType: 'service_account',
        icon: IAMIcon,
        baseProviderIcon: IAMIcon,
        scopes: [],
      },
    },
    defaultService: 'aws',
  },
  databricks: {
    name: 'Databricks',
    icon: DatabricksIcon,
    services: {
      databricks: {
        name: 'Databricks',
        description:
          'Use Databricks with a personal access token, a service principal secret, or a keyless service principal trusted through Sim OIDC.',
        providerId: 'databricks',
        serviceAccountProviderId: 'databricks-service-account',
        authType: 'service_account',
        icon: DatabricksIcon,
        baseProviderIcon: DatabricksIcon,
        scopes: [],
      },
    },
    defaultService: 'databricks',
  },
  oracledb: {
    name: 'Oracle Database',
    icon: OracleIcon,
    services: {
      oracledb: {
        name: 'Oracle Database',
        description: 'Query and manage Oracle Database with a saved connection.',
        providerId: 'oracledb',
        serviceAccountProviderId: 'oracledb-service-account',
        authType: 'service_account',
        icon: OracleIcon,
        baseProviderIcon: OracleIcon,
        scopes: [],
      },
    },
    defaultService: 'oracledb',
  },
  postgresql: {
    name: 'PostgreSQL',
    icon: PostgresIcon,
    services: {
      postgresql: {
        name: 'PostgreSQL',
        description: 'Query and manage PostgreSQL with a saved connection.',
        providerId: 'postgresql',
        serviceAccountProviderId: 'postgresql-service-account',
        authType: 'service_account',
        icon: PostgresIcon,
        baseProviderIcon: PostgresIcon,
        scopes: [],
      },
    },
    defaultService: 'postgresql',
  },
  mysql: {
    name: 'MySQL',
    icon: MySQLIcon,
    services: {
      mysql: {
        name: 'MySQL',
        description: 'Query and manage MySQL with a saved connection.',
        providerId: 'mysql',
        serviceAccountProviderId: 'mysql-service-account',
        authType: 'service_account',
        icon: MySQLIcon,
        baseProviderIcon: MySQLIcon,
        scopes: [],
      },
    },
    defaultService: 'mysql',
  },
  mssql: {
    name: 'Microsoft SQL Server',
    icon: MicrosoftSqlIcon,
    services: {
      mssql: {
        name: 'Microsoft SQL Server',
        description: 'Query and manage Microsoft SQL Server with a saved connection.',
        providerId: 'mssql',
        serviceAccountProviderId: 'mssql-service-account',
        authType: 'service_account',
        icon: MicrosoftSqlIcon,
        baseProviderIcon: MicrosoftSqlIcon,
        scopes: [],
      },
    },
    defaultService: 'mssql',
  },
  oci: {
    name: 'Oracle Cloud Infrastructure',
    icon: OracleIcon,
    services: {
      oci: {
        name: 'Oracle Cloud Infrastructure',
        description: 'Connect OCI services with an API signing key.',
        providerId: 'oci',
        serviceAccountProviderId: 'oci-api-key-service-account',
        icon: OracleIcon,
        baseProviderIcon: OracleIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'oci',
  },
  'oracle-epm': {
    name: 'Oracle EPM',
    icon: OracleIcon,
    services: {
      'oracle-epm': {
        name: 'Oracle EPM',
        description: 'Connect an EPM environment with an integration user.',
        providerId: 'oracle-epm',
        serviceAccountProviderId: 'oracle-epm-service-account',
        icon: OracleIcon,
        baseProviderIcon: OracleIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'oracle-epm',
  },
  'oracle-fusion': {
    name: 'Oracle Fusion',
    icon: OracleIcon,
    services: {
      'oracle-fusion': {
        name: 'Oracle Fusion',
        description: 'Connect Fusion Applications with an integration user.',
        providerId: 'oracle-fusion',
        serviceAccountProviderId: 'oracle-fusion-service-account',
        icon: OracleIcon,
        baseProviderIcon: OracleIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'oracle-fusion',
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
        serviceAccountProviderId: 'docusign-service-account',
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
  ramp: {
    name: 'Ramp',
    icon: RampIcon,
    services: {
      ramp: {
        name: 'Ramp',
        description:
          'Read company spending, cards, bills, and reimbursements, and manage transaction memos.',
        providerId: 'ramp',
        serviceAccountProviderId: 'ramp-service-account',
        authType: 'oauth',
        icon: RampIcon,
        baseProviderIcon: RampIcon,
        scopes: [
          'business:read',
          'users:read',
          'transactions:read',
          'cards:read',
          'vendors:read',
          'bills:read',
          'reimbursements:read',
          'memos:read',
          'memos:write',
        ],
      },
    },
    defaultService: 'ramp',
  },
  fivetran: {
    name: 'Fivetran',
    icon: FivetranIcon,
    services: {
      fivetran: {
        name: 'Fivetran',
        description: 'Manage Fivetran connections, syncs, and transformations.',
        providerId: 'fivetran',
        serviceAccountProviderId: 'fivetran-service-account',
        authType: 'service_account',
        icon: FivetranIcon,
        baseProviderIcon: FivetranIcon,
        scopes: [],
      },
    },
    defaultService: 'fivetran',
  },
  zoominfo: {
    name: 'ZoomInfo',
    icon: ZoomInfoIcon,
    services: {
      zoominfo: {
        name: 'ZoomInfo',
        description: 'Search and enrich B2B company and contact data with ZoomInfo.',
        providerId: 'zoominfo',
        serviceAccountProviderId: 'zoominfo-service-account',
        authType: 'service_account',
        icon: ZoomInfoIcon,
        baseProviderIcon: ZoomInfoIcon,
        scopes: [],
      },
    },
    defaultService: 'zoominfo',
  },
  sailpoint: {
    name: 'SailPoint',
    icon: SailPointIcon,
    services: {
      sailpoint: {
        name: 'SailPoint',
        description: 'Govern identities and access in SailPoint Identity Security Cloud.',
        providerId: 'sailpoint',
        serviceAccountProviderId: 'sailpoint-service-account',
        authType: 'service_account',
        icon: SailPointIcon,
        baseProviderIcon: SailPointIcon,
        scopes: [],
      },
    },
    defaultService: 'sailpoint',
  },
  datadog: {
    name: 'Datadog',
    icon: DatadogIcon,
    services: {
      datadog: {
        name: 'Datadog',
        description: 'Monitor infrastructure, applications, and logs with Datadog.',
        providerId: 'datadog',
        serviceAccountProviderId: 'datadog-service-account',
        authType: 'service_account',
        icon: DatadogIcon,
        baseProviderIcon: DatadogIcon,
        scopes: [],
      },
    },
    defaultService: 'datadog',
  },
  crowdstrike: {
    name: 'CrowdStrike',
    icon: CrowdStrikeIcon,
    services: {
      crowdstrike: {
        name: 'CrowdStrike',
        description:
          'Investigate and respond to CrowdStrike Falcon alerts, hosts, IOCs, and vulnerabilities.',
        providerId: 'crowdstrike',
        serviceAccountProviderId: 'crowdstrike-service-account',
        authType: 'service_account',
        icon: CrowdStrikeIcon,
        baseProviderIcon: CrowdStrikeIcon,
        scopes: [],
      },
    },
    defaultService: 'crowdstrike',
  },
  vanta: {
    name: 'Vanta',
    icon: VantaIcon,
    services: {
      vanta: {
        name: 'Vanta',
        description: 'Read compliance data and manage evidence in Vanta.',
        providerId: 'vanta',
        serviceAccountProviderId: 'vanta-service-account',
        authType: 'service_account',
        icon: VantaIcon,
        baseProviderIcon: VantaIcon,
        scopes: [],
      },
    },
    defaultService: 'vanta',
  },
  helpscout: {
    name: 'Help Scout',
    icon: HelpScoutIcon,
    services: {
      helpscout: {
        name: 'Help Scout',
        description: 'Manage Help Scout conversations, replies, notes, and customers.',
        providerId: 'helpscout',
        serviceAccountProviderId: 'helpscout-service-account',
        authType: 'oauth',
        icon: HelpScoutIcon,
        baseProviderIcon: HelpScoutIcon,
        scopes: [],
      },
    },
    defaultService: 'helpscout',
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
  jama: {
    name: 'Jama Connect',
    icon: JamaIcon,
    services: {
      jama: {
        name: 'Jama Connect',
        description: 'Connect your Jama Connect account.',
        providerId: 'jama',
        serviceAccountProviderId: 'jama-service-account',
        icon: JamaIcon,
        baseProviderIcon: JamaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'jama',
  },
  flow: {
    name: 'Flow Engineering',
    icon: FlowIcon,
    services: {
      flow: {
        name: 'Flow Engineering',
        description: 'Connect your Flow Engineering account.',
        providerId: 'flow',
        serviceAccountProviderId: 'flow-service-account',
        icon: FlowIcon,
        baseProviderIcon: FlowIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'flow',
  },
  coda: {
    name: 'Coda',
    icon: CodaIcon,
    services: {
      coda: {
        name: 'Coda',
        description: 'Read and write Coda docs, pages, and tables.',
        providerId: 'coda',
        serviceAccountProviderId: 'coda-service-account',
        icon: CodaIcon,
        baseProviderIcon: CodaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'coda',
  },
  gauge: {
    name: 'Gauge',
    icon: GaugeIcon,
    services: {
      gauge: {
        name: 'Gauge',
        description: 'Track AI visibility and manage Gauge prompts, topics, and tags.',
        providerId: 'gauge',
        serviceAccountProviderId: 'gauge-service-account',
        icon: GaugeIcon,
        baseProviderIcon: GaugeIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'gauge',
  },
  amplitude: {
    name: 'Amplitude',
    icon: AmplitudeIcon,
    services: {
      amplitude: {
        name: 'Amplitude',
        description: 'Track events, identify users, and query analytics in Amplitude.',
        providerId: 'amplitude',
        serviceAccountProviderId: 'amplitude-service-account',
        icon: AmplitudeIcon,
        baseProviderIcon: AmplitudeIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'amplitude',
  },
  kalshi: {
    name: 'Kalshi',
    icon: KalshiIcon,
    services: {
      kalshi: {
        name: 'Kalshi',
        description: 'Read markets and trade on Kalshi with an account API key.',
        providerId: 'kalshi',
        serviceAccountProviderId: 'kalshi-service-account',
        icon: KalshiIcon,
        baseProviderIcon: KalshiIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'kalshi',
  },
  splunk: {
    name: 'Splunk',
    icon: SplunkIcon,
    services: {
      splunk: {
        name: 'Splunk',
        description: 'Run searches and read saved searches, alerts, indexes, and apps in Splunk.',
        providerId: 'splunk',
        serviceAccountProviderId: 'splunk-service-account',
        icon: SplunkIcon,
        baseProviderIcon: SplunkIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'splunk',
  },
  qdrant: {
    name: 'Qdrant',
    icon: QdrantIcon,
    services: {
      qdrant: {
        name: 'Qdrant',
        description: 'Upsert, search, and fetch points in a Qdrant vector database.',
        providerId: 'qdrant',
        serviceAccountProviderId: 'qdrant-service-account',
        icon: QdrantIcon,
        baseProviderIcon: QdrantIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'qdrant',
  },
  railway: {
    name: 'Railway',
    icon: RailwayIcon,
    services: {
      railway: {
        name: 'Railway',
        description: 'Manage Railway projects, services, environments, deployments, and variables.',
        providerId: 'railway',
        serviceAccountProviderId: 'railway-service-account',
        icon: RailwayIcon,
        baseProviderIcon: RailwayIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'railway',
  },
  cbinsights: {
    name: 'CB Insights',
    icon: CbInsightsIcon,
    services: {
      cbinsights: {
        name: 'CB Insights',
        description:
          'Look up companies, funding, investments, and market intelligence in CB Insights.',
        providerId: 'cbinsights',
        serviceAccountProviderId: 'cbinsights-service-account',
        icon: CbInsightsIcon,
        baseProviderIcon: CbInsightsIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'cbinsights',
  },
  tavily: {
    name: 'Tavily',
    icon: TavilyIcon,
    services: {
      tavily: {
        name: 'Tavily',
        description: 'Search, extract, crawl, and map the web with Tavily.',
        providerId: 'tavily',
        serviceAccountProviderId: 'tavily-service-account',
        icon: TavilyIcon,
        baseProviderIcon: TavilyIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'tavily',
  },
  affinity: {
    name: 'Affinity',
    icon: AffinityIcon,
    services: {
      affinity: {
        name: 'Affinity',
        description:
          'Read and write companies, people, lists, notes, and relationships in Affinity.',
        providerId: 'affinity',
        serviceAccountProviderId: 'affinity-service-account',
        icon: AffinityIcon,
        baseProviderIcon: AffinityIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'affinity',
  },
  agentmail: {
    name: 'AgentMail',
    icon: AgentMailIcon,
    services: {
      agentmail: {
        name: 'AgentMail',
        description: 'Manage email inboxes, threads, messages, and drafts with AgentMail.',
        providerId: 'agentmail',
        serviceAccountProviderId: 'agentmail-service-account',
        icon: AgentMailIcon,
        baseProviderIcon: AgentMailIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'agentmail',
  },
  agentphone: {
    name: 'AgentPhone',
    icon: AgentPhoneIcon,
    services: {
      agentphone: {
        name: 'AgentPhone',
        description:
          'Provision numbers, send SMS and iMessage, and place voice calls with AgentPhone.',
        providerId: 'agentphone',
        serviceAccountProviderId: 'agentphone-service-account',
        icon: AgentPhoneIcon,
        baseProviderIcon: AgentPhoneIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'agentphone',
  },
  ahrefs: {
    name: 'Ahrefs',
    icon: AhrefsIcon,
    services: {
      ahrefs: {
        name: 'Ahrefs',
        description: 'Analyze domains, backlinks, keywords, and rank tracking data with Ahrefs.',
        providerId: 'ahrefs',
        serviceAccountProviderId: 'ahrefs-service-account',
        icon: AhrefsIcon,
        baseProviderIcon: AhrefsIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'ahrefs',
  },
  apify: {
    name: 'Apify',
    icon: ApifyIcon,
    services: {
      apify: {
        name: 'Apify',
        description: 'Run Apify actors and tasks and retrieve their results.',
        providerId: 'apify',
        serviceAccountProviderId: 'apify-service-account',
        icon: ApifyIcon,
        baseProviderIcon: ApifyIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'apify',
  },
  apollo: {
    name: 'Apollo',
    icon: ApolloIcon,
    services: {
      apollo: {
        name: 'Apollo',
        description: 'Search, enrich, and manage contacts, accounts, and deals in Apollo.io.',
        providerId: 'apollo',
        serviceAccountProviderId: 'apollo-service-account',
        icon: ApolloIcon,
        baseProviderIcon: ApolloIcon,
        scopes: [
          'read_user_profile',
          'mixed_people_api_search',
          'people_match',
          'people_bulk_match',
          'mixed_companies_search',
          'organizations_enrich',
          'organizations_bulk_enrich',
          'contact_write',
          'contact_update',
          'contacts_search',
          'contacts_bulk_create',
          'contacts_bulk_update',
          'account_write',
          'account_update',
          'accounts_search',
          'account_bulk_create',
          'account_stages_update',
          'opportunity_write',
          'opportunities_list',
          'opportunity_read',
          'opportunity_update',
          'emailer_campaigns_search',
          'emailer_campaigns_add_contact_ids',
          'tasks_create',
          'tasks_list',
          'email_accounts_list',
        ],
      },
    },
    defaultService: 'apollo',
  },
  brex: {
    name: 'Brex',
    icon: BrexIcon,
    services: {
      brex: {
        name: 'Brex',
        description: 'Manage expenses, receipts, transactions, and team data in Brex.',
        providerId: 'brex',
        serviceAccountProviderId: 'brex-service-account',
        icon: BrexIcon,
        baseProviderIcon: BrexIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'brex',
  },
  brightdata: {
    name: 'Bright Data',
    icon: BrightDataIcon,
    services: {
      brightdata: {
        name: 'Bright Data',
        description: 'Scrape websites, search engines, and structured datasets with Bright Data.',
        providerId: 'brightdata',
        serviceAccountProviderId: 'brightdata-service-account',
        icon: BrightDataIcon,
        baseProviderIcon: BrightDataIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'brightdata',
  },
  browser_use: {
    name: 'Browser Use',
    icon: BrowserUseIcon,
    services: {
      browser_use: {
        name: 'Browser Use',
        description: 'Run browser automation tasks with Browser Use.',
        providerId: 'browser_use',
        serviceAccountProviderId: 'browser-use-service-account',
        icon: BrowserUseIcon,
        baseProviderIcon: BrowserUseIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'browser_use',
  },
  buffer: {
    name: 'Buffer',
    icon: BufferIcon,
    services: {
      buffer: {
        name: 'Buffer',
        description: 'Schedule and publish social media posts across your Buffer channels.',
        providerId: 'buffer',
        serviceAccountProviderId: 'buffer-service-account',
        icon: BufferIcon,
        baseProviderIcon: BufferIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'buffer',
  },
  circleback: {
    name: 'Circleback',
    icon: CirclebackIcon,
    services: {
      circleback: {
        name: 'Circleback',
        description: 'Read Circleback meetings, notes, transcripts, and action items.',
        providerId: 'circleback',
        serviceAccountProviderId: 'circleback-service-account',
        icon: CirclebackIcon,
        baseProviderIcon: CirclebackIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'circleback',
  },
  clerk: {
    name: 'Clerk',
    icon: ClerkIcon,
    services: {
      clerk: {
        name: 'Clerk',
        description: 'Manage Clerk users, organizations, and sessions.',
        providerId: 'clerk',
        serviceAccountProviderId: 'clerk-service-account',
        icon: ClerkIcon,
        baseProviderIcon: ClerkIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'clerk',
  },
  cloudflare: {
    name: 'Cloudflare',
    icon: CloudflareIcon,
    services: {
      cloudflare: {
        name: 'Cloudflare',
        description: 'Manage Cloudflare DNS, zones, Zero Trust access, and edge infrastructure.',
        providerId: 'cloudflare',
        serviceAccountProviderId: 'cloudflare-service-account',
        icon: CloudflareIcon,
        baseProviderIcon: CloudflareIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'cloudflare',
  },
  crunchbase: {
    name: 'Crunchbase',
    icon: CrunchbaseIcon,
    services: {
      crunchbase: {
        name: 'Crunchbase',
        description:
          'Search organizations, people, funding rounds, and acquisitions in Crunchbase.',
        providerId: 'crunchbase',
        serviceAccountProviderId: 'crunchbase-service-account',
        icon: CrunchbaseIcon,
        baseProviderIcon: CrunchbaseIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'crunchbase',
  },
  daytona: {
    name: 'Daytona',
    icon: DaytonaIcon,
    services: {
      daytona: {
        name: 'Daytona',
        description: 'Create and manage Daytona sandboxes and run code in them.',
        providerId: 'daytona',
        serviceAccountProviderId: 'daytona-service-account',
        icon: DaytonaIcon,
        baseProviderIcon: DaytonaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'daytona',
  },
  elevenlabs: {
    name: 'ElevenLabs',
    icon: ElevenLabsIcon,
    services: {
      elevenlabs: {
        name: 'ElevenLabs',
        description: 'Generate speech and sound effects and manage voices in ElevenLabs.',
        providerId: 'elevenlabs',
        serviceAccountProviderId: 'elevenlabs-service-account',
        icon: ElevenLabsIcon,
        baseProviderIcon: ElevenLabsIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'elevenlabs',
  },
  enrich: {
    name: 'Enrich',
    icon: EnrichSoIcon,
    services: {
      enrich: {
        name: 'Enrich',
        description: 'Look up people, companies, emails, and LinkedIn activity with Enrich.',
        providerId: 'enrich',
        serviceAccountProviderId: 'enrich-service-account',
        icon: EnrichSoIcon,
        baseProviderIcon: EnrichSoIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'enrich',
  },
  gamma: {
    name: 'Gamma',
    icon: GammaIcon,
    services: {
      gamma: {
        name: 'Gamma',
        description: 'Generate presentations, documents, and webpages with Gamma.',
        providerId: 'gamma',
        serviceAccountProviderId: 'gamma-service-account',
        icon: GammaIcon,
        baseProviderIcon: GammaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'gamma',
  },
  hex: {
    name: 'Hex',
    icon: HexIcon,
    services: {
      hex: {
        name: 'Hex',
        description: 'Run projects and manage collections, groups, and users in Hex.',
        providerId: 'hex',
        serviceAccountProviderId: 'hex-service-account',
        icon: HexIcon,
        baseProviderIcon: HexIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'hex',
  },
  huggingface: {
    name: 'Hugging Face',
    icon: HuggingFaceIcon,
    services: {
      huggingface: {
        name: 'Hugging Face',
        description: 'Generate chat completions with the Hugging Face Inference API.',
        providerId: 'huggingface',
        serviceAccountProviderId: 'huggingface-service-account',
        icon: HuggingFaceIcon,
        baseProviderIcon: HuggingFaceIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'huggingface',
  },
  incidentio: {
    name: 'incident.io',
    icon: IncidentioIcon,
    services: {
      incidentio: {
        name: 'incident.io',
        description: 'Manage incidents, alerts, schedules, and workflows in incident.io.',
        providerId: 'incidentio',
        serviceAccountProviderId: 'incidentio-service-account',
        icon: IncidentioIcon,
        baseProviderIcon: IncidentioIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'incidentio',
  },
  instantly: {
    name: 'Instantly',
    icon: InstantlyIcon,
    services: {
      instantly: {
        name: 'Instantly',
        description: 'Manage leads, campaigns, emails, and lead lists in Instantly.',
        providerId: 'instantly',
        serviceAccountProviderId: 'instantly-service-account',
        icon: InstantlyIcon,
        baseProviderIcon: InstantlyIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'instantly',
  },
  langsmith: {
    name: 'LangSmith',
    icon: LangsmithIcon,
    services: {
      langsmith: {
        name: 'LangSmith',
        description: 'Send and read runs and feedback in LangSmith.',
        providerId: 'langsmith',
        serviceAccountProviderId: 'langsmith-service-account',
        icon: LangsmithIcon,
        baseProviderIcon: LangsmithIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'langsmith',
  },
  launchdarkly: {
    name: 'LaunchDarkly',
    icon: LaunchDarklyIcon,
    services: {
      launchdarkly: {
        name: 'LaunchDarkly',
        description:
          'Manage feature flags and read projects, environments, and audit logs in LaunchDarkly.',
        providerId: 'launchdarkly',
        serviceAccountProviderId: 'launchdarkly-service-account',
        icon: LaunchDarklyIcon,
        baseProviderIcon: LaunchDarklyIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'launchdarkly',
  },
  linq: {
    name: 'Linq',
    icon: LinqIcon,
    services: {
      linq: {
        name: 'Linq',
        description: 'Send iMessage, SMS, and RCS messages and manage conversations with Linq.',
        providerId: 'linq',
        serviceAccountProviderId: 'linq-service-account',
        icon: LinqIcon,
        baseProviderIcon: LinqIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'linq',
  },
  loops: {
    name: 'Loops',
    icon: LoopsIcon,
    services: {
      loops: {
        name: 'Loops',
        description: 'Manage contacts and send transactional emails and events with Loops.',
        providerId: 'loops',
        serviceAccountProviderId: 'loops-service-account',
        icon: LoopsIcon,
        baseProviderIcon: LoopsIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'loops',
  },
  luma: {
    name: 'Luma',
    icon: LumaIcon,
    services: {
      luma: {
        name: 'Luma',
        description: 'Manage events and guests on Luma.',
        providerId: 'luma',
        serviceAccountProviderId: 'luma-service-account',
        icon: LumaIcon,
        baseProviderIcon: LumaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'luma',
  },
  mailchimp: {
    name: 'Mailchimp',
    icon: MailchimpIcon,
    services: {
      mailchimp: {
        name: 'Mailchimp',
        description: 'Manage audiences, campaigns, and automations in Mailchimp.',
        providerId: 'mailchimp',
        serviceAccountProviderId: 'mailchimp-service-account',
        icon: MailchimpIcon,
        baseProviderIcon: MailchimpIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'mailchimp',
  },
  otter: {
    name: 'Otter.ai',
    icon: OtterIcon,
    services: {
      otter: {
        name: 'Otter.ai',
        description: 'Read Otter.ai meeting conversations, transcripts, and summaries.',
        providerId: 'otter',
        serviceAccountProviderId: 'otter-service-account',
        icon: OtterIcon,
        baseProviderIcon: OtterIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'otter',
  },
  persona: {
    name: 'Persona',
    icon: PersonaIcon,
    services: {
      persona: {
        name: 'Persona',
        description: 'Run identity verification inquiries, reports, and accounts in Persona.',
        providerId: 'persona',
        serviceAccountProviderId: 'persona-service-account',
        icon: PersonaIcon,
        baseProviderIcon: PersonaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'persona',
  },
  profound: {
    name: 'Profound',
    icon: ProfoundIcon,
    services: {
      profound: {
        name: 'Profound',
        description:
          'Track brand visibility, citations, and bot traffic across AI platforms with Profound.',
        providerId: 'profound',
        serviceAccountProviderId: 'profound-service-account',
        icon: ProfoundIcon,
        baseProviderIcon: ProfoundIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'profound',
  },
  quartr: {
    name: 'Quartr',
    icon: QuartrIcon,
    services: {
      quartr: {
        name: 'Quartr',
        description: 'Access earnings calls, transcripts, filings, and slide decks in Quartr.',
        providerId: 'quartr',
        serviceAccountProviderId: 'quartr-service-account',
        icon: QuartrIcon,
        baseProviderIcon: QuartrIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'quartr',
  },
  rb2b: {
    name: 'RB2B',
    icon: RB2BIcon,
    services: {
      rb2b: {
        name: 'RB2B',
        description: 'Identify and enrich website visitors with RB2B.',
        providerId: 'rb2b',
        serviceAccountProviderId: 'rb2b-service-account',
        icon: RB2BIcon,
        baseProviderIcon: RB2BIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'rb2b',
  },
  rippling: {
    name: 'Rippling',
    icon: RipplingIcon,
    services: {
      rippling: {
        name: 'Rippling',
        description: 'Manage workers, departments, custom objects, and company data in Rippling.',
        providerId: 'rippling',
        serviceAccountProviderId: 'rippling-service-account',
        icon: RipplingIcon,
        baseProviderIcon: RipplingIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'rippling',
  },
  rocketlane: {
    name: 'Rocketlane',
    icon: RocketlaneIcon,
    services: {
      rocketlane: {
        name: 'Rocketlane',
        description: 'Manage Rocketlane projects, tasks, time tracking, and invoices.',
        providerId: 'rocketlane',
        serviceAccountProviderId: 'rocketlane-service-account',
        icon: RocketlaneIcon,
        baseProviderIcon: RocketlaneIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'rocketlane',
  },
  sendgrid: {
    name: 'SendGrid',
    icon: SendgridIcon,
    services: {
      sendgrid: {
        name: 'SendGrid',
        description: 'Send email and manage contacts, lists, and templates with SendGrid.',
        providerId: 'sendgrid',
        serviceAccountProviderId: 'sendgrid-service-account',
        icon: SendgridIcon,
        baseProviderIcon: SendgridIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'sendgrid',
  },
  similarweb: {
    name: 'Similarweb',
    icon: SimilarwebIcon,
    services: {
      similarweb: {
        name: 'Similarweb',
        description: 'Get website traffic, engagement, and ranking estimates from Similarweb.',
        providerId: 'similarweb',
        serviceAccountProviderId: 'similarweb-service-account',
        icon: SimilarwebIcon,
        baseProviderIcon: SimilarwebIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'similarweb',
  },
  sixtyfour: {
    name: 'Sixtyfour',
    icon: SixtyfourIcon,
    services: {
      sixtyfour: {
        name: 'Sixtyfour',
        description:
          'Find emails and phone numbers and enrich people and companies with Sixtyfour.',
        providerId: 'sixtyfour',
        serviceAccountProviderId: 'sixtyfour-service-account',
        icon: SixtyfourIcon,
        baseProviderIcon: SixtyfourIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'sixtyfour',
  },
  smartlead: {
    name: 'Smartlead',
    icon: SmartleadIcon,
    services: {
      smartlead: {
        name: 'Smartlead',
        description: 'Manage campaigns, sequences, leads, and analytics in Smartlead.',
        providerId: 'smartlead',
        serviceAccountProviderId: 'smartlead-service-account',
        icon: SmartleadIcon,
        baseProviderIcon: SmartleadIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'smartlead',
  },
  sportmonks: {
    name: 'Sportmonks',
    icon: SportmonksIcon,
    services: {
      sportmonks: {
        name: 'Sportmonks',
        description: 'Query football, motorsport, odds, and core sports data from Sportmonks.',
        providerId: 'sportmonks',
        serviceAccountProviderId: 'sportmonks-service-account',
        icon: SportmonksIcon,
        baseProviderIcon: SportmonksIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'sportmonks',
  },
  square: {
    name: 'Square',
    icon: SquareIcon,
    services: {
      square: {
        name: 'Square',
        description: 'Take payments and manage customers, catalog, orders, and invoices in Square.',
        providerId: 'square',
        serviceAccountProviderId: 'square-service-account',
        icon: SquareIcon,
        baseProviderIcon: SquareIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'square',
  },
  tailscale: {
    name: 'Tailscale',
    icon: TailscaleIcon,
    services: {
      tailscale: {
        name: 'Tailscale',
        description:
          'Manage devices, users, keys, DNS, and policy files in your Tailscale tailnet.',
        providerId: 'tailscale',
        serviceAccountProviderId: 'tailscale-service-account',
        icon: TailscaleIcon,
        baseProviderIcon: TailscaleIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'tailscale',
  },
  trigger_dev: {
    name: 'Trigger.dev',
    icon: TriggerDevIcon,
    services: {
      trigger_dev: {
        name: 'Trigger.dev',
        description:
          'Trigger tasks and manage runs, schedules, queues, and environment variables in Trigger.dev.',
        providerId: 'trigger_dev',
        serviceAccountProviderId: 'trigger-dev-service-account',
        icon: TriggerDevIcon,
        baseProviderIcon: TriggerDevIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'trigger_dev',
  },
  uptimerobot: {
    name: 'UptimeRobot',
    icon: UptimeRobotIcon,
    services: {
      uptimerobot: {
        name: 'UptimeRobot',
        description:
          'Manage monitors, incidents, maintenance windows, alert contacts, and status pages in UptimeRobot.',
        providerId: 'uptimerobot',
        serviceAccountProviderId: 'uptimerobot-service-account',
        icon: UptimeRobotIcon,
        baseProviderIcon: UptimeRobotIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'uptimerobot',
  },
  youcom: {
    name: 'You.com',
    icon: YouComIcon,
    services: {
      youcom: {
        name: 'You.com',
        description: 'Search the web and news, fetch page contents, and run research with You.com.',
        providerId: 'youcom',
        serviceAccountProviderId: 'youcom-service-account',
        icon: YouComIcon,
        baseProviderIcon: YouComIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'youcom',
  },
  youtube: {
    name: 'YouTube',
    icon: YouTubeIcon,
    services: {
      youtube: {
        name: 'YouTube',
        description:
          'Search videos and read video, channel, playlist, and comment data from YouTube.',
        providerId: 'youtube',
        serviceAccountProviderId: 'youtube-service-account',
        icon: YouTubeIcon,
        baseProviderIcon: YouTubeIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'youtube',
  },
  mem0: {
    name: 'Mem0',
    icon: Mem0Icon,
    services: {
      mem0: {
        name: 'Mem0',
        description: 'Add, search, and retrieve memories with Mem0.',
        providerId: 'mem0',
        serviceAccountProviderId: 'mem0-service-account',
        icon: Mem0Icon,
        baseProviderIcon: Mem0Icon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'mem0',
  },
  zep: {
    name: 'Zep',
    icon: ZepIcon,
    services: {
      zep: {
        name: 'Zep',
        description: 'Manage long-term memory threads, messages, and users in Zep.',
        providerId: 'zep',
        serviceAccountProviderId: 'zep-service-account',
        icon: ZepIcon,
        baseProviderIcon: ZepIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'zep',
  },
  zendesk: {
    name: 'Zendesk',
    icon: ZendeskIcon,
    services: {
      zendesk: {
        name: 'Zendesk',
        description: 'Manage tickets, users, and organizations in Zendesk Support.',
        providerId: 'zendesk',
        serviceAccountProviderId: 'zendesk-service-account',
        icon: ZendeskIcon,
        baseProviderIcon: ZendeskIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'zendesk',
  },
  discord: {
    name: 'Discord',
    icon: DiscordIcon,
    services: {
      discord: {
        name: 'Discord',
        description:
          'Manage Discord messages, threads, channels, roles, members, and invites as a bot.',
        providerId: 'discord',
        serviceAccountProviderId: 'discord-service-account',
        icon: DiscordIcon,
        baseProviderIcon: DiscordIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'discord',
  },
  cursor: {
    name: 'Cursor',
    icon: CursorIcon,
    services: {
      cursor: {
        name: 'Cursor',
        description: 'Launch and manage Cursor cloud agents that work on your GitHub repositories.',
        providerId: 'cursor',
        serviceAccountProviderId: 'cursor-service-account',
        icon: CursorIcon,
        baseProviderIcon: CursorIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'cursor',
  },
  dub: {
    name: 'Dub',
    icon: DubIcon,
    services: {
      dub: {
        name: 'Dub',
        description:
          'Create and manage Dub short links, tags, and folders, and read link analytics.',
        providerId: 'dub',
        serviceAccountProviderId: 'dub-service-account',
        icon: DubIcon,
        baseProviderIcon: DubIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'dub',
  },
  extend: {
    name: 'Extend',
    icon: ExtendIcon,
    services: {
      extend: {
        name: 'Extend',
        description: 'Parse documents into structured text and layout with Extend.',
        providerId: 'extend',
        serviceAccountProviderId: 'extend-service-account',
        icon: ExtendIcon,
        baseProviderIcon: ExtendIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'extend',
  },
  fireflies: {
    name: 'Fireflies',
    icon: FirefliesIcon,
    services: {
      fireflies: {
        name: 'Fireflies',
        description:
          'List, search, and manage Fireflies meeting transcripts, soundbites, and users.',
        providerId: 'fireflies',
        serviceAccountProviderId: 'fireflies-service-account',
        icon: FirefliesIcon,
        baseProviderIcon: FirefliesIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'fireflies',
  },
  intercom: {
    name: 'Intercom',
    icon: IntercomIcon,
    services: {
      intercom: {
        name: 'Intercom',
        description:
          'Manage contacts, companies, conversations, tickets, and messages in Intercom.',
        providerId: 'intercom',
        serviceAccountProviderId: 'intercom-service-account',
        icon: IntercomIcon,
        baseProviderIcon: IntercomIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'intercom',
  },
  pulse: {
    name: 'Pulse',
    icon: PulseIcon,
    services: {
      pulse: {
        name: 'Pulse',
        description: 'Extract text from PDFs, images, and Office files with Pulse.',
        providerId: 'pulse',
        serviceAccountProviderId: 'pulse-service-account',
        icon: PulseIcon,
        baseProviderIcon: PulseIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'pulse',
  },
  quiver: {
    name: 'Quiver',
    icon: QuiverIcon,
    services: {
      quiver: {
        name: 'Quiver',
        description: 'Generate SVGs from text prompts and vectorize images with QuiverAI.',
        providerId: 'quiver',
        serviceAccountProviderId: 'quiver-service-account',
        icon: QuiverIcon,
        baseProviderIcon: QuiverIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'quiver',
  },
  reducto: {
    name: 'Reducto',
    icon: ReductoIcon,
    services: {
      reducto: {
        name: 'Reducto',
        description: 'Extract text from PDF documents with Reducto.',
        providerId: 'reducto',
        serviceAccountProviderId: 'reducto-service-account',
        icon: ReductoIcon,
        baseProviderIcon: ReductoIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'reducto',
  },
  flint: {
    name: 'Flint',
    icon: FlintIcon,
    services: {
      flint: {
        name: 'Flint',
        description: 'Run background agent tasks that update your Flint sites.',
        providerId: 'flint',
        serviceAccountProviderId: 'flint-service-account',
        icon: FlintIcon,
        baseProviderIcon: FlintIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'flint',
  },
  ashby: {
    name: 'Ashby',
    icon: AshbyIcon,
    services: {
      ashby: {
        name: 'Ashby',
        description: 'Manage candidates, jobs, applications, and offers in Ashby.',
        providerId: 'ashby',
        serviceAccountProviderId: 'ashby-service-account',
        icon: AshbyIcon,
        baseProviderIcon: AshbyIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'ashby',
  },
  calendly: {
    name: 'Calendly',
    icon: CalendlyIcon,
    services: {
      calendly: {
        name: 'Calendly',
        description: 'Manage Calendly event types, scheduled events, and invitees.',
        providerId: 'calendly',
        serviceAccountProviderId: 'calendly-service-account',
        icon: CalendlyIcon,
        baseProviderIcon: CalendlyIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'calendly',
  },
  checkr: {
    name: 'Checkr',
    icon: CheckrIcon,
    services: {
      checkr: {
        name: 'Checkr',
        description: 'Run and manage background checks with Checkr.',
        providerId: 'checkr',
        serviceAccountProviderId: 'checkr-service-account',
        icon: CheckrIcon,
        baseProviderIcon: CheckrIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'checkr',
  },
  fathom: {
    name: 'Fathom',
    icon: FathomIcon,
    services: {
      fathom: {
        name: 'Fathom',
        description: 'Read meeting recordings, transcripts, summaries, and teams in Fathom.',
        providerId: 'fathom',
        serviceAccountProviderId: 'fathom-service-account',
        icon: FathomIcon,
        baseProviderIcon: FathomIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'fathom',
  },
  grain: {
    name: 'Grain',
    icon: GrainIcon,
    services: {
      grain: {
        name: 'Grain',
        description: 'Read meeting recordings, transcripts, teams, and webhooks in Grain.',
        providerId: 'grain',
        serviceAccountProviderId: 'grain-service-account',
        icon: GrainIcon,
        baseProviderIcon: GrainIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'grain',
  },
  granola: {
    name: 'Granola',
    icon: GranolaIcon,
    services: {
      granola: {
        name: 'Granola',
        description:
          'Read meeting notes, transcripts, folders, and audit events, and manage webhook endpoints in Granola.',
        providerId: 'granola',
        serviceAccountProviderId: 'granola-service-account',
        icon: GranolaIcon,
        baseProviderIcon: GranolaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'granola',
  },
  lemlist: {
    name: 'Lemlist',
    icon: LemlistIcon,
    services: {
      lemlist: {
        name: 'Lemlist',
        description: 'Read campaign activities and leads, and send emails from the Lemlist inbox.',
        providerId: 'lemlist',
        serviceAccountProviderId: 'lemlist-service-account',
        icon: LemlistIcon,
        baseProviderIcon: LemlistIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'lemlist',
  },
  pagerduty: {
    name: 'PagerDuty',
    icon: PagerDutyIcon,
    services: {
      pagerduty: {
        name: 'PagerDuty',
        description: 'Manage incidents, services, and on-call schedules in PagerDuty.',
        providerId: 'pagerduty',
        serviceAccountProviderId: 'pagerduty-service-account',
        icon: PagerDutyIcon,
        baseProviderIcon: PagerDutyIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'pagerduty',
  },
  resend: {
    name: 'Resend',
    icon: ResendIcon,
    services: {
      resend: {
        name: 'Resend',
        description:
          'Send emails and manage contacts, audiences, broadcasts, and domains in Resend.',
        providerId: 'resend',
        serviceAccountProviderId: 'resend-service-account',
        icon: ResendIcon,
        baseProviderIcon: ResendIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'resend',
  },
  rootly: {
    name: 'Rootly',
    icon: RootlyIcon,
    services: {
      rootly: {
        name: 'Rootly',
        description: 'Manage incidents, alerts, on-call, and retrospectives in Rootly.',
        providerId: 'rootly',
        serviceAccountProviderId: 'rootly-service-account',
        icon: RootlyIcon,
        baseProviderIcon: RootlyIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'rootly',
  },
  sentry: {
    name: 'Sentry',
    icon: SentryIcon,
    services: {
      sentry: {
        name: 'Sentry',
        description: 'Manage Sentry issues, events, projects, releases, and teams.',
        providerId: 'sentry',
        serviceAccountProviderId: 'sentry-service-account',
        icon: SentryIcon,
        baseProviderIcon: SentryIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'sentry',
  },
  stripe: {
    name: 'Stripe',
    icon: StripeIcon,
    services: {
      stripe: {
        name: 'Stripe',
        description: 'Manage payments, customers, subscriptions, invoices, and products in Stripe.',
        providerId: 'stripe',
        serviceAccountProviderId: 'stripe-service-account',
        icon: StripeIcon,
        baseProviderIcon: StripeIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'stripe',
  },
  telegram: {
    name: 'Telegram',
    icon: TelegramIcon,
    services: {
      telegram: {
        name: 'Telegram',
        description: 'Send and manage messages, media, and polls as your Telegram bot.',
        providerId: 'telegram',
        serviceAccountProviderId: 'telegram-service-account',
        icon: TelegramIcon,
        baseProviderIcon: TelegramIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'telegram',
  },
  typeform: {
    name: 'Typeform',
    icon: TypeformIcon,
    services: {
      typeform: {
        name: 'Typeform',
        description: 'Read responses and insights, download files, and manage forms in Typeform.',
        providerId: 'typeform',
        serviceAccountProviderId: 'typeform-service-account',
        icon: TypeformIcon,
        baseProviderIcon: TypeformIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'typeform',
  },
  vercel: {
    name: 'Vercel',
    icon: VercelIcon,
    services: {
      vercel: {
        name: 'Vercel',
        description:
          'Manage Vercel deployments, projects, domains, DNS, environment variables, and teams.',
        providerId: 'vercel',
        serviceAccountProviderId: 'vercel-service-account',
        icon: VercelIcon,
        baseProviderIcon: VercelIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'vercel',
  },
  whatsapp: {
    name: 'WhatsApp',
    icon: WhatsAppIcon,
    services: {
      whatsapp: {
        name: 'WhatsApp',
        description:
          'Send messages, templates, media, and reactions through the WhatsApp Cloud API.',
        providerId: 'whatsapp',
        serviceAccountProviderId: 'whatsapp-service-account',
        icon: WhatsAppIcon,
        baseProviderIcon: WhatsAppIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'whatsapp',
  },
  'github-token': {
    name: 'GitHub',
    icon: GithubIcon,
    services: {
      'github-token': {
        name: 'GitHub',
        description:
          'Manage GitHub repositories, issues, pull requests, workflows, releases, and gists.',
        providerId: 'github-token',
        serviceAccountProviderId: 'github-service-account',
        icon: GithubIcon,
        baseProviderIcon: GithubIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'github-token',
  },
  gitlab: {
    name: 'GitLab',
    icon: GitLabIcon,
    services: {
      gitlab: {
        name: 'GitLab',
        description:
          'Manage GitLab projects, issues, merge requests, pipelines, repositories, and members.',
        providerId: 'gitlab',
        serviceAccountProviderId: 'gitlab-service-account',
        icon: GitLabIcon,
        baseProviderIcon: GitLabIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'gitlab',
  },
  grafana: {
    name: 'Grafana',
    icon: GrafanaIcon,
    services: {
      grafana: {
        name: 'Grafana',
        description:
          'Manage dashboards, alert rules, annotations, contact points, data sources, and folders in Grafana.',
        providerId: 'grafana',
        serviceAccountProviderId: 'grafana-service-account',
        icon: GrafanaIcon,
        baseProviderIcon: GrafanaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'grafana',
  },
  jupyter: {
    name: 'Jupyter',
    icon: JupyterIcon,
    services: {
      jupyter: {
        name: 'Jupyter',
        description: 'Manage files, notebooks, kernels, and sessions on a Jupyter server.',
        providerId: 'jupyter',
        serviceAccountProviderId: 'jupyter-service-account',
        icon: JupyterIcon,
        baseProviderIcon: JupyterIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'jupyter',
  },
  convex: {
    name: 'Convex',
    icon: ConvexIcon,
    services: {
      convex: {
        name: 'Convex',
        description: 'Run functions, list tables, and export documents from a Convex deployment.',
        providerId: 'convex',
        serviceAccountProviderId: 'convex-service-account',
        icon: ConvexIcon,
        baseProviderIcon: ConvexIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'convex',
  },
  tinybird: {
    name: 'Tinybird',
    icon: TinybirdIcon,
    services: {
      tinybird: {
        name: 'Tinybird',
        description:
          'Send events, run SQL, call Pipe endpoints, and manage Data Sources in Tinybird.',
        providerId: 'tinybird',
        serviceAccountProviderId: 'tinybird-service-account',
        icon: TinybirdIcon,
        baseProviderIcon: TinybirdIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'tinybird',
  },
  dynatrace: {
    name: 'Dynatrace',
    icon: DynatraceIcon,
    services: {
      dynatrace: {
        name: 'Dynatrace',
        description:
          'Manage Dynatrace problems, metrics, entities, logs, SLOs, settings, and security.',
        providerId: 'dynatrace',
        serviceAccountProviderId: 'dynatrace-service-account',
        icon: DynatraceIcon,
        baseProviderIcon: DynatraceIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'dynatrace',
  },
  new_relic: {
    name: 'New Relic',
    icon: NewRelicIcon,
    services: {
      new_relic: {
        name: 'New Relic',
        description: 'Run NRQL queries, search entities, and record deployments in New Relic.',
        providerId: 'new_relic',
        serviceAccountProviderId: 'new-relic-service-account',
        icon: NewRelicIcon,
        baseProviderIcon: NewRelicIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'new_relic',
  },
  logfire: {
    name: 'Logfire',
    icon: LogfireIcon,
    services: {
      logfire: {
        name: 'Logfire',
        description: 'Query traces, logs, and metrics in Pydantic Logfire.',
        providerId: 'logfire',
        serviceAccountProviderId: 'logfire-service-account',
        icon: LogfireIcon,
        baseProviderIcon: LogfireIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'logfire',
  },
  mailgun: {
    name: 'Mailgun',
    icon: MailgunIcon,
    services: {
      mailgun: {
        name: 'Mailgun',
        description:
          'Send emails, manage mailing lists, and inspect domains and events in Mailgun.',
        providerId: 'mailgun',
        serviceAccountProviderId: 'mailgun-service-account',
        icon: MailgunIcon,
        baseProviderIcon: MailgunIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'mailgun',
  },
  jotform: {
    name: 'Jotform',
    icon: JotformIcon,
    services: {
      jotform: {
        name: 'Jotform',
        description: 'Read submissions, manage forms, and register webhooks in Jotform.',
        providerId: 'jotform',
        serviceAccountProviderId: 'jotform-service-account',
        icon: JotformIcon,
        baseProviderIcon: JotformIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'jotform',
  },
  plane: {
    name: 'Plane',
    icon: PlaneIcon,
    services: {
      plane: {
        name: 'Plane',
        description: 'Manage projects, work items, cycles, modules, and pages in Plane.',
        providerId: 'plane',
        serviceAccountProviderId: 'plane-service-account',
        icon: PlaneIcon,
        baseProviderIcon: PlaneIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'plane',
  },
  azure_devops: {
    name: 'Azure DevOps',
    icon: AzureIcon,
    services: {
      azure_devops: {
        name: 'Azure DevOps',
        description:
          'Work with pipelines, builds, and work items in your Azure DevOps organization.',
        providerId: 'azure_devops',
        serviceAccountProviderId: 'azure-devops-service-account',
        icon: AzureIcon,
        baseProviderIcon: AzureIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'azure_devops',
  },
  twilio: {
    name: 'Twilio',
    icon: TwilioIcon,
    services: {
      twilio: {
        name: 'Twilio',
        description: 'Send SMS and make calls from your Twilio account.',
        providerId: 'twilio',
        serviceAccountProviderId: 'twilio-service-account',
        icon: TwilioIcon,
        baseProviderIcon: TwilioIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'twilio',
  },
  algolia: {
    name: 'Algolia',
    icon: AlgoliaIcon,
    services: {
      algolia: {
        name: 'Algolia',
        description: 'Search and manage records and indices in your Algolia application.',
        providerId: 'algolia',
        serviceAccountProviderId: 'algolia-service-account',
        icon: AlgoliaIcon,
        baseProviderIcon: AlgoliaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'algolia',
  },
  upstash: {
    name: 'Upstash',
    icon: UpstashIcon,
    services: {
      upstash: {
        name: 'Upstash',
        description: 'Read and write keys in your Upstash Redis database.',
        providerId: 'upstash',
        serviceAccountProviderId: 'upstash-service-account',
        icon: UpstashIcon,
        baseProviderIcon: UpstashIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'upstash',
  },
  emailbison: {
    name: 'Email Bison',
    icon: EmailBisonIcon,
    services: {
      emailbison: {
        name: 'Email Bison',
        description: 'Manage Email Bison leads, campaigns, replies, and tags.',
        providerId: 'emailbison',
        serviceAccountProviderId: 'emailbison-service-account',
        icon: EmailBisonIcon,
        baseProviderIcon: EmailBisonIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'emailbison',
  },
  devin: {
    name: 'Devin',
    icon: DevinIcon,
    services: {
      devin: {
        name: 'Devin',
        description: 'Create, guide, and track Devin coding sessions.',
        providerId: 'devin',
        serviceAccountProviderId: 'devin-service-account',
        icon: DevinIcon,
        baseProviderIcon: DevinIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'devin',
  },
  okta: {
    name: 'Okta',
    icon: OktaIcon,
    services: {
      okta: {
        name: 'Okta',
        description: 'Manage users, groups, apps, and MFA in Okta.',
        providerId: 'okta',
        serviceAccountProviderId: 'okta-service-account',
        icon: OktaIcon,
        baseProviderIcon: OktaIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'okta',
  },
  infisical: {
    name: 'Infisical',
    icon: InfisicalIcon,
    services: {
      infisical: {
        name: 'Infisical',
        description: 'Manage secrets with Infisical',
        providerId: 'infisical',
        serviceAccountProviderId: 'infisical-service-account',
        icon: InfisicalIcon,
        baseProviderIcon: InfisicalIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'infisical',
  },
  supabase: {
    name: 'Supabase',
    icon: SupabaseIcon,
    services: {
      supabase: {
        name: 'Supabase',
        description: 'Use Supabase database',
        providerId: 'supabase',
        serviceAccountProviderId: 'supabase-service-account',
        icon: SupabaseIcon,
        baseProviderIcon: SupabaseIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'supabase',
  },
  thrive: {
    name: 'Thrive',
    icon: ThriveIcon,
    services: {
      thrive: {
        name: 'Thrive',
        description: 'Manage Thrive users, audiences, assignments, content, and CPD records.',
        providerId: 'thrive',
        serviceAccountProviderId: 'thrive-service-account',
        icon: ThriveIcon,
        baseProviderIcon: ThriveIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'thrive',
  },
  planetscale: {
    name: 'PlanetScale',
    icon: PlanetScaleIcon,
    services: {
      planetscale: {
        name: 'PlanetScale',
        description: 'Manage PlanetScale databases, branches, backups, and deploy requests.',
        providerId: 'planetscale',
        serviceAccountProviderId: 'planetscale-service-account',
        icon: PlanetScaleIcon,
        baseProviderIcon: PlanetScaleIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'planetscale',
  },
  gong: {
    name: 'Gong',
    icon: GongIcon,
    services: {
      gong: {
        name: 'Gong',
        description:
          'Read calls, transcripts, users, and activity, and manage Engage flows in Gong.',
        providerId: 'gong',
        serviceAccountProviderId: 'gong-service-account',
        icon: GongIcon,
        baseProviderIcon: GongIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'gong',
  },
  servicenow: {
    name: 'ServiceNow',
    icon: ServiceNowIcon,
    services: {
      servicenow: {
        name: 'ServiceNow',
        description:
          'Work with incidents, change requests, catalog items, and records in ServiceNow.',
        providerId: 'servicenow',
        serviceAccountProviderId: 'servicenow-service-account',
        icon: ServiceNowIcon,
        baseProviderIcon: ServiceNowIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'servicenow',
  },
  higgsfield: {
    name: 'Higgsfield',
    icon: HiggsfieldIcon,
    services: {
      higgsfield: {
        name: 'Higgsfield',
        description: 'Generate images and videos and manage Soul ID characters with Higgsfield.',
        providerId: 'higgsfield',
        serviceAccountProviderId: 'higgsfield-service-account',
        icon: HiggsfieldIcon,
        baseProviderIcon: HiggsfieldIcon,
        scopes: [],
        authType: 'service_account',
      },
    },
    defaultService: 'higgsfield',
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
        scopes: [
          'Desk.tickets.READ',
          'Desk.tickets.CREATE',
          'Desk.tickets.UPDATE',
          'Desk.contacts.READ',
          'Desk.contacts.CREATE',
          'Desk.contacts.UPDATE',
          'Desk.accounts.READ',
          'Desk.accounts.CREATE',
          'Desk.accounts.UPDATE',
          'Desk.search.READ',
          'Desk.departments.READ',
          'Desk.articles.READ',
          'Desk.organization.READ',
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
  /** Greenhouse requires grant parameters in the query string, with credentials in Basic auth. */
  refreshParamsInQuery?: boolean
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
function getProviderAuthConfig(
  provider: string,
  clientOverride?: Pick<QuickBooksOAuthClientConfig, 'clientId' | 'clientSecret'>
): ProviderAuthConfig {
  if (clientOverride && provider !== 'quickbooks') {
    throw new Error(`OAuth client override is not supported for provider ${provider}`)
  }
  switch (provider) {
    case 'greenhouse': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'greenhouse',
        'GREENHOUSE_CLIENT_ID',
        'GREENHOUSE_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: GREENHOUSE_TOKEN_URL,
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
        refreshParamsInQuery: true,
      }
    }
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
        useBasicAuth: false,
        useJsonBody: true,
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
        useBasicAuth: false,
        useJsonBody: true,
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
    case 'github-repositories': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'github-repositories',
        'GITHUB_APP_CLIENT_ID',
        'GITHUB_APP_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: GITHUB_TOKEN_URL,
        clientId,
        clientSecret,
        useBasicAuth: false,
        additionalHeaders: { Accept: 'application/json' },
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
    case 'ramp': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'ramp',
        'RAMP_CLIENT_ID',
        'RAMP_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.ramp.com/developer/v1/token',
        clientId,
        clientSecret,
        useBasicAuth: true,
        supportsRefreshTokenRotation: false,
      }
    }
    case 'helpscout': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'helpscout',
        'HELPSCOUT_CLIENT_ID',
        'HELPSCOUT_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: 'https://api.helpscout.net/v2/oauth2/token',
        clientId,
        clientSecret,
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
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
    case 'apollo': {
      const { clientId, clientSecret } = getConfiguredClientCredentials(
        'apollo',
        'APOLLO_CLIENT_ID',
        'APOLLO_CLIENT_SECRET'
      )
      return {
        tokenEndpoint: APOLLO_TOKEN_URL,
        clientId,
        clientSecret,
        useBasicAuth: false,
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
    case 'quickbooks': {
      if (!clientOverride) {
        throw new Error('QuickBooks OAuth client configuration is missing')
      }
      return {
        tokenEndpoint: QUICKBOOKS_TOKEN_URL,
        clientId: clientOverride.clientId,
        clientSecret: clientOverride.clientSecret,
        useBasicAuth: true,
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
    case 'shopify':
      throw new Error('Shopify refresh requires its persisted installation context')
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
  refreshTokenExpiresIn?: number
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
export const TOKEN_REFRESH_TIMEOUT_MS = 15_000

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

/** A revoked grant is its owner's to reconnect, not a fault of ours, so it logs at WARN. */
function logRefreshRejection(errorCode: string | undefined, providerId: string) {
  return isCredentialRevocationError(errorCode, providerId)
    ? logger.warn.bind(logger)
    : logger.error.bind(logger)
}

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
    logRefreshRejection(errorCode, providerId)('Instagram long-lived token refresh failed:', {
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
  refreshToken: string,
  clientOverride?: Pick<QuickBooksOAuthClientConfig, 'clientId' | 'clientSecret'>
): Promise<RefreshTokenResult> {
  const exactSecrets = [refreshToken]
  try {
    const provider = getBaseProviderForService(providerId)

    const config = getProviderAuthConfig(provider, clientOverride)
    if (config.clientSecret) exactSecrets.push(config.clientSecret)

    if (config.refreshStrategy === 'instagram_long_lived') {
      return await refreshInstagramLongLivedToken(config, refreshToken, providerId)
    }

    const { headers, bodyParams, useJsonBody } = buildAuthRequest(config, refreshToken)

    // Microsoft refresh tokens are resource-independent. Keep the Power BI audience explicit.
    if (providerId === 'microsoft-powerbi') {
      bodyParams.scope = OAUTH_PROVIDERS.microsoft.services['microsoft-powerbi'].scopes.join(' ')
    }

    const tokenUrl = new URL(config.tokenEndpoint)
    if (config.refreshParamsInQuery) {
      tokenUrl.search = new URLSearchParams(bodyParams).toString()
    }
    const response = await fetch(tokenUrl.toString(), {
      method: 'POST',
      headers,
      body: config.refreshParamsInQuery
        ? undefined
        : useJsonBody
          ? JSON.stringify(bodyParams)
          : new URLSearchParams(bodyParams).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS),
    })

    const responseText = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'OAuth token refresh response',
    })
    const responseData = parseOAuthResponse(responseText)

    if (!response.ok) {
      const errorCode =
        (provider === 'greenhouse' ? getGreenhouseRefreshErrorCode(responseData) : undefined) ??
        safeOAuthErrorCode(responseData, exactSecrets)

      logRefreshRejection(errorCode, providerId)('Token refresh failed:', {
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

    if (
      data.ok === false ||
      (provider === 'github-repositories' && typeof data.error === 'string')
    ) {
      const errorCode = safeOAuthErrorCode(data, exactSecrets)
      logRefreshRejection(errorCode, providerId)('Token refresh failed:', {
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

    if (provider === 'greenhouse') {
      const tokens = parseGreenhouseTokens(data)
      return {
        ok: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: Math.max(
          1,
          Math.ceil((tokens.accessTokenExpiresAt.getTime() - Date.now()) / 1000)
        ),
        refreshTokenExpiresIn: Math.max(
          1,
          Math.ceil((tokens.refreshTokenExpiresAt.getTime() - Date.now()) / 1000)
        ),
      }
    }

    if (provider === 'github-repositories') {
      const tokens = parseGitHubRepositoriesTokenResponse(data)
      return {
        ok: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        refreshTokenExpiresIn: tokens.refresh_token_expires_in,
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
    if (provider === 'quickbooks' && !newRefreshToken) {
      logger.warn('QuickBooks token refresh response omitted its rotating refresh token')
      return { ok: false, message: 'Invalid QuickBooks token refresh response' }
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

    const rawRefreshTokenExpiresIn = data.x_refresh_token_expires_in
    const parsedRefreshTokenExpiresIn =
      typeof rawRefreshTokenExpiresIn === 'number' || typeof rawRefreshTokenExpiresIn === 'string'
        ? Number(rawRefreshTokenExpiresIn)
        : Number.NaN
    const refreshTokenExpiresIn =
      provider === 'quickbooks' &&
      Number.isSafeInteger(parsedRefreshTokenExpiresIn) &&
      parsedRefreshTokenExpiresIn > 0
        ? parsedRefreshTokenExpiresIn
        : undefined

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
      ...(refreshTokenExpiresIn ? { refreshTokenExpiresIn } : {}),
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
