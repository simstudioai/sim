'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, Info, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Checkbox,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@/components/emcn'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { handleKeyboardActivation } from '@/lib/core/utils/keyboard'
import { consumeOAuthReturnContext } from '@/lib/credentials/client-state'
import { getProviderIdFromServiceId, type OAuthProvider } from '@/lib/oauth'
import { OAuthModal } from '@/app/workspace/[workspaceId]/components/oauth-modal'
import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field'
import { SYNC_INTERVALS } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import { MaxBadge } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/max-badge'
import type { ConfigFieldValue } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
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
      <Modal open={open} onOpenChange={(val) => !isCreating && onOpenChange(val)}>
        <ModalContent
          size='md'
          className={step === 'select-type' ? 'max-h-[520px]' : 'h-[80vh] max-h-[560px]'}
        >
          <ModalHeader>
            {step === 'configure' && (
              <Button
                variant='ghost'
                className='mr-2 size-6 p-0'
                onClick={() => {
                  setStep('select-type')
                  onConnectorTypeChange?.('')
                }}
              >
                <ArrowLeft className='size-4' />
              </Button>
            )}
            {step === 'select-type' ? 'Connect Source' : `Configure ${connectorConfig?.name}`}
          </ModalHeader>
          <ModalDescription className='sr-only'>
            {step === 'select-type'
              ? 'Select a data source to connect to this knowledge base'
              : `Configure the ${connectorConfig?.name} connector settings`}
          </ModalDescription>

          <ModalBody className={step === 'select-type' ? 'pt-2 pb-3' : 'pb-3'}>
            {step === 'select-type' ? (
              <div className='flex min-h-0 flex-col gap-2.5'>
                <div className='flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-2 transition-colors duration-100 hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-4)]'>
                  <Search
                    className='size-[14px] flex-shrink-0 text-[var(--text-icon)]'
                    strokeWidth={2}
                  />
                  <Input
                    placeholder='Search sources...'
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className='h-auto flex-1 border-0 bg-transparent p-0 font-medium text-small leading-none placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0'
                  />
                </div>
                <div className='max-h-[390px] min-h-0 overflow-y-auto [scrollbar-gutter:stable]'>
                  <div className='flex flex-col gap-0.5 pr-1'>
                    {filteredEntries.map(([type, config]) => (
                      <ConnectorTypeCard
                        key={type}
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
                    <Input
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
                    <Combobox
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
                        <Combobox
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
                        <Input
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
          </ModalBody>

          {step === 'configure' && (
            <ModalFooter>
              <Button variant='default' onClick={() => onOpenChange(false)} disabled={isCreating}>
                Cancel
              </Button>
              <Button variant='primary' onClick={handleSubmit} disabled={!canSubmit || isCreating}>
                {isCreating ? (
                  <>
                    <Loader className='mr-1.5 size-3.5' animate />
                    Connecting…
                  </>
                ) : (
                  'Connect & Sync'
                )}
              </Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>
      {showOAuthModal &&
        connectorConfig &&
        connectorConfig.auth.mode === 'oauth' &&
        connectorProviderId && (
          <OAuthModal
            mode='connect'
            isOpen={showOAuthModal}
            onClose={() => {
              consumeOAuthReturnContext()
              setShowOAuthModal(false)
            }}
            provider={connectorProviderId}
            serviceId={connectorConfig.auth.provider}
            workspaceId={workspaceId}
            knowledgeBaseId={knowledgeBaseId}
            credentialCount={credentials.length}
            connectorType={selectedType ?? undefined}
          />
        )}
    </>
  )
}

interface ConnectorTypeCardProps {
  config: ConnectorConfig
  onClick: () => void
}

function ConnectorTypeCard({ config, onClick }: ConnectorTypeCardProps) {
  const Icon = config.icon

  return (
    <Button
      type='button'
      variant='ghost'
      className='group flex min-h-10 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
      onClick={onClick}
    >
      <Icon className='size-[18px] flex-shrink-0 text-[var(--text-icon)]' />
      <div className='flex min-w-0 flex-1 flex-col gap-[1px]'>
        <span className='truncate font-medium text-[var(--text-body)] text-small'>
          {config.name}
        </span>
        <span className='truncate text-[var(--text-muted)] text-caption'>{config.description}</span>
      </div>
    </Button>
  )
}
