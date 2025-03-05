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
import { client } from '@/lib/auth-client'
import { OAuthProvider } from '@/tools/types'

export interface OAuthRequiredModalProps {
  isOpen: boolean
  onClose: () => void
  provider: OAuthProvider
  toolName: string
  requiredScopes?: string[]
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
}: OAuthRequiredModalProps) {
  const providerName = PROVIDER_NAMES[provider] || provider
  const ProviderIcon = PROVIDER_ICONS[provider]

  const handleAuth = async () => {
    try {
      // Determine the appropriate providerId based on the provider and required scopes
      let featureType = 'default'

      // Simple scope-based feature detection (expand as needed)
      if (requiredScopes.some((scope) => scope.includes('repo'))) {
        featureType = 'repo'
      } else if (requiredScopes.some((scope) => scope.includes('workflow'))) {
        featureType = 'workflow'
      } else if (
        requiredScopes.some((scope) => scope.includes('gmail') || scope.includes('mail'))
      ) {
        featureType = 'email'
      } else if (requiredScopes.some((scope) => scope.includes('calendar'))) {
        featureType = 'calendar'
      } else if (requiredScopes.some((scope) => scope.includes('drive'))) {
        featureType = 'drive'
      } else if (requiredScopes.some((scope) => scope.includes('write'))) {
        featureType = 'write'
      } else if (requiredScopes.some((scope) => scope.includes('read'))) {
        featureType = 'read'
      }

      // Construct the providerId based on the provider and feature type
      const providerId = `${provider}-${featureType}`

      // Begin OAuth flow with the appropriate provider
      await client.signIn.oauth2({
        providerId,
        callbackURL: window.location.href, // Return to the current page after auth
      })
    } catch (error) {
      console.error('OAuth login error:', error)
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
              <p className="text-sm text-muted-foreground">Authorize access to use this tool</p>
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
          <Button type="button" onClick={handleAuth}>
            Connect {providerName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
