'use client'

import { GithubIcon, GoogleIcon, xIcon as XIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { loadFromStorage, saveToStorage } from '@/stores/workflows/persistence'
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
  twitter: 'X (Twitter)',
}

// Map of provider to icons
const PROVIDER_ICONS: Record<OAuthProvider, React.FC<React.SVGProps<SVGSVGElement>>> = {
  github: GithubIcon,
  google: GoogleIcon,
  twitter: XIcon,
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

          {requiredScopes.length > 0 && (
            <details className="text-sm text-muted-foreground rounded-md border p-2">
              <summary className="cursor-pointer font-medium">Permissions requested</summary>
              <ul className="mt-2 pl-4 list-disc space-y-1">
                {requiredScopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            </details>
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
