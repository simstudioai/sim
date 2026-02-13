import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Combobox } from '@/components/emcn/components'
import { writePendingCredentialCreateRequest } from '@/lib/credentials/client-state'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  getServiceConfigByProviderId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type OAuthService,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { getMissingRequiredScopes } from '@/hooks/use-oauth-scope-status'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const getProviderIcon = (providerName: OAuthProvider) => {
  const { baseProvider } = parseProvider(providerName)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  if (!baseProviderConfig) {
    return <ExternalLink className='h-3 w-3' />
  }
  return createElement(baseProviderConfig.icon, { className: 'h-3 w-3' })
}

const getProviderName = (providerName: OAuthProvider) => {
  const serviceConfig = getServiceConfigByProviderId(providerName)
  if (serviceConfig) {
    return serviceConfig.name
  }

  const { baseProvider } = parseProvider(providerName)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  if (baseProviderConfig) {
    return baseProviderConfig.name
  }

  return providerName
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

interface ToolCredentialSelectorProps {
  value: string
  onChange: (value: string) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  serviceId: OAuthService
  disabled?: boolean
}

export function ToolCredentialSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label,
  serviceId,
  disabled = false,
}: ToolCredentialSelectorProps) {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [editingInputValue, setEditingInputValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const { activeWorkflowId } = useWorkflowRegistry()

  const selectedId = value || ''
  const effectiveLabel = label || `Select ${getProviderName(provider)} account`

  const effectiveProviderId = useMemo(() => getProviderIdFromServiceId(serviceId), [serviceId])

  const {
    data: credentials = [],
    isFetching: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(effectiveProviderId, {
    enabled: Boolean(effectiveProviderId),
    workspaceId,
    workflowId: activeWorkflowId || undefined,
  })

  const selectedCredential = useMemo(
    () => credentials.find((cred) => cred.id === selectedId),
    [credentials, selectedId]
  )

  const [inaccessibleCredentialName, setInaccessibleCredentialName] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId || selectedCredential || credentialsLoading || !workspaceId) {
      setInaccessibleCredentialName(null)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(
          `/api/credentials?workspaceId=${encodeURIComponent(workspaceId)}&credentialId=${encodeURIComponent(selectedId)}`
        )
        if (!response.ok || cancelled) return
        const data = await response.json()
        if (!cancelled && data.credential?.displayName) {
          setInaccessibleCredentialName(data.credential.displayName)
        }
      } catch {
        // Ignore fetch errors
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedId, selectedCredential, credentialsLoading, workspaceId])

  const resolvedLabel = useMemo(() => {
    if (selectedCredential) return selectedCredential.name
    if (inaccessibleCredentialName) return inaccessibleCredentialName
    return ''
  }, [selectedCredential, inaccessibleCredentialName, selectedId, credentialsLoading])

  const inputValue = isEditing ? editingInputValue : resolvedLabel

  useCredentialRefreshTriggers(refetchCredentials, effectiveProviderId, workspaceId)

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        void refetchCredentials()
      }
    },
    [refetchCredentials]
  )

  const hasSelection = Boolean(selectedCredential)
  const missingRequiredScopes = hasSelection
    ? getMissingRequiredScopes(selectedCredential!, requiredScopes || [])
    : []

  const needsUpdate =
    hasSelection && missingRequiredScopes.length > 0 && !disabled && !credentialsLoading

  const handleSelect = useCallback(
    (credentialId: string) => {
      onChange(credentialId)
      setIsEditing(false)
    },
    [onChange]
  )

  const handleAddCredential = useCallback(() => {
    writePendingCredentialCreateRequest({
      workspaceId,
      type: 'oauth',
      providerId: effectiveProviderId,
      displayName: '',
      serviceId,
      requiredScopes: getCanonicalScopesForProvider(effectiveProviderId),
      requestedAt: Date.now(),
    })

    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'credentials' } }))
  }, [workspaceId, effectiveProviderId, serviceId])

  const comboboxOptions = useMemo(() => {
    const options = credentials.map((cred) => ({
      label: cred.name,
      value: cred.id,
    }))

    options.push({
      label:
        credentials.length > 0
          ? `Connect another ${getProviderName(provider)} account`
          : `Connect ${getProviderName(provider)} account`,
      value: '__connect_account__',
    })

    return options
  }, [credentials, provider])

  const selectedCredentialProvider = selectedCredential?.provider ?? provider

  const overlayContent = useMemo(() => {
    if (!inputValue) return null

    return (
      <div className='flex w-full items-center truncate'>
        <div className='mr-2 flex-shrink-0 opacity-90'>
          {getProviderIcon(selectedCredentialProvider)}
        </div>
        <span className='truncate'>{inputValue}</span>
      </div>
    )
  }, [inputValue, selectedCredentialProvider])

  const handleComboboxChange = useCallback(
    (newValue: string) => {
      if (newValue === '__connect_account__') {
        handleAddCredential()
        return
      }

      const matchedCred = credentials.find((c) => c.id === newValue)
      if (matchedCred) {
        handleSelect(newValue)
        return
      }

      setIsEditing(true)
      setEditingInputValue(newValue)
    },
    [credentials, handleAddCredential, handleSelect]
  )

  return (
    <div>
      <Combobox
        options={comboboxOptions}
        value={inputValue}
        selectedValue={selectedId}
        onChange={handleComboboxChange}
        onOpenChange={handleOpenChange}
        placeholder={effectiveLabel}
        disabled={disabled}
        editable={true}
        filterOptions={true}
        isLoading={credentialsLoading}
        overlayContent={overlayContent}
        className={selectedId ? 'pl-[28px]' : ''}
      />

      {needsUpdate && (
        <div className='mt-[8px] flex flex-col gap-[4px] rounded-[4px] border bg-[var(--surface-2)] px-[8px] py-[6px]'>
          <div className='flex items-center font-medium text-[12px]'>
            <span className='mr-[6px] inline-block h-[6px] w-[6px] rounded-[2px] bg-amber-500' />
            Additional permissions required
          </div>
          <Button
            variant='active'
            onClick={() => setShowOAuthModal(true)}
            className='w-full px-[8px] py-[4px] font-medium text-[12px]'
          >
            Update access
          </Button>
        </div>
      )}

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={provider}
          toolName={getProviderName(provider)}
          requiredScopes={getCanonicalScopesForProvider(effectiveProviderId)}
          newScopes={missingRequiredScopes}
          serviceId={serviceId}
        />
      )}
    </div>
  )
}

function useCredentialRefreshTriggers(
  refetchCredentials: () => Promise<unknown>,
  providerId: string,
  workspaceId: string
) {
  useEffect(() => {
    const refresh = () => {
      void refetchCredentials()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }

    const handlePageShow = (event: Event) => {
      if ('persisted' in event && (event as PageTransitionEvent).persisted) {
        refresh()
      }
    }

    const handleCredentialsUpdated = (
      event: CustomEvent<{ providerId?: string; workspaceId?: string }>
    ) => {
      if (event.detail?.providerId && event.detail.providerId !== providerId) {
        return
      }
      if (event.detail?.workspaceId && workspaceId && event.detail.workspaceId !== workspaceId) {
        return
      }
      refresh()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('oauth-credentials-updated', handleCredentialsUpdated as EventListener)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener(
        'oauth-credentials-updated',
        handleCredentialsUpdated as EventListener
      )
    }
  }, [providerId, workspaceId, refetchCredentials])
}
