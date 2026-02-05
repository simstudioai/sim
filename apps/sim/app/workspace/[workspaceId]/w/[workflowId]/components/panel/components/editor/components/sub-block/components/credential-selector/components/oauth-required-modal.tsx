'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check } from 'lucide-react'
import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { client } from '@/lib/auth/auth-client'
import {
  getProviderIdFromServiceId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'

const logger = createLogger('OAuthRequiredModal')

export interface OAuthRequiredModalProps {
  isOpen: boolean
  onClose: () => void
  provider: OAuthProvider
  toolName: string
  requiredScopes?: string[]
  serviceId: string
  newScopes?: string[]
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.send': 'Send emails',
  'https://www.googleapis.com/auth/gmail.labels': 'View and manage email labels',
  'https://www.googleapis.com/auth/gmail.modify': 'View and manage email messages',
  'https://www.googleapis.com/auth/drive.file': 'View and manage Google Drive files',
  'https://www.googleapis.com/auth/drive': 'Access all Google Drive files',
  'https://www.googleapis.com/auth/calendar': 'View and manage calendar',
  'https://www.googleapis.com/auth/userinfo.email': 'View email address',
  'https://www.googleapis.com/auth/userinfo.profile': 'View basic profile info',
  'https://www.googleapis.com/auth/forms.body': 'View and manage Google Forms',
  'https://www.googleapis.com/auth/forms.responses.readonly': 'View responses to Google Forms',
  'https://www.googleapis.com/auth/ediscovery': 'Access Google Vault for eDiscovery',
  'https://www.googleapis.com/auth/devstorage.read_only': 'Read files from Google Cloud Storage',
  'https://www.googleapis.com/auth/admin.directory.group': 'Manage Google Workspace groups',
  'https://www.googleapis.com/auth/admin.directory.group.member':
    'Manage Google Workspace group memberships',
  'https://www.googleapis.com/auth/admin.directory.group.readonly': 'View Google Workspace groups',
  'https://www.googleapis.com/auth/admin.directory.group.member.readonly':
    'View Google Workspace group memberships',
  'https://www.googleapis.com/auth/cloud-platform':
    'Full access to Google Cloud resources for Vertex AI',
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
  'read:me': 'Read profile information',
  'database.read': 'Read database',
  'database.write': 'Write to database',
  'projects.read': 'Read projects',
  offline_access: 'Access account when not using the application',
  repo: 'Access repositories',
  workflow: 'Manage repository workflows',
  'read:user': 'Read public user information',
  'user:email': 'Access email address',
  'tweet.read': 'Read tweets and timeline',
  'tweet.write': 'Post tweets',
  'users.read': 'Read profile information',
  'offline.access': 'Access account when not using the application',
  'data.records:read': 'Read records',
  'data.records:write': 'Write to records',
  'webhook:manage': 'Manage webhooks',
  'page.read': 'Read Notion pages',
  'page.write': 'Write to Notion pages',
  'workspace.content': 'Read Notion content',
  'workspace.name': 'Read Notion workspace name',
  'workspace.read': 'Read Notion workspace',
  'workspace.write': 'Write to Notion workspace',
  'user.email:read': 'Read email address',
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
  'delete:attachment:jira': 'Delete attachments from Jira issues',
  'write:issue-worklog:jira': 'Add and update worklog entries on Jira issues',
  'read:issue-worklog:jira': 'Read worklog entries from Jira issues',
  'delete:issue-worklog:jira': 'Delete worklog entries from Jira issues',
  'write:issue-link:jira': 'Create links between Jira issues',
  'delete:issue-link:jira': 'Delete links between Jira issues',
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
  'Group.ReadWrite.All': 'Write to Microsoft groups',
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
  openid: 'Standard authentication',
  profile: 'Access profile information',
  email: 'Access email address',
  identify: 'Read Discord user',
  bot: 'Read Discord bot',
  'messages.read': 'Read Discord messages',
  guilds: 'Read Discord guilds',
  'guilds.members.read': 'Read Discord guild members',
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
  login: 'Access Wealthbox account',
  data: 'Access Wealthbox data',
  read: 'Read access to workspace',
  write: 'Write access to Linear workspace',
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
  'files:write': 'Upload files',
  'files:read': 'Download and read files',
  'canvases:write': 'Create canvas documents',
  'reactions:write': 'Add emoji reactions to messages',
  'sites:read': 'View Webflow sites',
  'sites:write': 'Manage webhooks and site settings',
  'cms:read': 'View CMS content',
  'cms:write': 'Manage CMS content',
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
  tickets: 'Manage HubSpot tickets',
  api: 'Access Salesforce API',
  refresh_token: 'Maintain long-term access to Salesforce account',
  default: 'Access Asana workspace',
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
  w_member_social: 'Access LinkedIn profile',
  // Box scopes
  root_readwrite: 'Read and write all files and folders in Box account',
  root_readonly: 'Read all files and folders in Box account',
  // Shopify scopes (write_* implicitly includes read access)
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
}

function getScopeDescription(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope] || scope
}

export function OAuthRequiredModal({
  isOpen,
  onClose,
  provider,
  toolName,
  requiredScopes = [],
  serviceId,
  newScopes = [],
}: OAuthRequiredModalProps) {
  const [error, setError] = useState<string | null>(null)
  const { baseProvider } = parseProvider(provider)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  let providerName = baseProviderConfig?.name || provider
  let ProviderIcon = baseProviderConfig?.icon || (() => null)

  if (baseProviderConfig) {
    for (const [key, service] of Object.entries(baseProviderConfig.services)) {
      if (key === serviceId || service.providerId === provider) {
        providerName = service.name
        ProviderIcon = service.icon
        break
      }
    }
  }

  const newScopesSet = useMemo(
    () =>
      new Set(
        (newScopes || []).filter(
          (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
        )
      ),
    [newScopes]
  )

  const displayScopes = useMemo(() => {
    const filtered = requiredScopes.filter(
      (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
    )
    return filtered.sort((a, b) => {
      const aIsNew = newScopesSet.has(a)
      const bIsNew = newScopesSet.has(b)
      if (aIsNew && !bIsNew) return -1
      if (!aIsNew && bIsNew) return 1
      return 0
    })
  }, [requiredScopes, newScopesSet])

  const handleConnectDirectly = async () => {
    setError(null)

    try {
      const providerId = getProviderIdFromServiceId(serviceId)

      logger.info('Linking OAuth2:', {
        providerId,
        requiredScopes,
        hasNewScopes: newScopes.length > 0,
      })

      if (providerId === 'trello') {
        onClose()
        window.location.href = '/api/auth/trello/authorize'
        return
      }

      if (providerId === 'shopify') {
        onClose()
        const returnUrl = encodeURIComponent(window.location.href)
        window.location.href = `/api/auth/shopify/authorize?returnUrl=${returnUrl}`
        return
      }

      await client.oauth2.link({
        providerId,
        callbackURL: window.location.href,
      })
      onClose()
    } catch (err) {
      logger.error('Error initiating OAuth flow:', { error: err })
      setError('Failed to connect. Please try again.')
    }
  }

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent size='md'>
        <ModalHeader>Connect {providerName}</ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-[16px]'>
            <div className='flex items-center gap-[14px]'>
              <div className='flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-5)]'>
                <ProviderIcon className='h-[18px] w-[18px]' />
              </div>
              <div className='flex-1'>
                <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Connect your {providerName} account
                </p>
                <p className='text-[12px] text-[var(--text-tertiary)]'>
                  The "{toolName}" tool requires access to your account
                </p>
              </div>
            </div>

            {displayScopes.length > 0 && (
              <div className='rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
                <div className='border-[var(--border-1)] border-b px-[14px] py-[10px]'>
                  <h4 className='font-medium text-[12px] text-[var(--text-primary)]'>
                    Permissions requested
                  </h4>
                </div>
                <ul className='max-h-[330px] space-y-[10px] overflow-y-auto px-[14px] py-[12px]'>
                  {displayScopes.map((scope) => (
                    <li key={scope} className='flex items-start gap-[10px]'>
                      <div className='mt-[2px] flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                        <Check className='h-[10px] w-[10px] text-[var(--text-primary)]' />
                      </div>
                      <div className='flex flex-1 items-center gap-[8px] text-[12px] text-[var(--text-primary)]'>
                        <span>{getScopeDescription(scope)}</span>
                        {newScopesSet.has(scope) && (
                          <Badge variant='amber' size='sm'>
                            New
                          </Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className='text-[12px] text-[var(--text-error)]'>{error}</p>}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={onClose}>
            Cancel
          </Button>
          <Button variant='tertiary' type='button' onClick={handleConnectDirectly}>
            Connect
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
