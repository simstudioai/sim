'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, Loader2, Plus, Search } from 'lucide-react'
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
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@/components/emcn'
import { consumeOAuthReturnContext } from '@/lib/credentials/client-state'
import { getProviderIdFromServiceId, type OAuthProvider } from '@/lib/oauth'
import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/components/connector-selector-field'
import { ConnectCredentialModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/connect-credential-modal'
import { getDependsOnFields } from '@/blocks/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfig, ConnectorConfigField } from '@/connectors/types'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import type { SelectorKey } from '@/hooks/selectors/types'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'

const SYNC_INTERVALS = [
  { label: 'Every hour', value: 60 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Daily', value: 1440 },
  { label: 'Weekly', value: 10080 },
  { label: 'Manual only', value: 0 },
] as const

const CONNECTOR_ENTRIES = Object.entries(CONNECTOR_REGISTRY)

interface AddConnectorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
}

type Step = 'select-type' | 'configure'

export function AddConnectorModal({ open, onOpenChange, knowledgeBaseId }: AddConnectorModalProps) {
  const [step, setStep] = useState<Step>('select-type')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [sourceConfig, setSourceConfig] = useState<Record<string, string>>({})
  const [syncInterval, setSyncInterval] = useState(1440)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [disabledTagIds, setDisabledTagIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [canonicalModes, setCanonicalModes] = useState<Record<string, 'basic' | 'advanced'>>({})

  const [apiKeyValue, setApiKeyValue] = useState('')
  const [apiKeyFocused, setApiKeyFocused] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { mutate: createConnector, isPending: isCreating } = useCreateConnector()

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

  const canonicalGroups = useMemo(() => {
    if (!connectorConfig) return new Map<string, ConnectorConfigField[]>()
    const groups = new Map<string, ConnectorConfigField[]>()
    for (const field of connectorConfig.configFields) {
      if (field.canonicalParamId) {
        const existing = groups.get(field.canonicalParamId)
        if (existing) {
          existing.push(field)
        } else {
          groups.set(field.canonicalParamId, [field])
        }
      }
    }
    return groups
  }, [connectorConfig])

  const dependentFieldIds = useMemo(() => {
    if (!connectorConfig) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const field of connectorConfig.configFields) {
      const deps = getDependsOnFields(field.dependsOn)
      for (const dep of deps) {
        const existing = map.get(dep) ?? []
        existing.push(field.id)
        map.set(dep, existing)
      }
    }
    for (const group of canonicalGroups.values()) {
      const allDependents = new Set<string>()
      for (const field of group) {
        for (const dep of map.get(field.id) ?? []) {
          allDependents.add(dep)
          const depField = connectorConfig.configFields.find((f) => f.id === dep)
          if (depField?.canonicalParamId) {
            for (const sibling of canonicalGroups.get(depField.canonicalParamId) ?? []) {
              allDependents.add(sibling.id)
            }
          }
        }
      }
      if (allDependents.size > 0) {
        for (const field of group) {
          map.set(field.id, [...allDependents])
        }
      }
    }
    return map
  }, [connectorConfig, canonicalGroups])

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
  }

  const handleFieldChange = useCallback(
    (fieldId: string, value: string) => {
      setSourceConfig((prev) => {
        const next = { ...prev, [fieldId]: value }
        const toClear = dependentFieldIds.get(fieldId)
        if (toClear) {
          for (const depId of toClear) {
            next[depId] = ''
          }
        }
        return next
      })
    },
    [dependentFieldIds]
  )

  const toggleCanonicalMode = useCallback((canonicalId: string) => {
    setCanonicalModes((prev) => ({
      ...prev,
      [canonicalId]: prev[canonicalId] === 'advanced' ? 'basic' : 'advanced',
    }))
  }, [])

  const isFieldVisible = useCallback(
    (field: ConnectorConfigField): boolean => {
      if (!field.canonicalParamId || !field.mode) return true
      const activeMode = canonicalModes[field.canonicalParamId] ?? 'basic'
      return field.mode === activeMode
    },
    [canonicalModes]
  )

  const resolveSourceConfig = useCallback((): Record<string, string> => {
    const resolved: Record<string, string> = {}
    const processedCanonicals = new Set<string>()

    if (!connectorConfig) return resolved

    for (const field of connectorConfig.configFields) {
      if (field.canonicalParamId) {
        if (processedCanonicals.has(field.canonicalParamId)) continue
        processedCanonicals.add(field.canonicalParamId)

        const group = canonicalGroups.get(field.canonicalParamId)
        if (!group) continue

        const activeMode = canonicalModes[field.canonicalParamId] ?? 'basic'
        const activeField = group.find((f) => f.mode === activeMode) ?? group[0]
        const value = sourceConfig[activeField.id]
        if (value) resolved[field.canonicalParamId] = value
      } else {
        if (sourceConfig[field.id]) resolved[field.id] = sourceConfig[field.id]
      }
    }

    return resolved
  }, [connectorConfig, canonicalGroups, canonicalModes, sourceConfig])

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
      if (!sourceConfig[field.id]?.trim()) return false
    }
    return true
  }, [
    connectorConfig,
    isApiKeyMode,
    apiKeyValue,
    effectiveCredentialId,
    sourceConfig,
    isFieldVisible,
  ])

  const handleSubmit = () => {
    if (!selectedType || !canSubmit) return

    setError(null)

    const resolvedConfig = resolveSourceConfig()
    const finalSourceConfig =
      disabledTagIds.size > 0
        ? { ...resolvedConfig, disabledTagIds: Array.from(disabledTagIds) }
        : resolvedConfig

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

  const handleConnectNewAccount = useCallback(() => {
    setShowOAuthModal(true)
  }, [])

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
        <ModalContent size='md' className='h-[80vh] max-h-[560px]'>
          <ModalHeader>
            {step === 'configure' && (
              <Button
                variant='ghost'
                className='mr-2 h-6 w-6 p-0'
                onClick={() => setStep('select-type')}
              >
                <ArrowLeft className='h-4 w-4' />
              </Button>
            )}
            {step === 'select-type' ? 'Connect Source' : `Configure ${connectorConfig?.name}`}
          </ModalHeader>

          <ModalBody>
            {step === 'select-type' ? (
              <div className='flex flex-col gap-2'>
                <div className='flex items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
                  <Search
                    className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
                    strokeWidth={2}
                  />
                  <Input
                    placeholder='Search sources...'
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                  />
                </div>
                <div className='min-h-[400px] overflow-y-auto'>
                  <div className='flex flex-col gap-0.5'>
                    {filteredEntries.map(([type, config]) => (
                      <ConnectorTypeCard
                        key={type}
                        config={config}
                        onClick={() => handleSelectType(type)}
                      />
                    ))}
                    {filteredEntries.length === 0 && (
                      <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
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
                {/* Auth: API key input or OAuth credential selection */}
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
                      size='sm'
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
                          onSelect: () => {
                            void handleConnectNewAccount()
                          },
                        },
                      ]}
                      value={effectiveCredentialId ?? undefined}
                      onChange={(value) => setSelectedCredentialId(value)}
                      onOpenChange={(isOpen) => {
                        if (isOpen) void refetchCredentials()
                      }}
                      placeholder={
                        credentials.length === 0
                          ? `No ${connectorConfig.name} accounts`
                          : 'Select account'
                      }
                      isLoading={credentialsLoading}
                    />
                  </div>
                )}

                {/* Config fields */}
                {connectorConfig.configFields.map((field) => {
                  if (!isFieldVisible(field)) return null

                  const canonicalId = field.canonicalParamId
                  const hasCanonicalPair =
                    canonicalId && (canonicalGroups.get(canonicalId)?.length ?? 0) === 2

                  return (
                    <div key={field.id} className='flex flex-col gap-2'>
                      <div className='flex items-center justify-between'>
                        <Label>
                          {field.title}
                          {field.required && (
                            <span className='ml-0.5 text-[var(--text-error)]'>*</span>
                          )}
                        </Label>
                        {hasCanonicalPair && canonicalId && (
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <button
                                type='button'
                                className='flex h-[18px] w-[18px] items-center justify-center rounded-[3px] text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-3)] hover-hover:text-[var(--text-secondary)]'
                                onClick={() => toggleCanonicalMode(canonicalId)}
                              >
                                <ArrowLeftRight className='h-[12px] w-[12px]' />
                              </button>
                            </Tooltip.Trigger>
                            <Tooltip.Content side='top'>
                              {field.mode === 'basic'
                                ? 'Switch to manual input'
                                : 'Switch to selector'}
                            </Tooltip.Content>
                          </Tooltip.Root>
                        )}
                      </div>
                      {field.description && (
                        <p className='text-[var(--text-muted)] text-xs'>{field.description}</p>
                      )}
                      {field.type === 'selector' && field.selectorKey ? (
                        <ConnectorSelectorField
                          field={field as ConnectorConfigField & { selectorKey: SelectorKey }}
                          value={sourceConfig[field.id] || ''}
                          onChange={(value) => handleFieldChange(field.id, value)}
                          credentialId={effectiveCredentialId}
                          sourceConfig={sourceConfig}
                          configFields={connectorConfig.configFields}
                          canonicalModes={canonicalModes}
                          disabled={isCreating}
                        />
                      ) : field.type === 'dropdown' && field.options ? (
                        <Combobox
                          size='sm'
                          options={field.options.map((opt) => ({
                            label: opt.label,
                            value: opt.id,
                          }))}
                          value={sourceConfig[field.id] || undefined}
                          onChange={(value) => handleFieldChange(field.id, value)}
                          placeholder={field.placeholder || `Select ${field.title.toLowerCase()}`}
                        />
                      ) : (
                        <Input
                          value={sourceConfig[field.id] || ''}
                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
                          placeholder={field.placeholder}
                        />
                      )}
                    </div>
                  )
                })}

                {/* Tag definitions (opt-out) */}
                {connectorConfig.tagDefinitions && connectorConfig.tagDefinitions.length > 0 && (
                  <div className='flex flex-col gap-2'>
                    <Label>Metadata Tags</Label>
                    {connectorConfig.tagDefinitions.map((tagDef) => (
                      <div
                        key={tagDef.id}
                        className='flex cursor-pointer items-center gap-2 rounded-sm px-0.5 py-0.5 text-small'
                        onClick={() => {
                          setDisabledTagIds((prev) => {
                            const next = new Set(prev)
                            if (prev.has(tagDef.id)) {
                              next.delete(tagDef.id)
                            } else {
                              next.add(tagDef.id)
                            }
                            return next
                          })
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
                        <span className='text-[var(--text-primary)]'>{tagDef.displayName}</span>
                        <span className='text-[var(--text-muted)] text-xs'>
                          ({tagDef.fieldType})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sync interval */}
                <div className='flex flex-col gap-2'>
                  <Label>Sync Frequency</Label>
                  <ButtonGroup
                    value={String(syncInterval)}
                    onValueChange={(val) => setSyncInterval(Number(val))}
                  >
                    {SYNC_INTERVALS.map((interval) => (
                      <ButtonGroupItem key={interval.value} value={String(interval.value)}>
                        {interval.label}
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
                    <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                    Connecting...
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
          <ConnectCredentialModal
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
    <button
      type='button'
      className='flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover-hover:bg-[var(--surface-3)]'
      onClick={onClick}
    >
      <Icon className='h-[18px] w-[18px] flex-shrink-0' />
      <div className='flex min-w-0 flex-col gap-[1px]'>
        <span className='truncate font-medium text-[var(--text-primary)] text-small'>
          {config.name}
        </span>
        <span className='truncate text-[var(--text-muted)] text-xs'>{config.description}</span>
      </div>
    </button>
  )
}
