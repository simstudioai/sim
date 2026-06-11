'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  ArrowRight,
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Checkbox,
  Chip,
  ChipCombobox,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  ChipModalHeader,
  type ComboboxOption,
  Label,
  Search,
  Tooltip,
} from '@/components/emcn'
import { ArrowLeft, ArrowLeftRight, Info, Plus } from '@/components/emcn/icons'
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
import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field'
import { SYNC_INTERVALS } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import { MaxBadge } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/max-badge'
import type { ConfigFieldValue } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import { getBlock } from '@/blocks'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfig, ConnectorConfigField } from '@/connectors/types'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import type { SelectorKey } from '@/hooks/selectors/types'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'

const CONNECTOR_ENTRIES = Object.entries(CONNECTOR_REGISTRY)

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

  const connectorConfig = selectedType ? CONNECTOR_REGISTRY[selectedType] : null
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
          className={
            step === 'select-type' ? 'max-h-[520px] pt-2 pb-3' : 'h-[80vh] max-h-[560px] pb-3'
          }
        >
          {step === 'select-type' ? (
            <div className='flex min-h-0 flex-col gap-2.5'>
              <ChipInput
                icon={Search}
                placeholder='Search sources...'
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className='max-h-[390px] min-h-0 overflow-y-auto [scrollbar-gutter:stable]'>
                <div className='flex flex-col gap-0.5 pr-1'>
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
            <div className='flex flex-col gap-3'>
              {isApiKeyMode ? (
                <div className='flex flex-col gap-2'>
                  <Label>
                    {connectorConfig.auth.mode === 'apiKey' && connectorConfig.auth.label
                      ? connectorConfig.auth.label
                      : 'API Key'}
                  </Label>
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
                </div>
              ) : (
                <div className='flex flex-col gap-2'>
                  <Label>Account</Label>
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
                </div>
              )}

              {connectorConfig.configFields.map((field) => {
                if (!isFieldVisible(field)) return null

                const canonicalId = field.canonicalParamId
                const hasCanonicalPair =
                  canonicalId && (canonicalGroups.get(canonicalId)?.length ?? 0) === 2

                return (
                  <div key={field.id} className='flex flex-col gap-2'>
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-1'>
                        <Label>
                          {field.title}
                          {field.required && <span className='ml-0.5'>*</span>}
                        </Label>
                        {field.description && (
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <Button
                                type='button'
                                variant='ghost'
                                className='flex size-[14px] cursor-help items-center justify-center p-0 text-[var(--text-muted)] transition-colors hover-hover:text-[var(--text-secondary)]'
                                aria-label={`About ${field.title}`}
                              >
                                <Info className='size-[12px]' />
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content side='top'>{field.description}</Tooltip.Content>
                          </Tooltip.Root>
                        )}
                      </div>
                      {hasCanonicalPair && canonicalId && (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Button
                              type='button'
                              variant='ghost'
                              className='flex size-[18px] items-center justify-center rounded-[3px] p-0 text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-secondary)]'
                              onClick={() => toggleCanonicalMode(canonicalId)}
                            >
                              <ArrowLeftRight className='size-[12px]' />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content side='top'>
                            {field.mode === 'basic'
                              ? 'Switch to manual input'
                              : 'Switch to selector'}
                          </Tooltip.Content>
                        </Tooltip.Root>
                      )}
                    </div>
                    {field.type === 'selector' && field.selectorKey ? (
                      <ConnectorSelectorField
                        field={field as ConnectorConfigField & { selectorKey: SelectorKey }}
                        value={sourceConfig[field.id] ?? (field.multi ? [] : '')}
                        onChange={(value: ConfigFieldValue) => handleFieldChange(field.id, value)}
                        credentialId={effectiveCredentialId}
                        sourceConfig={sourceConfig}
                        configFields={connectorConfig.configFields}
                        canonicalModes={canonicalModes}
                        disabled={isCreating}
                      />
                    ) : field.type === 'dropdown' && field.options ? (
                      <ChipCombobox
                        options={field.options.map((opt) => ({
                          label: opt.label,
                          value: opt.id,
                        }))}
                        value={
                          typeof sourceConfig[field.id] === 'string'
                            ? (sourceConfig[field.id] as string) || undefined
                            : undefined
                        }
                        onChange={(value) => handleFieldChange(field.id, value)}
                        placeholder={field.placeholder || `Select ${field.title.toLowerCase()}`}
                      />
                    ) : (
                      <ChipInput
                        value={
                          Array.isArray(sourceConfig[field.id])
                            ? (sourceConfig[field.id] as string[]).join(', ')
                            : (sourceConfig[field.id] as string) || ''
                        }
                        onChange={(e) => handleFieldChange(field.id, e.target.value)}
                        placeholder={field.placeholder}
                      />
                    )}
                  </div>
                )
              })}

              {connectorConfig.tagDefinitions && connectorConfig.tagDefinitions.length > 0 && (
                <div className='flex flex-col gap-2'>
                  <Label>Metadata Tags</Label>
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
              )}

              <div className='flex flex-col gap-2'>
                <Label>Sync Frequency</Label>
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
              </div>

              {error && (
                <p className='text-[var(--text-error)] text-caption leading-tight'>{error}</p>
              )}
            </div>
          ) : null}
        </ChipModalBody>

        {step === 'configure' && (
          <ChipModalFooter>
            <Chip variant='filled' flush onClick={() => onOpenChange(false)} disabled={isCreating}>
              Cancel
            </Chip>
            <Chip
              variant='primary'
              flush
              onClick={handleSubmit}
              disabled={!canSubmit || isCreating}
            >
              {isCreating ? 'Connecting…' : 'Connect & Sync'}
            </Chip>
          </ChipModalFooter>
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
  config: ConnectorConfig
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
        <span className='truncate text-[14px] text-[var(--text-body)]'>{config.name}</span>
        <span className='truncate text-[12px] text-[var(--text-muted)]'>{config.description}</span>
      </div>
      <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
    </button>
  )
}
