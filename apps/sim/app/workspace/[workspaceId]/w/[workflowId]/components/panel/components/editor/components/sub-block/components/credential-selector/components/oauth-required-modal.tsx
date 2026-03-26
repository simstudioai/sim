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
  getScopeDescription,
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
  onConnect?: () => Promise<void> | void
}

export function OAuthRequiredModal({
  isOpen,
  onClose,
  provider,
  toolName,
  requiredScopes = [],
  serviceId,
  newScopes = [],
  onConnect,
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
      if (onConnect) {
        await onConnect()
        onClose()
        return
      }

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
                <ul className='max-h-[200px] space-y-[10px] overflow-y-auto px-[14px] py-[12px]'>
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
          <Button variant='primary' type='button' onClick={handleConnectDirectly}>
            Connect
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
