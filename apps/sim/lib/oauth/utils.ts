import { OAUTH_PROVIDERS } from './oauth'
import type {
  OAuthProvider,
  OAuthServiceConfig,
  OAuthServiceMetadata,
  ProviderConfig,
} from './types'

/**
 * Centralized human-readable descriptions for OAuth scopes.
 * Used by the OAuth Required Modal and available for any UI that needs to display scope info.
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  // Google scopes
  'https://www.googleapis.com/auth/gmail.send': 'Send emails',
  'https://www.googleapis.com/auth/gmail.labels': 'View and manage email labels',
  'https://www.googleapis.com/auth/gmail.modify': 'View and manage email messages',
  'https://www.googleapis.com/auth/drive.file': 'View and manage Google Drive files',
  'https://www.googleapis.com/auth/drive': 'Access all Google Drive files',
  'https://www.googleapis.com/auth/calendar': 'View and manage calendar',
  'https://www.googleapis.com/auth/contacts': 'View and manage Google Contacts',
  'https://www.googleapis.com/auth/tasks': 'Create, read, update, and delete Google Tasks',
  'https://www.googleapis.com/auth/userinfo.email': 'View email address',
  'https://www.googleapis.com/auth/userinfo.profile': 'View basic profile info',
  'https://www.googleapis.com/auth/forms.body': 'View and manage Google Forms',
  'https://www.googleapis.com/auth/forms.responses.readonly': 'View responses to Google Forms',
  'https://www.googleapis.com/auth/adwords': 'Manage Google Ads campaigns and reporting',
  'https://www.googleapis.com/auth/bigquery': 'View and manage data in Google BigQuery',
  'https://www.googleapis.com/auth/ediscovery': 'Access Google Vault for eDiscovery',
  'https://www.googleapis.com/auth/devstorage.read_only': 'Read files from Google Cloud Storage',
  'https://www.googleapis.com/auth/admin.directory.group': 'Manage Google Workspace groups',
  'https://www.googleapis.com/auth/admin.directory.group.member':
    'Manage Google Workspace group memberships',
  'https://www.googleapis.com/auth/admin.directory.group.readonly': 'View Google Workspace groups',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly':
    'View Google Workspace group memberships',
  'https://www.googleapis.com/auth/meetings.space.created':
    'Create and manage Google Meet meeting spaces',
  'https://www.googleapis.com/auth/meetings.space.readonly':
    'View Google Meet meeting space details',
  'https://www.googleapis.com/auth/cloud-platform':
    'Full access to Google Cloud resources for Vertex AI',

  // Confluence scopes
  'read:confluence-content.all': 'Read all Confluence content',
  'read:confluence-space.summary': 'Read Confluence space information',
  'read:space:confluence': 'View Confluence spaces',
  'read:space-details:confluence': 'View detailed Confluence space information',
  'write:confluence-content': 'Create and edit Confluence pages',
  'write:confluence-space': 'Manage Confluence spaces',
  'write:confluence-file': 'Upload files to Confluence',
  'read:content:confluence': 'Read Confluence content',
  'read:page:confluence': 'View Confluence pages',
  'write:page:confluence': 'Create and update Confluence pages',
  'read:comment:confluence': 'View comments on Confluence pages',
  'write:comment:confluence': 'Create and update comments',
  'delete:comment:confluence': 'Delete comments from Confluence pages',
  'read:attachment:confluence': 'View attachments on Confluence pages',
  'write:attachment:confluence': 'Upload and manage attachments',
  'delete:attachment:confluence': 'Delete attachments from Confluence pages',
  'delete:page:confluence': 'Delete Confluence pages',
  'read:label:confluence': 'View labels on Confluence content',
  'write:label:confluence': 'Add and remove labels',
  'search:confluence': 'Search Confluence content',
  'readonly:content.attachment:confluence': 'View attachments',
  'read:blogpost:confluence': 'View Confluence blog posts',
  'write:blogpost:confluence': 'Create and update Confluence blog posts',
  'read:content.property:confluence': 'View properties on Confluence content',
  'write:content.property:confluence': 'Create and manage content properties',
  'read:hierarchical-content:confluence': 'View page hierarchy (children and ancestors)',
  'read:content.metadata:confluence': 'View content metadata (required for ancestors)',
  'read:user:confluence': 'View Confluence user profiles',
  'read:task:confluence': 'View Confluence inline tasks',
  'write:task:confluence': 'Update Confluence inline tasks',
  'delete:blogpost:confluence': 'Delete Confluence blog posts',
  'write:space:confluence': 'Create and update Confluence spaces',
  'delete:space:confluence': 'Delete Confluence spaces',
  'read:space.property:confluence': 'View Confluence space properties',
  'write:space.property:confluence': 'Create and manage space properties',
  'read:space.permission:confluence': 'View Confluence space permissions',

  // Common scopes
  'read:me': 'Read profile information',
  offline_access: 'Access account when not using the application',
  openid: 'Standard authentication',
  profile: 'Access profile information',
  email: 'Access email address',

  // Notion scopes
  'database.read': 'Read database',
  'database.write': 'Write to database',
  'projects.read': 'Read projects',
  'page.read': 'Read Notion pages',
  'page.write': 'Write to Notion pages',
  'workspace.content': 'Read Notion content',
  'workspace.name': 'Read Notion workspace name',
  'workspace.read': 'Read Notion workspace',
  'workspace.write': 'Write to Notion workspace',
  'user.email:read': 'Read email address',

  // GitHub scopes
  repo: 'Access repositories',
  workflow: 'Manage repository workflows',
  'read:user': 'Read public user information',
  'user:email': 'Access email address',

  // X (Twitter) scopes
  'tweet.read': 'Read tweets and timeline',
  'tweet.write': 'Post and delete tweets',
  'tweet.moderate.write': 'Hide and unhide replies to tweets',
  'users.read': 'Read user profiles and account information',
  'follows.read': 'View followers and following lists',
  'follows.write': 'Follow and unfollow users',
  'bookmark.read': 'View bookmarked tweets',
  'bookmark.write': 'Add and remove bookmarks',
  'like.read': 'View liked tweets and liking users',
  'like.write': 'Like and unlike tweets',
  'block.read': 'View blocked users',
  'block.write': 'Block and unblock users',
  'mute.read': 'View muted users',
  'mute.write': 'Mute and unmute users',
  'offline.access': 'Access account when not using the application',

  // Airtable scopes
  'data.records:read': 'Read records',
  'data.records:write': 'Write to records',
  'schema.bases:read': 'View bases and tables',
  'webhook:manage': 'Manage webhooks',

  // Jira scopes
  'read:jira-user': 'Read Jira user',
  'read:jira-work': 'Read Jira work',
  'write:jira-work': 'Write to Jira work',
  'manage:jira-webhook': 'Register and manage Jira webhooks',
  'read:webhook:jira': 'View Jira webhooks',
  'write:webhook:jira': 'Create and update Jira webhooks',
  'delete:webhook:jira': 'Delete Jira webhooks',
  'read:issue-event:jira': 'Read Jira issue events',
  'write:issue:jira': 'Write to Jira issues',
  'read:project:jira': 'Read Jira projects',
  'read:issue-type:jira': 'Read Jira issue types',
  'read:issue-meta:jira': 'Read Jira issue meta',
  'read:issue-security-level:jira': 'Read Jira issue security level',
  'read:issue.vote:jira': 'Read Jira issue votes',
  'read:issue.changelog:jira': 'Read Jira issue changelog',
  'read:avatar:jira': 'Read Jira avatar',
  'read:issue:jira': 'Read Jira issues',
  'read:status:jira': 'Read Jira status',
  'read:user:jira': 'Read Jira user',
  'read:field-configuration:jira': 'Read Jira field configuration',
  'read:issue-details:jira': 'Read Jira issue details',
  'read:field:jira': 'Read Jira field configurations',
  'read:jql:jira': 'Use JQL to filter Jira issues',
  'read:comment.property:jira': 'Read Jira comment properties',
  'read:issue.property:jira': 'Read Jira issue properties',
  'delete:issue:jira': 'Delete Jira issues',
  'write:comment:jira': 'Add and update comments on Jira issues',
  'read:comment:jira': 'Read comments on Jira issues',
  'delete:comment:jira': 'Delete comments from Jira issues',
  'read:attachment:jira': 'Read attachments from Jira issues',
  'write:attachment:jira': 'Add attachments to Jira issues',
  'delete:attachment:jira': 'Delete attachments from Jira issues',
  'write:issue-worklog:jira': 'Add and update worklog entries on Jira issues',
  'read:issue-worklog:jira': 'Read worklog entries from Jira issues',
  'delete:issue-worklog:jira': 'Delete worklog entries from Jira issues',
  'write:issue-link:jira': 'Create links between Jira issues',
  'delete:issue-link:jira': 'Delete links between Jira issues',

  // Jira Service Management scopes
  'read:servicedesk:jira-service-management': 'View service desks and their settings',
  'read:requesttype:jira-service-management': 'View request types available in service desks',
  'read:request:jira-service-management': 'View customer requests in service desks',
  'write:request:jira-service-management': 'Create customer requests in service desks',
  'read:request.comment:jira-service-management': 'View comments on customer requests',
  'write:request.comment:jira-service-management': 'Add comments to customer requests',
  'read:customer:jira-service-management': 'View customer information',
  'write:customer:jira-service-management': 'Create and manage customers',
  'read:servicedesk.customer:jira-service-management': 'View customers linked to service desks',
  'write:servicedesk.customer:jira-service-management':
    'Add and remove customers from service desks',
  'read:organization:jira-service-management': 'View organizations',
  'write:organization:jira-service-management': 'Create and manage organizations',
  'read:servicedesk.organization:jira-service-management':
    'View organizations linked to service desks',
  'write:servicedesk.organization:jira-service-management':
    'Add and remove organizations from service desks',
  'read:organization.user:jira-service-management': 'View users in organizations',
  'write:organization.user:jira-service-management': 'Add and remove users from organizations',
  'read:organization.property:jira-service-management': 'View organization properties',
  'write:organization.property:jira-service-management':
    'Create and manage organization properties',
  'read:organization.profile:jira-service-management': 'View organization profiles',
  'write:organization.profile:jira-service-management': 'Update organization profiles',
  'read:queue:jira-service-management': 'View service desk queues and their issues',
  'read:request.sla:jira-service-management': 'View SLA information for customer requests',
  'read:request.status:jira-service-management': 'View status of customer requests',
  'write:request.status:jira-service-management': 'Transition customer request status',
  'read:request.participant:jira-service-management': 'View participants on customer requests',
  'write:request.participant:jira-service-management':
    'Add and remove participants from customer requests',
  'read:request.approval:jira-service-management': 'View approvals on customer requests',
  'write:request.approval:jira-service-management': 'Approve or decline customer requests',

  // Microsoft scopes
  'User.Read': 'Read Microsoft user',
  'Chat.Read': 'Read Microsoft chats',
  'Chat.ReadWrite': 'Write to Microsoft chats',
  'Chat.ReadBasic': 'Read Microsoft chats',
  'ChatMessage.Send': 'Send chat messages',
  'Channel.ReadBasic.All': 'Read Microsoft channels',
  'ChannelMessage.Send': 'Write to Microsoft channels',
  'ChannelMessage.Read.All': 'Read Microsoft channels',
  'ChannelMessage.ReadWrite': 'Read and write to Microsoft channels',
  'ChannelMember.Read.All': 'Read team channel members',
  'Group.Read.All': 'Read Microsoft groups',
  'Group.ReadWrite.All': 'Read and write all groups',
  'Team.ReadBasic.All': 'Read Microsoft teams',
  'TeamMember.Read.All': 'Read team members',
  'Mail.ReadWrite': 'Write to Microsoft emails',
  'Mail.ReadBasic': 'Read Microsoft emails',
  'Mail.Read': 'Read Microsoft emails',
  'Mail.Send': 'Send emails',
  'Files.Read': 'Read OneDrive files',
  'Files.ReadWrite': 'Read and write OneDrive files',
  'Tasks.ReadWrite': 'Read and manage Planner tasks',
  'Sites.Read.All': 'Read Sharepoint sites',
  'Sites.ReadWrite.All': 'Read and write Sharepoint sites',
  'Sites.Manage.All': 'Manage Sharepoint sites',
  'https://dynamics.microsoft.com/user_impersonation': 'Access Microsoft Dataverse on your behalf',
  'User.Read.All': 'Read all user profiles',
  'User.ReadWrite.All': 'Read and write all user profiles',
  'GroupMember.ReadWrite.All': 'Read and write all group memberships',
  'Directory.Read.All': 'Read directory data',

  // Discord scopes
  identify: 'Read Discord user',
  bot: 'Read Discord bot',
  'messages.read': 'Read Discord messages',
  guilds: 'Read Discord guilds',
  'guilds.members.read': 'Read Discord guild members',

  // Reddit scopes
  identity: 'Access Reddit identity',
  submit: 'Submit posts and comments',
  vote: 'Vote on posts and comments',
  save: 'Save and unsave posts and comments',
  edit: 'Edit posts and comments',
  subscribe: 'Subscribe and unsubscribe from subreddits',
  history: 'Access Reddit history',
  privatemessages: 'Access inbox and send private messages',
  account: 'Update account preferences and settings',
  mysubreddits: 'Access subscribed and moderated subreddits',
  flair: 'Manage user and post flair',
  report: 'Report posts and comments for rule violations',
  modposts: 'Approve, remove, and moderate posts in moderated subreddits',
  modflair: 'Manage flair in moderated subreddits',
  modmail: 'Access and respond to moderator mail',

  // Wealthbox scopes
  login: 'Access Wealthbox account',
  data: 'Access Wealthbox data',

  // Linear scopes
  read: 'Read access to workspace',
  write: 'Write access to Linear workspace',

  // Slack scopes
  'channels:read': 'View public channels',
  'channels:history': 'Read channel messages',
  'groups:read': 'View private channels',
  'groups:history': 'Read private messages',
  'chat:write': 'Send messages',
  'chat:write.public': 'Post to public channels',
  'im:write': 'Send direct messages',
  'im:history': 'Read direct message history',
  'im:read': 'View direct message channels',
  'users:read': 'View workspace users',
  'users:read.email': 'View user email addresses',
  'files:write': 'Upload files',
  'files:read': 'Download and read files',
  'canvases:write': 'Create canvas documents',
  'reactions:write': 'Add emoji reactions to messages',

  // Webflow scopes
  'sites:read': 'View Webflow sites',
  'sites:write': 'Manage webhooks and site settings',
  'cms:read': 'View CMS content',
  'cms:write': 'Manage CMS content',
  'forms:read': 'View form submissions',

  // HubSpot scopes
  'crm.objects.contacts.read': 'Read HubSpot contacts',
  'crm.objects.contacts.write': 'Create and update HubSpot contacts',
  'crm.objects.companies.read': 'Read HubSpot companies',
  'crm.objects.companies.write': 'Create and update HubSpot companies',
  'crm.objects.deals.read': 'Read HubSpot deals',
  'crm.objects.deals.write': 'Create and update HubSpot deals',
  'crm.objects.owners.read': 'Read HubSpot object owners',
  'crm.objects.users.read': 'Read HubSpot users',
  'crm.objects.users.write': 'Create and update HubSpot users',
  'crm.objects.marketing_events.read': 'Read HubSpot marketing events',
  'crm.objects.marketing_events.write': 'Create and update HubSpot marketing events',
  'crm.objects.line_items.read': 'Read HubSpot line items',
  'crm.objects.line_items.write': 'Create and update HubSpot line items',
  'crm.objects.quotes.read': 'Read HubSpot quotes',
  'crm.objects.quotes.write': 'Create and update HubSpot quotes',
  'crm.objects.appointments.read': 'Read HubSpot appointments',
  'crm.objects.appointments.write': 'Create and update HubSpot appointments',
  'crm.objects.carts.read': 'Read HubSpot shopping carts',
  'crm.objects.carts.write': 'Create and update HubSpot shopping carts',
  'crm.import': 'Import data into HubSpot',
  'crm.lists.read': 'Read HubSpot lists',
  'crm.lists.write': 'Create and update HubSpot lists',
  'crm.objects.tickets.read': 'Read HubSpot tickets',
  'crm.objects.tickets.write': 'Create and update HubSpot tickets',
  tickets: 'Access HubSpot tickets',
  oauth: 'Authenticate with HubSpot OAuth',

  // Salesforce scopes
  api: 'Access Salesforce API',
  refresh_token: 'Maintain long-term access to Salesforce account',

  // Asana scopes
  default: 'Access Asana workspace',

  // Pipedrive scopes
  base: 'Basic access to Pipedrive account',
  'deals:read': 'Read Pipedrive deals',
  'deals:full': 'Full access to manage Pipedrive deals',
  'contacts:read': 'Read Pipedrive contacts',
  'contacts:full': 'Full access to manage Pipedrive contacts',
  'leads:read': 'Read Pipedrive leads',
  'leads:full': 'Full access to manage Pipedrive leads',
  'activities:read': 'Read Pipedrive activities',
  'activities:full': 'Full access to manage Pipedrive activities',
  'mail:read': 'Read Pipedrive emails',
  'mail:full': 'Full access to manage Pipedrive emails',
  'projects:read': 'Read Pipedrive projects',
  'projects:full': 'Full access to manage Pipedrive projects',
  'webhooks:read': 'Read Pipedrive webhooks',
  'webhooks:full': 'Full access to manage Pipedrive webhooks',

  // LinkedIn scopes
  w_member_social: 'Access LinkedIn profile',

  // Box scopes
  root_readwrite: 'Read and write all files and folders in Box account',
  root_readonly: 'Read all files and folders in Box account',
  'sign_requests.readwrite': 'Create and manage Box Sign e-signature requests',

  // Shopify scopes
  write_products: 'Read and manage Shopify products',
  write_orders: 'Read and manage Shopify orders',
  write_customers: 'Read and manage Shopify customers',
  write_inventory: 'Read and manage Shopify inventory levels',
  read_locations: 'View store locations',
  write_merchant_managed_fulfillment_orders: 'Create fulfillments for orders',

  // Zoom scopes
  'user:read:user': 'View Zoom profile information',
  'meeting:write:meeting': 'Create Zoom meetings',
  'meeting:read:meeting': 'View Zoom meeting details',
  'meeting:read:list_meetings': 'List Zoom meetings',
  'meeting:update:meeting': 'Update Zoom meetings',
  'meeting:delete:meeting': 'Delete Zoom meetings',
  'meeting:read:invitation': 'View Zoom meeting invitations',
  'meeting:read:list_past_participants': 'View past meeting participants',
  'cloud_recording:read:list_user_recordings': 'List Zoom cloud recordings',
  'cloud_recording:read:list_recording_files': 'View recording files',
  'cloud_recording:delete:recording_file': 'Delete cloud recordings',

  // Dropbox scopes
  'account_info.read': 'View Dropbox account information',
  'files.metadata.read': 'View file and folder names, sizes, and dates',
  'files.metadata.write': 'Modify file and folder metadata',
  'files.content.read': 'Download and read Dropbox files',
  'files.content.write': 'Upload, copy, move, and delete files in Dropbox',
  'sharing.read': 'View shared files and folders',
  'sharing.write': 'Share files and folders with others',

  // WordPress.com scopes
  global: 'Full access to manage WordPress.com sites, posts, pages, media, and settings',

  // Spotify scopes
  'user-read-private': 'View Spotify account details',
  'user-read-email': 'View email address on Spotify',
  'user-library-read': 'View saved tracks and albums',
  'user-library-modify': 'Save and remove tracks and albums from library',
  'playlist-read-private': 'View private playlists',
  'playlist-read-collaborative': 'View collaborative playlists',
  'playlist-modify-public': 'Create and manage public playlists',
  'playlist-modify-private': 'Create and manage private playlists',
  'user-read-playback-state': 'View current playback state',
  'user-modify-playback-state': 'Control playback on Spotify devices',
  'user-read-currently-playing': 'View currently playing track',
  'user-read-recently-played': 'View recently played tracks',
  'user-top-read': 'View top artists and tracks',
  'user-follow-read': 'View followed artists and users',
  'user-follow-modify': 'Follow and unfollow artists and users',
  'user-read-playback-position': 'View playback position in podcasts',
  'ugc-image-upload': 'Upload images to Spotify playlists',

  // DocuSign scopes
  signature: 'Create and send envelopes for e-signature',
  extended: 'Extended access to DocuSign account features',

  // Attio scopes
  'record_permission:read-write': 'Read and write CRM records',
  'object_configuration:read-write': 'Read and manage object schemas',
  'list_configuration:read-write': 'Read and manage list configurations',
  'list_entry:read-write': 'Read and write list entries',
  'note:read-write': 'Read and write notes',
  'task:read-write': 'Read and write tasks',
  'comment:read-write': 'Read and write comments and threads',
  'user_management:read': 'View workspace members',
  'webhook:read-write': 'Manage webhooks',
}

/**
 * Get a human-readable description for a scope.
 * Falls back to the raw scope string if no description is found.
 */
export function getScopeDescription(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope] || scope
}

/**
 * Returns a flat list of all available OAuth services with metadata.
 * This is safe to use on the server as it doesn't include React components.
 */
export function getAllOAuthServices(): OAuthServiceMetadata[] {
  const services: OAuthServiceMetadata[] = []

  for (const [baseProviderId, provider] of Object.entries(OAUTH_PROVIDERS)) {
    for (const service of Object.values(provider.services)) {
      services.push({
        providerId: service.providerId,
        name: service.name,
        description: service.description,
        baseProvider: baseProviderId,
      })
    }
  }

  return services
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
    for (const [key, service] of Object.entries(provider.services)) {
      if (service.providerId === providerId || key === providerId) {
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

/**
 * Get canonical scopes for a service by its serviceId key in OAUTH_PROVIDERS.
 * Useful for block definitions to reference scopes from the single source of truth.
 */
export function getScopesForService(serviceId: string): string[] {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    const service = provider.services[serviceId]
    if (service) {
      return [...service.scopes]
    }
  }
  return []
}

/**
 * Scopes that control token behavior but are not returned in OAuth token responses.
 * These should be ignored when validating credential scopes.
 */
const IGNORED_SCOPES = new Set([
  'offline_access', // Microsoft - requests refresh token
  'refresh_token', // Salesforce - requests refresh token
  'offline.access', // Airtable - requests refresh token (note: dot not underscore)
])

/**
 * Compute which of the provided requiredScopes are NOT granted by the credential.
 * Note: Ignores special OAuth scopes that control token behavior (like offline_access)
 * as they are not returned in the token response's scope list even when granted.
 */
export function getMissingRequiredScopes(
  credential: { scopes?: string[] } | undefined,
  requiredScopes: string[] = []
): string[] {
  if (!credential) {
    return requiredScopes.filter((s) => !IGNORED_SCOPES.has(s))
  }

  const granted = new Set(credential.scopes || [])
  const missing: string[] = []

  for (const s of requiredScopes) {
    if (IGNORED_SCOPES.has(s)) continue

    if (!granted.has(s)) missing.push(s)
  }

  return missing
}

/**
 * Build a mapping of providerId -> { baseProvider, serviceKey } from OAUTH_PROVIDERS
 * This is computed once at module load time
 */
const PROVIDER_ID_TO_BASE_PROVIDER: Record<string, { baseProvider: string; serviceKey: string }> =
  {}

for (const [baseProviderId, providerConfig] of Object.entries(OAUTH_PROVIDERS)) {
  for (const [serviceKey, service] of Object.entries(providerConfig.services)) {
    PROVIDER_ID_TO_BASE_PROVIDER[service.providerId] = {
      baseProvider: baseProviderId,
      serviceKey,
    }
  }
}

/**
 * Parse a provider string into its base provider and feature type.
 * Uses the pre-computed mapping from OAUTH_PROVIDERS for accuracy.
 */
export function parseProvider(provider: OAuthProvider): ProviderConfig {
  // First, check if this is a known providerId from our config
  const mapping = PROVIDER_ID_TO_BASE_PROVIDER[provider]
  if (mapping) {
    return {
      baseProvider: mapping.baseProvider,
      featureType: mapping.serviceKey,
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
