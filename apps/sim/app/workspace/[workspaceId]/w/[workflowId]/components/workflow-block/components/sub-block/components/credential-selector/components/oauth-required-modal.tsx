'use client'

import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { client } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
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
}

// Map of OAuth scopes to user-friendly descriptions
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.send': 'Send emails on your behalf',
  'https://www.googleapis.com/auth/gmail.labels': 'View and manage your email labels',
  'https://www.googleapis.com/auth/gmail.modify': 'View and manage your email messages',
  // 'https://www.googleapis.com/auth/gmail.readonly': 'View and read your email messages',
  // 'https://www.googleapis.com/auth/drive': 'View and manage your Google Drive files',
  'https://www.googleapis.com/auth/drive.file': 'View and manage your Google Drive files',
  // 'https://www.googleapis.com/auth/documents': 'View and manage your Google Docs',
  'https://www.googleapis.com/auth/calendar': 'View and manage your calendar',
  'https://www.googleapis.com/auth/userinfo.email': 'View your email address',
  'https://www.googleapis.com/auth/userinfo.profile': 'View your basic profile info',
  'https://www.googleapis.com/auth/spreadsheets': 'View and manage your Google Sheets',
  'read:page:confluence': 'Read Confluence pages',
  'write:page:confluence': 'Write Confluence pages',
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
  'User.Read': 'Read your Microsoft user',
  'Chat.Read': 'Read your Microsoft chats',
  'Chat.ReadWrite': 'Write to your Microsoft chats',
  'Chat.ReadBasic': 'Read your Microsoft chats',
  'Channel.ReadBasic.All': 'Read your Microsoft channels',
  'ChannelMessage.Send': 'Write to your Microsoft channels',
  'ChannelMessage.Read.All': 'Read your Microsoft channels',
  'Group.Read.All': 'Read your Microsoft groups',
  'Group.ReadWrite.All': 'Write to your Microsoft groups',
  'Team.ReadBasic.All': 'Read your Microsoft teams',
  'Mail.ReadWrite': 'Write to your Microsoft emails',
  'Mail.ReadBasic': 'Read your Microsoft emails',
  'Mail.Read': 'Read your Microsoft emails',
  'Mail.Send': 'Send emails on your behalf',
  identify: 'Read your Discord user',
  bot: 'Read your Discord bot',
  'messages.read': 'Read your Discord messages',
  guilds: 'Read your Discord guilds',
  'guilds.members.read': 'Read your Discord guild members',
  read: 'Read access to your workspace',
  write: 'Write access to your Linear workspace',
  'channels:read': 'Read your Slack channels',
  'groups:read': 'Read your Slack private channels',
  'chat:write': 'Write to your invited Slack channels',
  'chat:write.public': 'Write to your public Slack channels',
  'users:read': 'Read your Slack users',
  'search:read': 'Read your Slack search',
  'files:read': 'Read your Slack files',
  'links:read': 'Read your Slack links',
  'links:write': 'Write to your Slack links',
}

// Convert OAuth scope to user-friendly description
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
}: OAuthRequiredModalProps) {
  // Get provider configuration and service
  const effectiveServiceId = serviceId || getServiceIdFromScopes(provider, requiredScopes)
  const { baseProvider } = parseProvider(provider)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  // Default to base provider name and icon
  let providerName = baseProviderConfig?.name || provider
  let ProviderIcon = baseProviderConfig?.icon || (() => null)

  // Try to find the specific service
  if (baseProviderConfig) {
    for (const service of Object.values(baseProviderConfig.services)) {
      if (service.id === effectiveServiceId || service.providerId === provider) {
        providerName = service.name
        ProviderIcon = service.icon
        break
      }
    }
  }

  // Filter out userinfo scopes as they're not relevant to show to users
  const displayScopes = requiredScopes.filter(
    (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
  )

  const handleConnectDirectly = async () => {
    try {
      // Determine the appropriate serviceId and providerId
      const providerId = getProviderIdFromServiceId(effectiveServiceId)

      // Close the modal
      onClose()

      logger.info('Linking OAuth2:', {
        providerId,
        requiredScopes,
      })

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
              <ul className='space-y-3 px-4 py-3'>
                {displayScopes.map((scope) => (
                  <li key={scope} className='flex items-start gap-2 text-sm'>
                    <div className='mt-1 rounded-full bg-muted p-0.5'>
                      <Check className='h-3 w-3' />
                    </div>
                    <span className='text-muted-foreground'>{getScopeDescription(scope)}</span>
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
          <Button type='button' onClick={handleConnectDirectly} className='sm:order-3'>
            Connect Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
