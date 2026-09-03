/**
 * Canonical OAuth scope data: the scope set each service requests, and the
 * human-readable label for an individual scope.
 *
 * Kept import-free on purpose. Three callers need this data and no single
 * environment suits all of them — `oauth.ts` pulls in React icons and `env`,
 * and `scripts/generate-docs.ts` runs outside Next and can import neither. A
 * module with no dependencies is the only shape all three can consume, which is
 * what keeps the published `## Scopes` tables and the scopes actually requested
 * at authorization time from drifting apart.
 */

/**
 * Scopes requested for each OAuth service, keyed by service id.
 *
 * Read by {@link OAUTH_PROVIDERS} to build each service's authorization request
 * and by the docs generator to emit every integration page's `## Scopes`
 * section, so a scope added here reaches both the consent screen and the
 * published docs. Slack's approval-gated extras are the one exception: they are
 * appended in `oauth.ts` because whether they are requested depends on an
 * environment flag, and generated docs must not vary by deployment.
 */
export const OAUTH_SCOPES = {
  'claude-platform': [],
  gmail: [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.labels',
  ],
  'google-drive': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive',
  ],
  'google-docs': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive',
  ],
  'google-sheets': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive',
  ],
  'google-forms': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/forms.responses.readonly',
  ],
  'google-calendar': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar',
  ],
  'google-contacts': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/contacts',
  ],
  'google-ads': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/adwords',
  ],
  'google-bigquery': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/bigquery',
  ],
  'google-tasks': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/tasks',
  ],
  'google-vault': [
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
  'google-groups': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/admin.directory.group',
    'https://www.googleapis.com/auth/admin.directory.group.member',
  ],
  'google-chat': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/chat.spaces.readonly',
    'https://www.googleapis.com/auth/chat.messages.readonly',
  ],
  'google-meet': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/meetings.space.created',
    'https://www.googleapis.com/auth/meetings.space.readonly',
  ],
  'google-service-account': [],
  'vertex-ai': [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cloud-platform',
  ],
  'microsoft-ad': [
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
  'microsoft-dataverse': [
    'openid',
    'profile',
    'email',
    'https://dynamics.microsoft.com/user_impersonation',
    'offline_access',
  ],
  /**
   * Workbooks are ordinary drive items, so the integration reads and writes them
   * through the Files permissions rather than an Excel-specific scope. Microsoft
   * Graph exposes no Excel permission of its own.
   *
   * The `.All` variants and `Sites.Read.All` are what make the block's SharePoint
   * file picker work. `Files.ReadWrite` alone covers only the signed-in user's own
   * OneDrive, so a workbook in a document library is rejected for insufficient
   * privileges, and the drive picker's `GET /sites/{id}/drives` call needs the
   * Sites read. All four are user-consentable, so this does not push the
   * integration behind admin consent, and none of them grants access to anything
   * the signed-in account could not already open.
   *
   * Microsoft only grants newly-added scopes on a fresh authorization, so accounts
   * connected before these existed must reconnect before a SharePoint-hosted
   * workbook will open.
   *
   * @see https://learn.microsoft.com/en-us/graph/permissions-reference
   */
  'microsoft-excel': [
    'openid',
    'profile',
    'email',
    'Files.Read',
    'Files.ReadWrite',
    'Files.Read.All',
    'Files.ReadWrite.All',
    'Sites.Read.All',
    'offline_access',
  ],
  'microsoft-planner': [
    'openid',
    'profile',
    'email',
    'Group.ReadWrite.All',
    'Group.Read.All',
    'Tasks.ReadWrite',
    'offline_access',
  ],
  'microsoft-teams': [
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
  'microsoft-word': [
    'openid',
    'profile',
    'email',
    'Files.Read',
    'Files.ReadWrite',
    'Files.Read.All',
    'Files.ReadWrite.All',
    'offline_access',
  ],
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
  outlook: [
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
  onedrive: ['openid', 'profile', 'email', 'Files.Read', 'Files.ReadWrite', 'offline_access'],
  sharepoint: [
    'openid',
    'profile',
    'email',
    'Sites.Read.All',
    'Sites.ReadWrite.All',
    'Sites.Manage.All',
    'offline_access',
  ],
  x: [
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
  tiktok: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.upload', 'video.list'],
  'atlassian-service-account': [],
  confluence: [
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
  jira: [
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
  airtable: [
    'data.records:read',
    'data.records:write',
    'schema.bases:read',
    'user.email:read',
    'webhook:manage',
  ],
  bitbucket: [
    'account',
    'repository',
    'repository:write',
    'pullrequest',
    'pullrequest:write',
    'pipeline',
    'pipeline:write',
    'webhook',
  ],
  notion: [],
  clickup: [],
  linear: ['read', 'write'],
  monday: [
    'boards:read',
    'boards:write',
    'updates:read',
    'updates:write',
    'webhooks:read',
    'webhooks:write',
    'me:read',
  ],
  box: ['root_readwrite', 'sign_requests.readwrite'],
  dropbox: [
    'account_info.read',
    'files.metadata.read',
    'files.metadata.write',
    'files.content.read',
    'files.content.write',
    'sharing.read',
    'sharing.write',
  ],
  shopify: [
    'write_products',
    'write_orders',
    'write_customers',
    'write_inventory',
    'read_locations',
    'write_merchant_managed_fulfillment_orders',
  ],
  slack: [
    'channels:read',
    'channels:history',
    'channels:manage',
    'groups:read',
    'groups:history',
    'groups:write',
    'chat:write',
    'chat:write.public',
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
  snowflake: [],
  netsuite: [],
  reddit: [
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
  wealthbox: ['login', 'data'],
  webflow: ['cms:read', 'cms:write', 'sites:read', 'sites:write', 'forms:read'],
  trello: ['read', 'write'],
  asana: ['default'],
  attio: [
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
  calcom: [],
  docusign: ['signature', 'extended'],
  pipedrive: [
    'base',
    'deals:full',
    'contacts:full',
    'leads:full',
    'activities:full',
    'mail:full',
    'projects:full',
  ],
  hubspot: [
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
  harmonic: [],
  linkedin: ['profile', 'openid', 'email', 'w_member_social'],
  instagram: [
    'instagram_business_basic',
    'instagram_business_content_publish',
    'instagram_business_manage_comments',
    'instagram_business_manage_messages',
    'instagram_business_manage_insights',
  ],
  salesforce: ['api', 'refresh_token', 'openid'],
  /**
   * ServiceDesk Plus Cloud scopes are `SDPOnDemand.<module>.<operation>`,
   * enumerated per operation rather than requested as the broader `.ALL` group
   * scopes, so the consent screen names exactly what the block can do.
   */
  'manageengine-sdp': [
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
  'zoho-desk': [
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
  zoom: [
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
  wordpress: ['global'],
  spotify: [
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
} as const satisfies Record<string, readonly string[]>

/** Service ids that declare a scope set. */
export type OAuthScopedService = keyof typeof OAUTH_SCOPES

/**
 * A caveat the scope rows of one service cannot carry on their own, keyed by
 * service id.
 *
 * Dataverse is the case that forced this: the row below is the resource scope
 * the connector declares, but binding an environment swaps it for that
 * environment's `/.default`, so a table printed without the caveat claims to
 * list a request the runtime does not make.
 */
export const SERVICE_SCOPE_NOTES = {
  'microsoft-dataverse':
    "Connecting a specific environment requests that environment's `/.default` scope instead " +
    'of the resource scope above. The host is normalized to its `.api` form first, so ' +
    '`https://contoso.crm.dynamics.com` is requested as ' +
    '`https://contoso.api.crm.dynamics.com/.default`.',
} as const satisfies Record<string, string>

/**
 * Scopes a service requests only where the deployment has opted in, keyed by
 * service id.
 *
 * Held apart from {@link OAUTH_SCOPES} because a generated page must not vary
 * by deployment, and published separately because a self-hoster who sets the
 * flag still has to add these to the app before anyone can connect. Slack is
 * the sharp case: it rejects the entire authorization with "unapproved
 * permissions requested" if the app is not approved for one of them, so a
 * reader who enables the flag without adding them loses Slack altogether.
 */
export const ENV_GATED_SCOPES = {
  slack: {
    envVar: 'SLACK_EXTENDED_SCOPES',
    scopes: ['assistant:write', 'app_mentions:read', 'im:history'],
  },
} as const satisfies Record<string, { envVar: string; scopes: readonly string[] }>

/**
 * Centralized human-readable descriptions for OAuth scopes.
 * Used by the OAuth Required Modal and available for any UI that needs to display scope info.
 */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  // Zoho Desk scopes
  'Desk.tickets.READ': 'View tickets, threads, comments, and attachments',
  'Desk.tickets.UPDATE': 'Update tickets and add comments',
  'Desk.contacts.READ': 'View contacts',
  'Desk.articles.READ': 'View Help Center articles',
  'Desk.organization.READ': 'View organization details',
  'Desk.agents.READ': 'View agents',
  'Desk.basic.READ': 'View basic account and organization data',
  'Desk.webhooks.CREATE': 'Create webhooks',
  'Desk.webhooks.DELETE': 'Delete webhooks',
  'aaaserver.profile.READ': 'View your Zoho profile',
  // ManageEngine ServiceDesk Plus Cloud scopes
  'SDPOnDemand.requests.CREATE': 'Create requests',
  'SDPOnDemand.requests.READ': 'View requests and their notes',
  'SDPOnDemand.requests.UPDATE': 'Update requests and add notes',
  'SDPOnDemand.requests.DELETE': 'Delete requests',
  'SDPOnDemand.problems.CREATE': 'Create problems',
  'SDPOnDemand.problems.READ': 'View problems and their notes',
  'SDPOnDemand.problems.UPDATE': 'Update problems and add notes',
  'SDPOnDemand.problems.DELETE': 'Delete problems',
  'SDPOnDemand.changes.CREATE': 'Create changes',
  'SDPOnDemand.changes.READ': 'View changes and their notes',
  'SDPOnDemand.changes.UPDATE': 'Update changes and add notes',
  'SDPOnDemand.changes.DELETE': 'Delete changes',
  'SDPOnDemand.assets.CREATE': 'Create assets',
  'SDPOnDemand.assets.READ': 'View assets',
  'SDPOnDemand.assets.UPDATE': 'Update assets',
  'SDPOnDemand.assets.DELETE': 'Delete assets',
  'SDPOnDemand.solutions.CREATE': 'Create knowledge base solutions',
  'SDPOnDemand.solutions.READ': 'View knowledge base solutions',
  'SDPOnDemand.solutions.UPDATE': 'Update knowledge base solutions',
  'SDPOnDemand.solutions.DELETE': 'Delete knowledge base solutions',
  // Google scopes
  'https://www.googleapis.com/auth/gmail.send': 'Send emails',
  'https://www.googleapis.com/auth/gmail.labels': 'View and manage email labels',
  'https://www.googleapis.com/auth/gmail.readonly': 'View email messages and settings',
  'https://www.googleapis.com/auth/gmail.modify': 'View and manage email messages',
  'https://www.googleapis.com/auth/drive.file': 'View and manage Google Drive files',
  'https://www.googleapis.com/auth/drive': 'Access all Google Drive files',
  'https://www.googleapis.com/auth/calendar.readonly': 'View calendars and events',
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
  'https://www.googleapis.com/auth/ediscovery.readonly':
    'View Google Vault matters, holds, and saved queries',
  'https://www.googleapis.com/auth/devstorage.read_only': 'Read files from Google Cloud Storage',
  'https://www.googleapis.com/auth/admin.directory.group': 'Manage Google Workspace groups',
  'https://www.googleapis.com/auth/admin.directory.group.member':
    'Manage Google Workspace group memberships',
  'https://www.googleapis.com/auth/admin.directory.group.readonly': 'View Google Workspace groups',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly':
    'View Google Workspace group memberships',
  'https://www.googleapis.com/auth/chat.spaces.readonly':
    'View Google Chat spaces you are a member of',
  'https://www.googleapis.com/auth/chat.messages.readonly':
    'View messages in Google Chat spaces you are a member of',
  'https://www.googleapis.com/auth/meetings.space.created':
    'Create Google Meet spaces and manage the ones created through Sim',
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
  'read:confluence-user': 'View Confluence user profiles (v1 API)',
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

  // TikTok scopes
  'user.info.basic': "Read a user's profile info (open id, avatar, display name)",
  'user.info.profile': "Read a user's profile info (bio, verification status, username)",
  'user.info.stats': "Read a user's stats (follower, following, likes, and video counts)",
  'video.upload': "Share content to a creator's account as a draft for further edit and post",
  'video.list': "Read a user's public TikTok videos",

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
  'read:servicedesk-request': 'View service desk requests',
  'write:servicedesk-request': 'Create and update service desk requests',
  'manage:servicedesk-customer': 'Manage service desk customers and organizations',
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
  'read:cmdb-object:jira': 'View Assets objects and run AQL searches',
  'write:cmdb-object:jira': 'Create and update Assets objects',
  'delete:cmdb-object:jira': 'Delete Assets objects',
  'read:cmdb-schema:jira': 'View Assets object schemas',
  'read:cmdb-type:jira': 'View Assets object types',
  'read:cmdb-attribute:jira': 'View Assets object type attributes',

  // Microsoft scopes
  'User.Read': 'Read Microsoft user',
  'Chat.Read': 'Read Microsoft chats',
  'Chat.ReadWrite': 'Read and write Microsoft chats',
  'Chat.ReadBasic': 'Read Microsoft chats',
  'ChatMessage.Send': 'Send chat messages',
  'Channel.ReadBasic.All': 'Read Microsoft channels',
  'ChannelMessage.Send': 'Send channel messages',
  'ChannelMessage.Read.All': 'Read Microsoft channels',
  'ChannelMessage.ReadWrite': 'Read and write to Microsoft channels',
  'ChannelMember.Read.All': 'Read team channel members',
  'Group.Read.All': 'Read Microsoft groups',
  'Group.ReadWrite.All': 'Read and write all groups',
  'Team.ReadBasic.All': 'Read Microsoft teams',
  'TeamMember.Read.All': 'Read team members',
  'Mail.ReadWrite': 'Read and write Microsoft emails',
  'Mail.ReadBasic': 'Read Microsoft emails',
  'Mail.Read': 'Read Microsoft emails',
  'Mail.Send': 'Send emails',
  'Calendars.ReadWrite': 'Read and manage Outlook calendar events',
  'Files.Read': 'Read OneDrive files',
  'Files.ReadWrite': 'Read and write OneDrive files',
  'Files.Read.All': 'Read files shared with you, including SharePoint libraries',
  'Files.ReadWrite.All': 'Read and write files you have access to, including SharePoint libraries',
  'Tasks.ReadWrite': 'Read and manage Planner tasks',
  'Sites.Read.All': 'Read SharePoint sites',
  'Sites.ReadWrite.All': 'Read and write SharePoint sites',
  'Sites.Manage.All': 'Manage SharePoint sites',
  'https://dynamics.microsoft.com/user_impersonation': 'Access Microsoft Dataverse on your behalf',
  'User.ReadWrite.All': 'Read and write all user profiles',
  'GroupMember.ReadWrite.All': 'Read and write all group memberships',
  'Directory.Read.All': 'Read directory data',
  'LicenseAssignment.Read.All': 'Read license assignments and subscribed SKUs',
  'LicenseAssignment.ReadWrite.All': 'Read, assign, and remove user licenses',
  'UserAuthenticationMethod.ReadWrite.All':
    'Read and reset authentication methods and passwords for all users',
  'AuditLog.Read.All': 'Read sign-in and directory audit logs',
  'Application.Read.All': 'Read all applications and service principals',
  'AppRoleAssignment.ReadWrite.All': 'Read, grant, and revoke application role assignments',
  'RoleManagement.ReadWrite.Directory': 'Read and manage directory role assignments',
  'Device.Read.All': 'Read all devices',
  'Policy.Read.All': 'Read conditional access and other policies',

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
  read: 'Read access to connected account data',
  write: 'Write access to connected account data',

  // Slack scopes
  'channels:read': 'View public channels',
  'channels:history': 'Read channel messages',
  'channels:manage': 'Create, archive, and rename public channels',
  'groups:read': 'View private channels',
  'groups:history': 'Read private messages',
  'groups:write': 'Create, archive, and manage private channels',
  'chat:write': 'Send messages',
  'chat:write.public': 'Post to public channels',
  'chat:write.customize': 'Customize message username and icon',
  'assistant:write': 'Manage assistant status, titles, and suggested prompts',
  'im:write': 'Send direct messages',
  'im:history': 'Read direct message history',
  'im:read': 'View direct message channels',
  'users:read': 'View workspace users',
  'users:read.email': 'View user email addresses',
  'files:write': 'Upload files',
  'files:read': 'Download and read files',
  'canvases:read': 'Read canvas sections',
  'canvases:write': 'Create, edit, and delete canvas documents',
  'reactions:write': 'Add emoji reactions to messages',
  'reactions:read': 'View emoji reactions on messages',

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
  'sales-email-read': 'Read the content of HubSpot email engagements',
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
  'webhooks:full': 'Full access to manage Pipedrive webhooks',

  // LinkedIn scopes
  w_member_social: 'Post, comment, and like posts on your behalf',

  // Instagram scopes (Business Login for Instagram)
  instagram_business_basic: 'Access Instagram professional profile and media',
  instagram_business_content_publish: 'Publish photos, videos, reels, and stories',
  instagram_business_manage_comments: 'Read, reply to, hide, and delete comments',
  instagram_business_manage_messages: 'Read conversations and send Instagram Direct messages',
  instagram_business_manage_insights: 'Read account and media insights',

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
  write_merchant_managed_fulfillment_orders: 'Read orders and create fulfillments for them',

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

  // Monday.com scopes
  'boards:read': 'Read boards, items, and columns',
  'boards:write': 'Create and modify boards, items, and groups',
  'updates:read': 'Read updates and comments',
  'updates:write': 'Create and edit updates and comments',
  'webhooks:read': 'Read webhook subscriptions',
  'webhooks:write': 'Create and manage webhook subscriptions',
  'me:read': 'Read your user profile',
}

/** Scope labels that cannot be keyed by scope alone because providers reuse names. */
const PROVIDER_SCOPE_DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  /**
   * Workbooks and Word documents are ordinary drive items, so both integrations
   * ask for the generic Files permissions. The shared labels name OneDrive
   * specifically, which reads as the wrong product on either consent screen and
   * omits the SharePoint libraries the same scopes cover.
   */
  'microsoft-excel': {
    'Files.Read': 'Read your workbooks in OneDrive',
    'Files.ReadWrite': 'Read, create, and edit your workbooks in OneDrive',
    'Files.Read.All': 'Read workbooks shared with you, including SharePoint libraries',
    'Files.ReadWrite.All':
      'Read, create, and edit workbooks you have access to, including SharePoint libraries',
    'Sites.Read.All': 'List the SharePoint sites and document libraries you can open',
  },
  'microsoft-word': {
    'Files.Read': 'Read your Word documents in OneDrive',
    'Files.ReadWrite': 'Read, create, and edit your Word documents in OneDrive',
    'Files.Read.All': 'Read Word documents shared with you, including SharePoint libraries',
    'Files.ReadWrite.All':
      'Read, create, and edit Word documents you have access to, including SharePoint libraries',
  },
  bitbucket: {
    account: 'View your Bitbucket account and workspace memberships',
    repository: 'View repositories and source code',
    'repository:write': 'Create and modify repositories, branches, and source code',
    pullrequest: 'View pull requests, comments, approvals, and statuses',
    'pullrequest:write': 'Create, update, approve, decline, and merge pull requests',
    pipeline: 'View pipelines, steps, and logs',
    'pipeline:write': 'Run and stop pipelines',
    webhook: 'Manage repository webhooks',
  },
}

/**
 * Get a human-readable description for a scope.
 * Falls back to the raw scope string if no description is found.
 */
export function getScopeDescription(scope: string, providerId?: string): string {
  return (
    PROVIDER_SCOPE_DESCRIPTIONS[providerId ?? '']?.[scope] || SCOPE_DESCRIPTIONS[scope] || scope
  )
}
