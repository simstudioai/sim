'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check } from 'lucide-react'
import {
  Badge,
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { client, useSession } from '@/lib/auth/auth-client'
import type { OAuthReturnContext } from '@/lib/credentials/client-state'
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

const logger = createLogger('OAuthModal')
const EMPTY_SCOPES: string[] = []

/**
 * Generates a default credential display name.
 * Format: "{User}'s {Provider} {N}" or "My {Provider} {N}" when no user name is available.
 */
export function getDefaultCredentialName(
  userName: string | null | undefined,
  providerName: string,
  credentialCount: number
): string {
  const trimmed = userName?.trim()
  const num = credentialCount + 1
  if (trimmed) {
    return `${trimmed}'s ${providerName} ${num}`
  }
  return `My ${providerName} ${num}`
}

interface OAuthModalBaseProps {
  isOpen: boolean
  onClose: () => void
  provider: OAuthProvider
  serviceId: string
}

type OAuthModalConnectProps = OAuthModalBaseProps & {
  mode: 'connect'
  workspaceId: string
  credentialCount: number
} & (
    | { workflowId: string; knowledgeBaseId?: never }
    | { workflowId?: never; knowledgeBaseId: string }
  )

interface OAuthModalReauthorizeProps extends OAuthModalBaseProps {
  mode: 'reauthorize'
  toolName: string
  requiredScopes?: string[]
  newScopes?: string[]
  onConnect?: () => Promise<void> | void
}

export type OAuthModalProps = OAuthModalConnectProps | OAuthModalReauthorizeProps

export function OAuthModal(props: OAuthModalProps) {
  const { isOpen, onClose, provider, serviceId, mode } = props

  const isConnect = mode === 'connect'
  const credentialCount = isConnect ? props.credentialCount : 0
  const workspaceId = isConnect ? props.workspaceId : ''
  const workflowId = isConnect ? props.workflowId : undefined
  const knowledgeBaseId = isConnect ? props.knowledgeBaseId : undefined
  const toolName = !isConnect ? props.toolName : ''
  const requiredScopes = !isConnect ? (props.requiredScopes ?? EMPTY_SCOPES) : EMPTY_SCOPES
  const newScopes = !isConnect ? (props.newScopes ?? EMPTY_SCOPES) : EMPTY_SCOPES
  const onConnectOverride = !isConnect ? props.onConnect : undefined

  const { data: session } = useSession()
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

  const [displayName, setDisplayName] = useState(() =>
    isConnect ? getDefaultCredentialName(session?.user?.name, providerName, credentialCount) : ''
  )

  const newScopesSet = useMemo(
    () =>
      new Set(
        newScopes.filter(
          (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
        )
      ),
    [newScopes]
  )

  const displayScopes = useMemo(() => {
    if (isConnect) {
      return getCanonicalScopesForProvider(providerId).filter(
        (scope) => !scope.includes('userinfo.email') && !scope.includes('userinfo.profile')
      )
    }
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
  }, [isConnect, providerId, requiredScopes, newScopesSet])

  const handleClose = () => {
    setError(null)
    onClose()
  }

  const handleConnect = async () => {
    setError(null)

    try {
      if (isConnect) {
        const trimmedName = displayName.trim()
        if (!trimmedName) {
          setError('Display name is required.')
          return
        }

        await createDraft.mutateAsync({
          workspaceId,
          providerId,
          displayName: trimmedName,
        })

        const baseContext = {
          displayName: trimmedName,
          providerId,
          preCount: credentialCount,
          workspaceId,
          requestedAt: Date.now(),
        }

        const returnContext: OAuthReturnContext = knowledgeBaseId
          ? { ...baseContext, origin: 'kb-connectors' as const, knowledgeBaseId }
          : { ...baseContext, origin: 'workflow' as const, workflowId: workflowId! }

        writeOAuthReturnContext(returnContext)
      }

      if (!isConnect && onConnectOverride) {
        await onConnectOverride()
        onClose()
        return
      }

      if (!isConnect) {
        logger.info('Linking OAuth2:', {
          providerId,
          requiredScopes,
          hasNewScopes: newScopes.length > 0,
        })
      }

      if (providerId === 'trello') {
        if (!isConnect) onClose()
        window.location.href = '/api/auth/trello/authorize'
        return
      }

      if (providerId === 'shopify') {
        if (!isConnect) onClose()
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

  const isPending = isConnect && createDraft.isPending
  const isConnectDisabled = isConnect ? !displayName.trim() || Boolean(isPending) : false

  const subtitle = isConnect
    ? `Grant access to use ${providerName} in your ${knowledgeBaseId ? 'knowledge base' : 'workflow'}`
    : `The "${toolName}" tool requires access to your account`

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <ModalContent size='md'>
        <ModalHeader>Connect {providerName}</ModalHeader>
        <ModalBody>
          <div className='flex flex-col gap-4'>
            <div className='flex items-center gap-3'>
              <div className='flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--surface-5)]'>
                <ProviderIcon className='h-[18px] w-[18px]' />
              </div>
              <div className='flex-1'>
                <p className='font-medium text-[var(--text-primary)] text-small'>
                  Connect your {providerName} account
                </p>
                <p className='text-[var(--text-tertiary)] text-caption'>{subtitle}</p>
              </div>
            </div>

            {displayScopes.length > 0 && (
              <div className='rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)]'>
                <div className='border-[var(--border-1)] border-b px-3.5 py-2.5'>
                  <h4 className='font-medium text-[var(--text-primary)] text-caption'>
                    Permissions requested
                  </h4>
                </div>
                <ul className='max-h-[200px] space-y-2.5 overflow-y-auto px-3.5 py-3'>
                  {displayScopes.map((scope) => (
                    <li key={scope} className='flex items-start gap-2.5'>
                      <div className='mt-0.5 flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                        <Check className='h-[10px] w-[10px] text-[var(--text-primary)]' />
                      </div>
                      <div className='flex flex-1 items-center gap-2 text-[var(--text-primary)] text-caption'>
                        <span>{getScopeDescription(scope)}</span>
                        {!isConnect && newScopesSet.has(scope) && (
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

            {isConnect && (
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
            )}

            {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={handleClose} disabled={Boolean(isPending)}>
            Cancel
          </Button>
          <Button variant='primary' onClick={handleConnect} disabled={isConnectDisabled}>
            {isPending ? 'Connecting...' : 'Connect'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
