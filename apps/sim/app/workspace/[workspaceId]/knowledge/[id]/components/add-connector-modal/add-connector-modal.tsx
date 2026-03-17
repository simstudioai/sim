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
import { useSession } from '@/lib/auth/auth-client'
import { consumeOAuthReturnContext, writeOAuthReturnContext } from '@/lib/credentials/client-state'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  type OAuthProvider,
} from '@/lib/oauth'
import { ConnectorSelectorField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/components/connector-selector-field'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { getDependsOnFields } from '@/blocks/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfig, ConnectorConfigField } from '@/connectors/types'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import type { SelectorKey } from '@/hooks/selectors/types'

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
  const { data: session } = useSession()
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

  const { data: credentials = [], isLoading: credentialsLoading } = useOAuthCredentials(
    connectorProviderId ?? undefined,
    { enabled: Boolean(connectorConfig) && !isApiKeyMode, workspaceId }
  )

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

  const handleConnectNewAccount = useCallback(async () => {
    if (!connectorConfig || !connectorProviderId || !workspaceId) return

    const userName = session?.user?.name
    const integrationName = connectorConfig.name
    const displayName = userName ? `${userName}'s ${integrationName}` : integrationName

    try {
      const res = await fetch('/api/credentials/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          providerId: connectorProviderId,
          displayName,
        }),
      })
      if (!res.ok) {
        setError('Failed to prepare credential. Please try again.')
        return
      }
    } catch {
      setError('Failed to prepare credential. Please try again.')
      return
    }

    writeOAuthReturnContext({
      origin: 'kb-connectors',
      knowledgeBaseId,
      displayName,
      providerId: connectorProviderId,
      preCount: credentials.length,
      workspaceId,
      requestedAt: Date.now(),
    })

    setShowOAuthModal(true)
  }, [
    connectorConfig,
    connectorProviderId,
    workspaceId,
    session?.user?.name,
    knowledgeBaseId,
    credentials.length,
  ])

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
              <div className='flex flex-col gap-[8px]'>
                <div className='flex items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
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
                  <div className='flex flex-col gap-[2px]'>
                    {filteredEntries.map(([type, config]) => (
                      <ConnectorTypeCard
                        key={type}
                        config={config}
                        onClick={() => handleSelectType(type)}
                      />
                    ))}
                    {filteredEntries.length === 0 && (
                      <div className='py-[16px] text-center text-[14px] text-[var(--text-muted)]'>
                        {CONNECTOR_ENTRIES.length === 0
                          ? 'No connectors available.'
                          : `No sources found matching "${searchTerm}"`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : connectorConfig ? (
              <div className='flex flex-col gap-[12px]'>
                {/* Auth: API key input or OAuth credential selection */}
                {isApiKeyMode ? (
                  <div className='flex flex-col gap-[4px]'>
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
                  <div className='flex flex-col gap-[4px]'>
                    <Label>Account</Label>
                    {credentialsLoading ? (
                      <div className='flex items-center gap-2 text-[13px] text-[var(--text-muted)]'>
                        <Loader2 className='h-4 w-4 animate-spin' />
                        Loading credentials...
                      </div>
                    ) : (
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
                            label: 'Connect new account',
                            value: '__connect_new__',
                            icon: Plus,
                            onSelect: () => {
                              void handleConnectNewAccount()
                            },
                          },
                        ]}
                        value={effectiveCredentialId ?? undefined}
                        onChange={(value) => setSelectedCredentialId(value)}
                        placeholder={
                          credentials.length === 0
                            ? `No ${connectorConfig.name} accounts`
                            : 'Select account'
                        }
                      />
                    )}
                  </div>
                )}

                {/* Config fields */}
                {connectorConfig.configFields.map((field) => {
                  if (!isFieldVisible(field)) return null

                  const canonicalId = field.canonicalParamId
                  const hasCanonicalPair =
                    canonicalId && (canonicalGroups.get(canonicalId)?.length ?? 0) === 2

                  return (
                    <div key={field.id} className='flex flex-col gap-[4px]'>
                      <div className='flex items-center justify-between'>
                        <Label>
                          {field.title}
                          {field.required && (
                            <span className='ml-[2px] text-[var(--text-error)]'>*</span>
                          )}
                        </Label>
                        {hasCanonicalPair && canonicalId && (
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <button
                                type='button'
                                className='flex h-[18px] w-[18px] items-center justify-center rounded-[3px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)]'
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
                        <p className='text-[11px] text-[var(--text-muted)]'>{field.description}</p>
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
                  <div className='flex flex-col gap-[4px]'>
                    <Label>Metadata Tags</Label>
                    {connectorConfig.tagDefinitions.map((tagDef) => (
                      <div
                        key={tagDef.id}
                        className='flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[2px] py-[2px] text-[13px]'
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
                        <span className='text-[11px] text-[var(--text-muted)]'>
                          ({tagDef.fieldType})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sync interval */}
                <div className='flex flex-col gap-[4px]'>
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
                  <p className='text-[12px] text-[var(--text-error)] leading-tight'>{error}</p>
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
      {connectorConfig && connectorConfig.auth.mode === 'oauth' && connectorProviderId && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => {
            consumeOAuthReturnContext()
            setShowOAuthModal(false)
          }}
          provider={connectorProviderId}
          toolName={connectorConfig.name}
          requiredScopes={getCanonicalScopesForProvider(connectorProviderId)}
          newScopes={[]}
          serviceId={connectorConfig.auth.provider}
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
      className='flex items-center gap-[10px] rounded-[6px] px-[10px] py-[8px] text-left transition-colors hover:bg-[var(--surface-3)]'
      onClick={onClick}
    >
      <Icon className='h-[18px] w-[18px] flex-shrink-0' />
      <div className='flex min-w-0 flex-col gap-[1px]'>
        <span className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
          {config.name}
        </span>
        <span className='truncate text-[11px] text-[var(--text-muted)]'>{config.description}</span>
      </div>
    </button>
  )
}
