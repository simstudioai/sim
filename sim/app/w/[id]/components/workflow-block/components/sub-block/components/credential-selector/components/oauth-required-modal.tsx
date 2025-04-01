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
  OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { saveToStorage } from '@/stores/workflows/persistence'

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
  // 'https://www.googleapis.com/auth/gmail.readonly': 'View and read your email messages',
  // 'https://www.googleapis.com/auth/drive': 'View and manage your Google Drive files',
  'https://www.googleapis.com/auth/drive.file': 'View and manage your Google Drive files',
  // 'https://www.googleapis.com/auth/documents': 'View and manage your Google Docs',
  'https://www.googleapis.com/auth/calendar': 'View and manage your calendar',
  'https://www.googleapis.com/auth/userinfo.email': 'View your email address',
  'https://www.googleapis.com/auth/userinfo.profile': 'View your basic profile info',
  'https://www.googleapis.com/auth/spreadsheets': 'View and manage your Google Sheets',
  'read:confluence-content.all': 'Read Confluence content',
  'read:page:confluence': 'Read Confluence pages',
  'write:confluence-content': 'Write Confluence content',
  'read:me': 'Read your profile information',
  'database.read': 'Read your database',
  'database.write': 'Write to your database',
  'projects.read': 'Read your projects',
  offline_access: 'Access your account when you are not using the application',
  repo: 'Access your repositories',
  workflow: 'Manage repository workflows',
  'user:email': 'Access your email address',
  'tweet.read': 'Read your tweets and timeline',
  'tweet.write': 'Post tweets on your behalf',
  'users.read': 'Read your profile information',
  'offline.access': 'Access your account when you are not using the application',
  'data.records:read': 'Read your records',
  'data.records:write': 'Write to your records',
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

  const handleRedirectToSettings = () => {
    try {
      // Determine the appropriate serviceId and providerId
      const providerId = getProviderIdFromServiceId(effectiveServiceId)

      // Store information about the required connection
      saveToStorage<string>('pending_service_id', effectiveServiceId)
      saveToStorage<string[]>('pending_oauth_scopes', requiredScopes)
      saveToStorage<string>('pending_oauth_return_url', window.location.href)
      saveToStorage<string>('pending_oauth_provider_id', providerId)
      saveToStorage<boolean>('from_oauth_modal', true)

      // Close the modal
      onClose()

      // Open the settings modal with the credentials tab
      const event = new CustomEvent('open-settings', {
        detail: { tab: 'credentials' },
      })
      window.dispatchEvent(event)
    } catch (error) {
      logger.error('Error redirecting to settings:', { error })
    }
  }

  const handleConnectDirectly = async () => {
    try {
      // Determine the appropriate serviceId and providerId
      const providerId = getProviderIdFromServiceId(effectiveServiceId)

      // Store information about the required connection
      saveToStorage<string>('pending_service_id', effectiveServiceId)
      saveToStorage<string[]>('pending_oauth_scopes', requiredScopes)
      saveToStorage<string>('pending_oauth_return_url', window.location.href)
      saveToStorage<string>('pending_oauth_provider_id', providerId)

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Additional Access Required</DialogTitle>
          <DialogDescription>
            The "{toolName}" tool requires access to your {providerName} account to function
            properly.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-muted p-2">
              <ProviderIcon className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Connect {providerName}</p>
              <p className="text-sm text-muted-foreground">
                You need to connect your {providerName} account to continue
              </p>
            </div>
          </div>

          {displayScopes.length > 0 && (
            <div className="rounded-md border bg-muted/50">
              <div className="px-4 py-3 border-b">
                <h4 className="font-medium text-sm">Permissions requested</h4>
              </div>
              <ul className="px-4 py-3 space-y-3">
                {displayScopes.map((scope) => (
                  <li key={scope} className="flex items-start gap-2 text-sm">
                    <div className="mt-1 rounded-full p-0.5 bg-muted">
                      <Check className="h-3 w-3" />
                    </div>
                    <span className="text-muted-foreground">{getScopeDescription(scope)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="sm:order-1">
            Cancel
          </Button>
          <Button type="button" onClick={handleConnectDirectly} className="sm:order-3">
            Connect Now
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleRedirectToSettings}
            className="sm:order-2"
          >
            Go to Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
