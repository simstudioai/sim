'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { client } from '@/lib/auth/auth-client'
import { writeOAuthReturnContext } from '@/lib/credentials/client-state'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { getScopeDescription } from '@/lib/oauth/utils'
import { useCreateCredentialDraft } from '@/hooks/queries/credentials'

const logger = createLogger('ConnectCredentialModal')

export interface ConnectCredentialModalProps {
  isOpen: boolean
  onClose: () => void
  provider: OAuthProvider
  serviceId: string
  workspaceId: string
  workflowId: string
  /** Number of existing credentials for this provider — used to detect a successful new connection. */
  credentialCount: number
}

export function ConnectCredentialModal({
  isOpen,
  onClose,
  provider,
  serviceId,
  workspaceId,
  workflowId,
  credentialCount,
}: ConnectCredentialModalProps) {
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createDraft = useCreateCredentialDraft()

  const { providerName, ProviderIcon } = useMemo(() => {
    const { baseProvider } = parseProvider(provider)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]
    let name = baseProviderConfig?.name || provider
    let Icon = baseProviderConfig?.icon || (() => null)
    if (baseProviderConfig) {
      for (const [key, service] of Object.entries(baseProviderConfig.services)) {
        if (key === serviceId || service.providerId === provider) {
          name = service.name
          Icon = service.icon
          break
        }
      }
    }
    return { providerName: name, ProviderIcon: Icon }
  }, [provider, serviceId])

  const providerId = getProviderIdFromServiceId(serviceId)

  const displayScopes = useMemo(
    () =>
      getCanonicalScopesForProvider(providerId).filter(
        (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
      ),
    [providerId]
  )

  const handleClose = () => {
    setDisplayName('')
    setError(null)
    onClose()
  }

  const handleConnect = async () => {
    const trimmedName = displayName.trim()
    if (!trimmedName) {
      setError('Display name is required.')
      return
    }

    setError(null)

    try {
      await createDraft.mutateAsync({ workspaceId, providerId, displayName: trimmedName })

      writeOAuthReturnContext({
        origin: 'workflow',
        workflowId,
        displayName: trimmedName,
        providerId,
        preCount: credentialCount,
        workspaceId,
        requestedAt: Date.now(),
      })

      if (providerId === 'trello') {
        window.location.href = '/api/auth/trello/authorize'
        return
      }

      if (providerId === 'shopify') {
        const returnUrl = encodeURIComponent(window.location.href)
        window.location.href = `/api/auth/shopify/authorize?returnUrl=${returnUrl}`
        return
      }

      await client.oauth2.link({ providerId, callbackURL: window.location.href })
      handleClose()
    } catch (err) {
      logger.error('Failed to initiate OAuth connection', { error: err })
      setError('Failed to connect. Please try again.')
    }
  }

  const isPending = createDraft.isPending

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <ModalContent size='md'>
        <ModalHeader>Connect {providerName}</ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-4'>
            <div className='flex items-center gap-3'>
              <div className='flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-5)]'>
                <ProviderIcon className='h-[18px] w-[18px]' />
              </div>
              <div>
                <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                  Connect your {providerName} account
                </p>
                <p className='text-[12px] text-[var(--text-tertiary)]'>
                  Grant access to use {providerName} in your workflow
                </p>
              </div>
            </div>

            {displayScopes.length > 0 && (
              <div className='rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
                <div className='border-[var(--border-1)] border-b px-3.5 py-2.5'>
                  <h4 className='font-medium text-[12px] text-[var(--text-primary)]'>
                    Permissions requested
                  </h4>
                </div>
                <ul className='max-h-[200px] space-y-2.5 overflow-y-auto px-3.5 py-3'>
                  {displayScopes.map((scope) => (
                    <li key={scope} className='flex items-start gap-2.5'>
                      <div className='mt-0.5 flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                        <Check className='h-[10px] w-[10px] text-[var(--text-primary)]' />
                      </div>
                      <div className='flex flex-1 items-center gap-2 text-[12px] text-[var(--text-primary)]'>
                        <span>{getScopeDescription(scope)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <Label>
                Display name <span className='text-[var(--text-muted)]'>*</span>
              </Label>
              <Input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isPending) void handleConnect()
                }}
                placeholder={`My ${providerName} account`}
                autoComplete='off'
                data-lpignore='true'
                className='mt-1.5'
              />
            </div>

            {error && <p className='text-[12px] text-[var(--text-error)]'>{error}</p>}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant='primary'
            onClick={handleConnect}
            disabled={!displayName.trim() || isPending}
          >
            {isPending ? 'Connecting...' : 'Connect'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
