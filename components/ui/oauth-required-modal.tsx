'use client'

import { Check } from 'lucide-react'
import { GithubIcon, GmailIcon, GoogleIcon, xIcon as XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { saveToStorage } from '@/stores/workflows/persistence'
import { OAuthProvider } from '@/tools/types'

export interface OAuthRequiredModalProps {
  isOpen: boolean
  onClose: () => void
  provider: OAuthProvider
  toolName: string
  requiredScopes?: string[]
  serviceId?: string
}

// Map of provider names to friendly display names
const PROVIDER_NAMES: Record<OAuthProvider, string> = {
  github: 'GitHub',
  google: 'Google',
  'google-email': 'Gmail',
  twitter: 'X (Twitter)',
}

// Map of provider to icons
const PROVIDER_ICONS: Record<OAuthProvider, React.FC<React.SVGProps<SVGSVGElement>>> = {
  github: GithubIcon,
  google: GoogleIcon,
  'google-email': GmailIcon,
  twitter: XIcon,
}

// Map of OAuth scopes to user-friendly descriptions
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.send': 'Send emails on your behalf',
  'https://www.googleapis.com/auth/gmail.readonly': 'View and read your email messages',
  'https://www.googleapis.com/auth/drive': 'View and manage your Google Drive files',
  'https://www.googleapis.com/auth/calendar': 'View and manage your calendar',
  'https://www.googleapis.com/auth/userinfo.email': 'View your email address',
  'https://www.googleapis.com/auth/userinfo.profile': 'View your basic profile info',
  repo: 'Access your repositories',
  workflow: 'Manage repository workflows',
  'user:email': 'Access your email address',
  'tweet.read': 'Read your tweets',
  'tweet.write': 'Create tweets on your behalf',
  'users.read': 'Read your profile information',
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
  const providerName = PROVIDER_NAMES[provider] || provider
  const ProviderIcon = PROVIDER_ICONS[provider]

  // Filter out userinfo scopes as they're not relevant to show to users
  const displayScopes = requiredScopes.filter(
    (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
  )

  const handleRedirectToSettings = () => {
    try {
      // Determine the appropriate providerId and serviceId based on the provider and required scopes
      let providerId: string
      let effectiveServiceId = serviceId

      // If no serviceId is provided, determine it based on scopes
      if (!effectiveServiceId) {
        if (provider === 'google') {
          if (requiredScopes.some((scope) => scope.includes('gmail') || scope.includes('mail'))) {
            effectiveServiceId = 'gmail'
            providerId = 'google-email'
          } else if (requiredScopes.some((scope) => scope.includes('drive'))) {
            effectiveServiceId = 'google-drive'
            providerId = 'google-drive'
          } else if (requiredScopes.some((scope) => scope.includes('calendar'))) {
            effectiveServiceId = 'google-calendar'
            providerId = 'google-calendar'
          } else {
            effectiveServiceId = 'gmail' // Default Google service
            providerId = 'google-email'
          }
        } else if (provider === 'github') {
          effectiveServiceId = 'github'
          if (requiredScopes.some((scope) => scope.includes('workflow'))) {
            providerId = 'github-workflow'
          } else {
            providerId = 'github-repo'
          }
        } else if (provider === 'twitter') {
          effectiveServiceId = 'twitter'
          if (requiredScopes.some((scope) => scope.includes('write'))) {
            providerId = 'twitter-write'
          } else {
            providerId = 'twitter-read'
          }
        } else {
          effectiveServiceId = provider
          providerId = `${provider}-default`
        }
      } else {
        // Use the provided serviceId to determine the providerId
        switch (effectiveServiceId) {
          case 'gmail':
            providerId = 'google-email'
            break
          case 'google-drive':
            providerId = 'google-drive'
            break
          case 'github':
            providerId = 'github-repo'
            break
          case 'twitter':
            providerId = 'twitter-read'
            break
          default:
            providerId = `${provider}-default`
        }
      }

      // Store information about the required connection
      saveToStorage('pending_service_id', effectiveServiceId)
      saveToStorage('pending_oauth_scopes', requiredScopes)
      saveToStorage('pending_oauth_return_url', window.location.href)
      saveToStorage('pending_oauth_provider_id', providerId)

      // Close the modal
      onClose()

      // Open the settings modal with the credentials tab
      const event = new CustomEvent('open-settings', {
        detail: { tab: 'credentials' },
      })
      window.dispatchEvent(event)
    } catch (error) {
      console.error('Error redirecting to settings:', error)
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
                You need to connect your {providerName} account in settings
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
        <DialogFooter className="flex space-x-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleRedirectToSettings}>
            Go to Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
