'use client'

import { Check } from 'lucide-react'
import { Button } from '@/components/emcn/components/button/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
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
  serviceId?: string
  newScopes?: string[]
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.send': 'Send emails on your behalf',
  'https://www.googleapis.com/auth/gmail.labels': 'View and manage your email labels',
  'https://www.googleapis.com/auth/gmail.modify': 'View and manage your email messages',
  'https://www.googleapis.com/auth/drive.readonly': 'View and read your Google Drive files',
  'https://www.googleapis.com/auth/drive.file': 'View and manage your Google Drive files',
  'https://www.googleapis.com/auth/calendar': 'View and manage your calendar',
  'https://www.googleapis.com/auth/userinfo.email': 'View your email address',
  'https://www.googleapis.com/auth/userinfo.profile': 'View your basic profile info',
  'https://www.googleapis.com/auth/forms.responses.readonly': 'View responses to your Google Forms',
  'https://www.googleapis.com/auth/ediscovery': 'Access Google Vault for eDiscovery',
  'https://www.googleapis.com/auth/devstorage.read_only': 'Read files from Google Cloud Storage',
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
  'read:me': 'Read your profile information',
  'database.read': 'Read your database',
  'database.write': 'Write to your database',
  'projects.read': 'Read your projects',
  offline_access: 'Access your account when you are not using the application',
  repo: 'Access your repositories',
  workflow: 'Manage repository workflows',
  'read:user': 'Read your public user information',
  'user:email': 'Access your email address',
  'tweet.read': 'Read your tweets and timeline',
  'tweet.write': 'Post tweets on your behalf',
  'users.read': 'Read your profile information',
  'offline.access': 'Access your account when you are not using the application',
  'data.records:read': 'Read your records',
  'data.records:write': 'Write to your records',
  'webhook:manage': 'Manage your webhooks',
  'page.read': 'Read your Notion pages',
  'page.write': 'Write to your Notion pages',
  'workspace.content': 'Read your Notion content',
  'workspace.name': 'Read your Notion workspace name',
  'workspace.read': 'Read your Notion workspace',
  'workspace.write': 'Write to your Notion workspace',
  'user.email:read': 'Read your email address',
  'read:jira-user': 'Read your Jira user',
  'read:jira-work': 'Read your Jira work',
  'write:jira-work': 'Write to your Jira work',
  'manage:jira-webhook': 'Register and manage Jira webhooks',
  'read:webhook:jira': 'View Jira webhooks',
  'write:webhook:jira': 'Create and update Jira webhooks',
  'delete:webhook:jira': 'Delete Jira webhooks',
  'read:issue-event:jira': 'Read your Jira issue events',
  'write:issue:jira': 'Write to your Jira issues',
  'read:project:jira': 'Read your Jira projects',
  'read:issue-type:jira': 'Read your Jira issue types',
  'read:issue-meta:jira': 'Read your Jira issue meta',
  'read:issue-security-level:jira': 'Read your Jira issue security level',
  'read:issue.vote:jira': 'Read your Jira issue votes',
  'read:issue.changelog:jira': 'Read your Jira issue changelog',
  'read:avatar:jira': 'Read your Jira avatar',
  'read:issue:jira': 'Read your Jira issues',
  'read:status:jira': 'Read your Jira status',
  'read:user:jira': 'Read your Jira user',
  'read:field-configuration:jira': 'Read your Jira field configuration',
  'read:issue-details:jira': 'Read your Jira issue details',
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
  'User.Read': 'Read your Microsoft user',
  'Chat.Read': 'Read your Microsoft chats',
  'Chat.ReadWrite': 'Write to your Microsoft chats',
  'Chat.ReadBasic': 'Read your Microsoft chats',
  'ChatMessage.Send': 'Send chat messages on your behalf',
  'Channel.ReadBasic.All': 'Read your Microsoft channels',
  'ChannelMessage.Send': 'Write to your Microsoft channels',
  'ChannelMessage.Read.All': 'Read your Microsoft channels',
  'ChannelMessage.ReadWrite': 'Read and write to your Microsoft channels',
  'ChannelMember.Read.All': 'Read team channel members',
  'Group.Read.All': 'Read your Microsoft groups',
  'Group.ReadWrite.All': 'Write to your Microsoft groups',
  'Team.ReadBasic.All': 'Read your Microsoft teams',
  'TeamMember.Read.All': 'Read team members',
  'Mail.ReadWrite': 'Write to your Microsoft emails',
  'Mail.ReadBasic': 'Read your Microsoft emails',
  'Mail.Read': 'Read your Microsoft emails',
  'Mail.Send': 'Send emails on your behalf',
  'Files.Read': 'Read your OneDrive files',
  'Files.ReadWrite': 'Read and write your OneDrive files',
  'Tasks.ReadWrite': 'Read and manage your Planner tasks',
  'Sites.Read.All': 'Read Sharepoint sites',
  'Sites.ReadWrite.All': 'Read and write Sharepoint sites',
  'Sites.Manage.All': 'Manage Sharepoint sites',
  openid: 'Standard authentication',
  profile: 'Access your profile information',
  email: 'Access your email address',
  identify: 'Read your Discord user',
  bot: 'Read your Discord bot',
  'messages.read': 'Read your Discord messages',
  guilds: 'Read your Discord guilds',
  'guilds.members.read': 'Read your Discord guild members',
  identity: 'Access your Reddit identity',
  submit: 'Submit posts and comments on your behalf',
  vote: 'Vote on posts and comments',
  save: 'Save and unsave posts and comments',
  edit: 'Edit your posts and comments',
  subscribe: 'Subscribe and unsubscribe from subreddits',
  history: 'Access your Reddit history',
  privatemessages: 'Access your inbox and send private messages',
  account: 'Update your account preferences and settings',
  mysubreddits: 'Access your subscribed and moderated subreddits',
  flair: 'Manage user and post flair',
  report: 'Report posts and comments for rule violations',
  modposts: 'Approve, remove, and moderate posts in subreddits you moderate',
  modflair: 'Manage flair in subreddits you moderate',
  modmail: 'Access and respond to moderator mail',
  login: 'Access your Wealthbox account',
  data: 'Access your Wealthbox data',
  read: 'Read access to your workspace',
  write: 'Write access to your Linear workspace',
  'channels:read': 'View public channels',
  'channels:history': 'Read channel messages',
  'groups:read': 'View private channels',
  'groups:history': 'Read private messages',
  'chat:write': 'Send messages',
  'chat:write.public': 'Post to public channels',
  'users:read': 'View workspace users',
  'files:write': 'Upload files',
  'files:read': 'Download and read files',
  'canvases:write': 'Create canvas documents',
  'reactions:write': 'Add emoji reactions to messages',
  'sites:read': 'View your Webflow sites',
  'sites:write': 'Manage webhooks and site settings',
  'cms:read': 'View your CMS content',
  'cms:write': 'Manage your CMS content',
  'crm.objects.contacts.read': 'Read your HubSpot contacts',
  'crm.objects.contacts.write': 'Create and update HubSpot contacts',
  'crm.objects.companies.read': 'Read your HubSpot companies',
  'crm.objects.companies.write': 'Create and update HubSpot companies',
  'crm.objects.deals.read': 'Read your HubSpot deals',
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
  refresh_token: 'Maintain long-term access to your Salesforce account',
  default: 'Access your Asana workspace',
  base: 'Basic access to your Pipedrive account',
  'deals:read': 'Read your Pipedrive deals',
  'deals:full': 'Full access to manage your Pipedrive deals',
  'contacts:read': 'Read your Pipedrive contacts',
  'contacts:full': 'Full access to manage your Pipedrive contacts',
  'leads:read': 'Read your Pipedrive leads',
  'leads:full': 'Full access to manage your Pipedrive leads',
  'activities:read': 'Read your Pipedrive activities',
  'activities:full': 'Full access to manage your Pipedrive activities',
  'mail:read': 'Read your Pipedrive emails',
  'mail:full': 'Full access to manage your Pipedrive emails',
  'projects:read': 'Read your Pipedrive projects',
  'projects:full': 'Full access to manage your Pipedrive projects',
  'webhooks:read': 'Read your Pipedrive webhooks',
  'webhooks:full': 'Full access to manage your Pipedrive webhooks',
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
  const effectiveServiceId = serviceId || getServiceIdFromScopes(provider, requiredScopes)
  const { baseProvider } = parseProvider(provider)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  let providerName = baseProviderConfig?.name || provider
  let ProviderIcon = baseProviderConfig?.icon || (() => null)

  if (baseProviderConfig) {
    for (const service of Object.values(baseProviderConfig.services)) {
      if (service.id === effectiveServiceId || service.providerId === provider) {
        providerName = service.name
        ProviderIcon = service.icon
        break
      }
    }
  }

  const displayScopes = requiredScopes.filter(
    (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
  )
  const newScopesSet = new Set(
    (newScopes || []).filter(
      (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
    )
  )

  const handleConnectDirectly = async () => {
    try {
      const providerId = getProviderIdFromServiceId(effectiveServiceId)

      onClose()

      logger.info('Linking OAuth2:', {
        providerId,
        requiredScopes,
      })

      if (providerId === 'trello') {
        window.location.href = '/api/auth/trello/authorize'
        return
      }

      await client.oauth2.link({
        providerId,
        callbackURL: window.location.href,
      })
    } catch (error) {
      logger.error('Error initiating OAuth flow:', { error })
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Additional Access Required</DialogTitle>
          <DialogDescription>
            The "{toolName}" tool requires access to your {providerName} account to function
            properly.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4 py-4'>
          <div className='flex items-center gap-4'>
            <div className='rounded-full bg-muted p-2'>
              <ProviderIcon className='h-5 w-5' />
            </div>
            <div className='flex-1'>
              <p className='font-medium text-sm'>Connect {providerName}</p>
              <p className='text-muted-foreground text-sm'>
                You need to connect your {providerName} account to continue
              </p>
            </div>
          </div>

          {displayScopes.length > 0 && (
            <div className='rounded-md border bg-muted/50'>
              <div className='border-b px-4 py-3'>
                <h4 className='font-medium text-sm'>Permissions requested</h4>
              </div>
              <ul className='max-h-[400px] space-y-3 overflow-y-auto px-4 py-3'>
                {displayScopes.map((scope) => (
                  <li key={scope} className='flex items-start gap-2 text-sm'>
                    <div className='mt-1 rounded-full bg-muted p-0.5'>
                      <Check className='h-3 w-3' />
                    </div>
                    <div className='text-muted-foreground'>
                      <span>{getScopeDescription(scope)}</span>
                      {newScopesSet.has(scope) && (
                        <span className='ml-2 rounded-[4px] border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300'>
                          New
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter className='flex flex-col gap-2 sm:flex-row'>
          <Button variant='outline' onClick={onClose} className='sm:order-1'>
            Cancel
          </Button>
          <Button
            variant='primary'
            type='button'
            onClick={handleConnectDirectly}
            className='sm:order-3'
          >
            Connect Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
