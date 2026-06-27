'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  ArrowRight,
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Checkbox,
  ChipCombobox,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  type ComboboxOption,
  Search,
} from '@/components/emcn'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { cn } from '@/lib/core/utils/cn'
import { handleKeyboardActivation } from '@/lib/core/utils/keyboard'
import { consumeOAuthReturnContext } from '@/lib/credentials/client-state'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  type OAuthProvider,
} from '@/lib/oauth'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { ConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields'
import { SYNC_INTERVALS } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import { MaxBadge } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/max-badge'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { getBlock } from '@/blocks'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'

const CONNECTOR_ENTRIES = Object.entries(CONNECTOR_META_REGISTRY)

interface AddConnectorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnectorTypeChange?: (connectorType: string | null) => void
  knowledgeBaseId: string
  initialConnectorType?: string | null
}

type Step = 'select-type' | 'configure'

export function AddConnectorModal({
  open,
  onOpenChange,
  onConnectorTypeChange,
  knowledgeBaseId,
  initialConnectorType,
}: AddConnectorModalProps) {
  const t = useTranslations('auto')
  const [step, setStep] = useState<Step>(() => (initialConnectorType ? 'configure' : 'select-type'))
  const [selectedType, setSelectedType] = useState<string | null>(initialConnectorType ?? null)
  const [syncInterval, setSyncInterval] = useState(1440)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [disabledTagIds, setDisabledTagIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [showOAuthModal, setShowOAuthModal] = useState(false)

  const [apiKeyValue, setApiKeyValue] = useState('')
  const [apiKeyFocused, setApiKeyFocused] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { mutate: createConnector, isPending: isCreating } = useCreateConnector()

  const { data: subscriptionResponse } = useSubscriptionData({ enabled: isBillingEnabled })
  const subscriptionAccess = getSubscriptionAccessState(subscriptionResponse?.data)
  const hasMaxAccess = !isBillingEnabled || subscriptionAccess.hasUsableMaxAccess

  const connectorConfig = selectedType ? CONNECTOR_META_REGISTRY[selectedType] : null
  const isApiKeyMode = connectorConfig?.auth.mode === 'apiKey'
  const connectorProviderId = useMemo(
    () =>
      connectorConfig && connectorConfig.auth.mode === 'oauth'
        ? (getProviderIdFromServiceId(connectorConfig.auth.provider) as OAuthProvider)
        : null,
    [connectorConfig]
  )

  const {
    data: credentials = [],
    isLoading: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(connectorProviderId ?? undefined, {
    enabled: Boolean(connectorConfig) && !isApiKeyMode,
    workspaceId,
  })

  useCredentialRefreshTriggers(refetchCredentials, connectorProviderId ?? '', workspaceId)

  const effectiveCredentialId =
    selectedCredentialId ?? (credentials.length === 1 ? credentials[0].id : null)

  const {
    sourceConfig,
    setSourceConfig,
    canonicalModes,
    setCanonicalModes,
    canonicalGroups,
    isFieldVisible,
    isFieldPopulated,
    handleFieldChange,
    toggleCanonicalMode,
    resolveSourceConfig,
  } = useConnectorConfigFields({ connectorConfig })

  const handleSelectType = (type: string) => {
    setSelectedType(type)
    setSourceConfig({})
    setSelectedCredentialId(null)
    setApiKeyValue('')
    setApiKeyFocused(false)
    setDisabledTagIds(new Set())
    setCanonicalModes({})
    setError(null)
    setSearchTerm('')
    setStep('configure')
    onConnectorTypeChange?.(type)
  }

  const toggleTagDefinition = (tagId: string) => {
    setDisabledTagIds((prev) => {
      const next = new Set(prev)
      if (prev.has(tagId)) {
        next.delete(tagId)
      } else {
        next.add(tagId)
      }
      return next
    })
  }

  const canSubmit = useMemo(() => {
    if (!connectorConfig) return false
    if (isApiKeyMode) {
      if (!apiKeyValue.trim()) return false
    } else {
      if (!effectiveCredentialId) return false
    }

    for (const field of connectorConfig.configFields) {
      if (!field.required) continue
      if (!isFieldVisible(field)) continue
      if (!isFieldPopulated(field)) return false
    }
    return true
  }, [
    connectorConfig,
    isApiKeyMode,
    apiKeyValue,
    effectiveCredentialId,
    isFieldVisible,
    isFieldPopulated,
  ])

  const handleSubmit = () => {
    if (!selectedType || !canSubmit) return

    setError(null)

    const resolvedConfig: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(resolveSourceConfig())) {
      if (Array.isArray(value)) {
        if (value.length > 0) resolvedConfig[key] = value
      } else if (typeof value === 'string') {
        if (value) resolvedConfig[key] = value
      } else if (value !== undefined && value !== null) {
        resolvedConfig[key] = value
      }
    }
    if (disabledTagIds.size > 0) {
      resolvedConfig.disabledTagIds = Array.from(disabledTagIds)
    }
    if (Object.keys(canonicalModes).length > 0) {
      resolvedConfig._canonicalModes = canonicalModes
    }
    const finalSourceConfig = resolvedConfig

    createConnector(
      {
        knowledgeBaseId,
        connectorType: selectedType,
        ...(isApiKeyMode ? { apiKey: apiKeyValue } : { credentialId: effectiveCredentialId! }),
        sourceConfig: finalSourceConfig,
        syncIntervalMinutes: syncInterval,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
        onError: (err) => {
          setError(err.message)
        },
      }
    )
  }

  const filteredEntries = useMemo(() => {
    const term = searchTerm.toLowerCase().trim()
    if (!term) return CONNECTOR_ENTRIES
    return CONNECTOR_ENTRIES.filter(
      ([, config]) =>
        config.name.toLowerCase().includes(term) || config.description.toLowerCase().includes(term)
    )
  }, [searchTerm])

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={(val) => !isCreating && onOpenChange(val)}
        srTitle={step === 'select-type' ? 'Connect Source' : `Configure ${connectorConfig?.name}`}
        size='md'
      >
        <ChipModalHeader onClose={() => onOpenChange(false)}>
          {step === 'configure' ? (
            <span className='flex items-center gap-2'>
              <Button
                variant='ghost'
                className='size-6 p-0'
                onClick={() => {
                  setStep('select-type')
                  onConnectorTypeChange?.('')
                }}
              >
                <ArrowLeft className='size-4' />
              </Button>
              {`Configure ${connectorConfig?.name}`}
            </span>
          ) : (
            'Connect Source'
          )}
        </ChipModalHeader>

        <ChipModalBody
          className={step === 'select-type' ? 'max-h-[520px] pb-0' : 'h-[80vh] max-h-[560px]'}
        >
          {step === 'select-type' ? (
            <div className='flex min-h-0 flex-col px-2'>
              <ChipInput
                icon={Search}
                placeholder={t('search_sources')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className='max-h-[390px] min-h-0 overflow-y-auto [scrollbar-gutter:stable]'>
                <div className='flex flex-col gap-0.5 pt-2.5 pr-1 pb-4.5'>
                  {filteredEntries.map(([type, config]) => (
                    <ConnectorTypeCard
                      key={type}
                      type={type}
                      config={config}
                      onClick={() => handleSelectType(type)}
                    />
                  ))}
                  {filteredEntries.length === 0 && (
                    <div className='rounded-lg bg-[var(--surface-3)] px-3 py-8 text-center text-[var(--text-muted)] text-caption'>
                      {CONNECTOR_ENTRIES.length === 0
                        ? 'No connectors available.'
                        : `No sources found matching "${searchTerm}"`}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : connectorConfig ? (
            <>
              {isApiKeyMode ? (
                <ChipModalField
                  type='custom'
                  title={
                    connectorConfig.auth.mode === 'apiKey' && connectorConfig.auth.label
                      ? connectorConfig.auth.label
                      : 'API Key'
                  }
                >
                  <ChipInput
                    type={apiKeyFocused ? 'text' : 'password'}
                    autoComplete='new-password'
                    value={apiKeyValue}
                    onChange={(e) => setApiKeyValue(e.target.value)}
                    onFocus={() => setApiKeyFocused(true)}
                    onBlur={() => setApiKeyFocused(false)}
                    placeholder={
                      connectorConfig.auth.mode === 'apiKey' && connectorConfig.auth.placeholder
                        ? connectorConfig.auth.placeholder
                        : 'Enter API key'
                    }
                  />
                </ChipModalField>
              ) : (
                <ChipModalField type='custom' title={t('account')}>
                  <ChipCombobox
                    options={[
                      ...credentials.map(
                        (cred): ComboboxOption => ({
                          label: cred.name || cred.provider,
                          value: cred.id,
                          icon: connectorConfig.icon,
                        })
                      ),
                      {
                        label:
                          credentials.length > 0
                            ? `Connect another ${connectorConfig.name} account`
                            : `Connect ${connectorConfig.name} account`,
                        value: '__connect_new__',
                        icon: Plus,
                        onSelect: () => setShowOAuthModal(true),
                      },
                    ]}
                    value={effectiveCredentialId ?? undefined}
                    onChange={(value) => setSelectedCredentialId(value)}
                    onOpenChange={(isOpen) => {
                      if (isOpen) void refetchCredentials()
                    }}
                    placeholder={`Select ${connectorConfig.name} account`}
                    isLoading={credentialsLoading}
                  />
                </ChipModalField>
              )}

              <ConnectorConfigFields
                connectorConfig={connectorConfig}
                sourceConfig={sourceConfig}
                credentialId={effectiveCredentialId}
                canonicalGroups={canonicalGroups}
                canonicalModes={canonicalModes}
                isFieldVisible={isFieldVisible}
                onFieldChange={handleFieldChange}
                onToggleCanonicalMode={toggleCanonicalMode}
                disabled={isCreating}
              />

              {connectorConfig.tagDefinitions && connectorConfig.tagDefinitions.length > 0 && (
                <ChipModalField type='custom' title={t('metadata_tags')}>
                  <div className='flex flex-col gap-2'>
                    {connectorConfig.tagDefinitions.map((tagDef) => (
                      <div
                        key={tagDef.id}
                        role='checkbox'
                        aria-checked={!disabledTagIds.has(tagDef.id)}
                        tabIndex={0}
                        className='flex cursor-pointer items-center gap-2 rounded-sm p-0.5 text-small'
                        onClick={() => toggleTagDefinition(tagDef.id)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return
                          handleKeyboardActivation(event, () => toggleTagDefinition(tagDef.id))
                        }}
                      >
                        <Checkbox
                          checked={!disabledTagIds.has(tagDef.id)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={(checked) => {
                            setDisabledTagIds((prev) => {
                              const next = new Set(prev)
                              if (checked) {
                                next.delete(tagDef.id)
                              } else {
                                next.add(tagDef.id)
                              }
                              return next
                            })
                          }}
                        />
                        <span className='min-w-0 flex-1 truncate text-[var(--text-primary)]'>
                          {tagDef.displayName}
                        </span>
                        <span className='flex-shrink-0 text-[var(--text-muted)] text-xs'>
                          ({tagDef.fieldType})
                        </span>
                      </div>
                    ))}
                  </div>
                </ChipModalField>
              )}

              <ChipModalField type='custom' title={t('sync_frequency')}>
                <ButtonGroup
                  value={String(syncInterval)}
                  onValueChange={(val) => setSyncInterval(Number(val))}
                >
                  {SYNC_INTERVALS.map((interval) => (
                    <ButtonGroupItem
                      key={interval.value}
                      value={String(interval.value)}
                      disabled={interval.requiresMax && !hasMaxAccess}
                    >
                      {interval.label}
                      {interval.requiresMax && !hasMaxAccess && <MaxBadge />}
                    </ButtonGroupItem>
                  ))}
                </ButtonGroup>
              </ChipModalField>

              <ChipModalError>{error}</ChipModalError>
            </>
          ) : null}
        </ChipModalBody>

        {step === 'configure' && (
          <ChipModalFooter
            onCancel={() => onOpenChange(false)}
            cancelDisabled={isCreating}
            primaryAction={{
              label: isCreating ? 'Connecting…' : 'Connect & Sync',
              onClick: handleSubmit,
              disabled: !canSubmit || isCreating,
            }}
          />
        )}
      </ChipModal>
      {showOAuthModal &&
        connectorConfig &&
        connectorConfig.auth.mode === 'oauth' &&
        connectorProviderId && (
          <ConnectOAuthModal
            mode='connect'
            origin='kb-connectors'
            open={showOAuthModal}
            onOpenChange={(open) => {
              if (!open) {
                consumeOAuthReturnContext()
                setShowOAuthModal(false)
              }
            }}
            provider={connectorProviderId}
            serviceId={connectorConfig.auth.provider}
            providerId={connectorProviderId}
            requiredScopes={getCanonicalScopesForProvider(connectorProviderId)}
            workspaceId={workspaceId}
            knowledgeBaseId={knowledgeBaseId}
            connectorType={selectedType ?? undefined}
          />
        )}
    </>
  )
}

interface ConnectorTypeCardProps {
  type: string
  config: ConnectorMeta
  onClick: () => void
}

function ConnectorTypeCard({ type, config, onClick }: ConnectorTypeCardProps) {
  const Icon = config.icon
  const brandBg = getBlock(type)?.bgColor ?? null

  return (
    <button
      type='button'
      className='flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
      onClick={onClick}
    >
      <div className='size-9 flex-shrink-0'>
        <div
          className={cn(
            'flex size-full items-center justify-center rounded-xl border',
            brandBg
              ? 'border-[var(--border-1)]'
              : 'border-[var(--border-muted)] bg-[var(--surface-4)]'
          )}
          style={brandBg ? { background: brandBg } : undefined}
        >
          <Icon className={cn('size-5', brandBg ? 'text-white' : 'text-[var(--text-icon)]')} />
        </div>
      </div>
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-[var(--text-body)] text-sm'>{config.name}</span>
        <span className='truncate text-[var(--text-muted)] text-caption'>{config.description}</span>
      </div>
      <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
    </button>
  )
}
