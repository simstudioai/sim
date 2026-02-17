'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
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
} from '@/components/emcn'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  type OAuthProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfig } from '@/connectors/types'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'

const SYNC_INTERVALS = [
  { label: 'Every hour', value: 60 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Daily', value: 1440 },
  { label: 'Weekly', value: 10080 },
  { label: 'Manual only', value: 0 },
] as const

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
  const [disabledTagIds, setDisabledTagIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [showOAuthModal, setShowOAuthModal] = useState(false)

  const { mutate: createConnector, isPending: isCreating } = useCreateConnector()

  const connectorConfig = selectedType ? CONNECTOR_REGISTRY[selectedType] : null
  const connectorProviderId = useMemo(
    () =>
      connectorConfig
        ? (getProviderIdFromServiceId(connectorConfig.oauth.provider) as OAuthProvider)
        : null,
    [connectorConfig]
  )

  const { data: credentials = [], isLoading: credentialsLoading } = useOAuthCredentials(
    connectorConfig?.oauth.provider,
    Boolean(connectorConfig)
  )

  const effectiveCredentialId =
    selectedCredentialId ?? (credentials.length === 1 ? credentials[0].id : null)

  const handleSelectType = (type: string) => {
    setSelectedType(type)
    setStep('configure')
  }

  const canSubmit = useMemo(() => {
    if (!connectorConfig || !effectiveCredentialId) return false
    return connectorConfig.configFields
      .filter((f) => f.required)
      .every((f) => sourceConfig[f.id]?.trim())
  }, [connectorConfig, effectiveCredentialId, sourceConfig])

  const handleSubmit = () => {
    if (!selectedType || !effectiveCredentialId || !canSubmit) return

    setError(null)

    const finalSourceConfig =
      disabledTagIds.size > 0
        ? { ...sourceConfig, disabledTagIds: Array.from(disabledTagIds) }
        : sourceConfig

    createConnector(
      {
        knowledgeBaseId,
        connectorType: selectedType,
        credentialId: effectiveCredentialId,
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

  const connectorEntries = Object.entries(CONNECTOR_REGISTRY)

  return (
    <>
      <Modal open={open} onOpenChange={(val) => !isCreating && onOpenChange(val)}>
        <ModalContent size='md'>
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
                {connectorEntries.map(([type, config]) => (
                  <ConnectorTypeCard
                    key={type}
                    config={config}
                    onClick={() => handleSelectType(type)}
                  />
                ))}
                {connectorEntries.length === 0 && (
                  <p className='text-[13px] text-[var(--text-muted)]'>No connectors available.</p>
                )}
              </div>
            ) : connectorConfig ? (
              <div className='flex flex-col gap-[12px]'>
                {/* Credential selection */}
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
                            setShowOAuthModal(true)
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

                {/* Config fields */}
                {connectorConfig.configFields.map((field) => (
                  <div key={field.id} className='flex flex-col gap-[4px]'>
                    <Label>
                      {field.title}
                      {field.required && (
                        <span className='ml-[2px] text-[var(--text-error)]'>*</span>
                      )}
                    </Label>
                    {field.description && (
                      <p className='text-[11px] text-[var(--text-muted)]'>{field.description}</p>
                    )}
                    {field.type === 'dropdown' && field.options ? (
                      <Combobox
                        size='sm'
                        options={field.options.map((opt) => ({
                          label: opt.label,
                          value: opt.id,
                        }))}
                        value={sourceConfig[field.id] || undefined}
                        onChange={(value) =>
                          setSourceConfig((prev) => ({ ...prev, [field.id]: value }))
                        }
                        placeholder={field.placeholder || `Select ${field.title.toLowerCase()}`}
                      />
                    ) : (
                      <Input
                        value={sourceConfig[field.id] || ''}
                        onChange={(e) =>
                          setSourceConfig((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        placeholder={field.placeholder}
                      />
                    )}
                  </div>
                ))}

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
              <Button variant='tertiary' onClick={handleSubmit} disabled={!canSubmit || isCreating}>
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
      {connectorConfig && connectorProviderId && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={connectorProviderId}
          toolName={connectorConfig.name}
          requiredScopes={getCanonicalScopesForProvider(connectorProviderId)}
          newScopes={connectorConfig.oauth.requiredScopes || []}
          serviceId={connectorConfig.oauth.provider}
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
      className='flex items-center gap-[12px] rounded-[8px] border border-[var(--border-1)] px-[14px] py-[12px] text-left transition-colors hover:bg-[var(--surface-2)]'
      onClick={onClick}
    >
      <Icon className='h-6 w-6 flex-shrink-0' />
      <div className='flex flex-col gap-[2px]'>
        <span className='font-medium text-[14px] text-[var(--text-primary)]'>{config.name}</span>
        <span className='text-[12px] text-[var(--text-muted)]'>{config.description}</span>
      </div>
    </button>
  )
}
