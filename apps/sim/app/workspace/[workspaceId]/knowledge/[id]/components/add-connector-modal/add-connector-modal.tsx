'use client'

import { useId, useMemo, useState } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  Checkbox,
  Chip,
  ChipCombobox,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  type ComboboxOption,
  OverflowText,
} from '@sim/emcn'
import { ArrowLeft, ChevronDown, ChevronRight, Plus, Search } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  getServiceAccountProviderForProviderId,
  type OAuthProvider,
} from '@/lib/oauth'
import { SIM_SEARCH_SYNC_INTERVAL_MINUTES } from '@/lib/sim-search/constants'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import {
  ConnectServiceAccountModal,
  useServiceAccountConnectTarget,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { derivedAclCapFieldIds } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import {
  ConnectorAccessField,
  type ConnectorAccessSelection,
  ConnectorContentCredentialField,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import { ConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields'
import { hasWorkspaceMaxConnectorAccess } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-entitlements'
import {
  BROWSE_WITH_HINT,
  connectorSyncFrequencyHint,
  SYNC_INTERVALS,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import { MaxBadge } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/max-badge'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { withBrandIcon } from '@/blocks/brand-icon'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import { useMemberAccessAvailable } from '@/hooks/use-member-access'
import { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useConnectorSetupStore } from '@/stores/connector-setup/store'

const CONNECTOR_ENTRIES = Object.entries(CONNECTOR_META_REGISTRY)

const WORKSPACE_ACCESS: ConnectorAccessSelection = { accessMode: 'workspace' }

interface AddConnectorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnectorTypeChange?: (connectorType: string | null) => void
  knowledgeBaseId: string
  isSearchIndex?: boolean
  initialConnectorType?: string | null
  initialAccessMode?: ConnectorAccessSelection['accessMode']
  initialSyncIntervalMinutes?: number
  onCreated?: (connectorType: string) => void
  setupDraftKey?: string
}

type Step = 'select-type' | 'configure'

export function AddConnectorModal({
  open,
  onOpenChange,
  onConnectorTypeChange,
  knowledgeBaseId,
  isSearchIndex = false,
  initialConnectorType,
  initialAccessMode = 'workspace',
  initialSyncIntervalMinutes = 1440,
  onCreated,
  setupDraftKey,
}: AddConnectorModalProps) {
  const metadataId = useId()
  const initialType =
    initialConnectorType &&
    (!isSearchIndex || CONNECTOR_META_REGISTRY[initialConnectorType]?.search)
      ? initialConnectorType
      : null
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [draft] = useState(() =>
    setupDraftKey ? useConnectorSetupStore.getState().getDraft(setupDraftKey) : undefined
  )
  const [step, setStep] = useState<Step>(() => (initialType ? 'configure' : 'select-type'))
  const [selectedType, setSelectedType] = useState<string | null>(initialType)
  const [syncInterval, setSyncInterval] = useState(
    isSearchIndex ? SIM_SEARCH_SYNC_INTERVAL_MINUTES : initialSyncIntervalMinutes
  )
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(
    draft?.credentialId ?? null
  )
  const [contentCredentialId, setContentCredentialId] = useState<string | null>(
    draft?.contentCredentialId ?? null
  )
  const [access, setAccess] = useState<ConnectorAccessSelection>(() => ({
    accessMode:
      draft?.accessMode ??
      (isSearchIndex && initialAccessMode === 'workspace'
        ? initialType && CONNECTOR_META_REGISTRY[initialType]?.auth.mode === 'apiKey'
          ? 'admin'
          : 'members'
        : initialAccessMode),
  }))
  const [disabledTagIds, setDisabledTagIds] = useState<Set<string>>(
    () => new Set(draft?.disabledTagIds)
  )
  const [showMetadata, setShowMetadata] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [showServiceAccountModal, setShowServiceAccountModal] = useState(false)

  const [apiKeyValue, setApiKeyValue] = useState('')
  const [apiKeyFocused, setApiKeyFocused] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  useOAuthReturnForKBConnectors(
    isSearchIndex ? knowledgeBaseId : undefined,
    setSelectedCredentialId,
    selectedType ?? undefined
  )
  const { ownerBilling, features } = useWorkspaceHostContext()
  const { canAdmin } = useUserPermissionsContext()
  const memberAccessAvailable = useMemberAccessAvailable()
  const mirroredAccessAvailable = features?.knowledgeSourceMirroredAccess === true
  const { mutate: createConnector, isPending: isCreating } = useCreateConnector()

  const hasMaxAccess = hasWorkspaceMaxConnectorAccess(ownerBilling)

  const connectorConfig = selectedType ? CONNECTOR_META_REGISTRY[selectedType] : null
  const isApiKeyMode = connectorConfig?.auth.mode === 'apiKey'
  const isMembersMode = access.accessMode === 'members'
  const hiddenCapFieldIds = derivedAclCapFieldIds(connectorConfig, access.accessMode)
  /** True when the connector declares its key optional (public sources need none). */
  const isApiKeyOptional =
    connectorConfig?.auth.mode === 'apiKey' && connectorConfig.auth.optional === true
  const connectorProviderId = useMemo(
    () =>
      connectorConfig && connectorConfig.auth.mode === 'oauth'
        ? (getProviderIdFromServiceId(connectorConfig.auth.provider) as OAuthProvider)
        : null,
    [connectorConfig]
  )

  const { integrationAvailability } = usePermissionConfig()
  const serviceAccountProviderId = connectorProviderId
    ? getServiceAccountProviderForProviderId(connectorProviderId)
    : undefined
  const serviceAccountTarget = useServiceAccountConnectTarget({
    serviceAccountProviderId:
      isSearchIndex &&
      (serviceAccountProviderId === 'google-service-account' ||
        serviceAccountProviderId === 'atlassian-service-account')
        ? serviceAccountProviderId
        : undefined,
    serviceName: connectorConfig?.name,
    serviceIcon: connectorConfig?.icon,
  })
  const deploymentState = selectedType
    ? integrationAvailability.get(selectedType)?.state
    : undefined
  const canConnectServiceAccount =
    serviceAccountTarget &&
    !serviceAccountTarget.hidden &&
    (deploymentState === 'ready' || deploymentState === 'limited')

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
  } = useConnectorConfigFields({
    connectorConfig,
    initialSourceConfig: draft?.sourceConfig,
    initialCanonicalModes: draft?.canonicalModes,
  })

  const saveSetup = () => {
    if (!setupDraftKey) return
    useConnectorSetupStore.getState().saveDraft(setupDraftKey, {
      sourceConfig,
      canonicalModes,
      accessMode: access.accessMode,
      credentialId: effectiveCredentialId,
      contentCredentialId,
      disabledTagIds: Array.from(disabledTagIds),
      savedAt: Date.now(),
    })
  }

  const closeSetup = (nextOpen: boolean) => {
    if (!nextOpen && setupDraftKey) useConnectorSetupStore.getState().clearDraft(setupDraftKey)
    onOpenChange(nextOpen)
  }

  const handleSelectType = (type: string) => {
    if (setupDraftKey) useConnectorSetupStore.getState().clearDraft(setupDraftKey)
    setSelectedType(type)
    setSourceConfig({})
    setSelectedCredentialId(null)
    setContentCredentialId(null)
    setAccess(
      isSearchIndex
        ? {
            accessMode: CONNECTOR_META_REGISTRY[type]?.auth.mode === 'apiKey' ? 'admin' : 'members',
          }
        : WORKSPACE_ACCESS
    )
    setApiKeyValue('')
    setApiKeyFocused(false)
    setDisabledTagIds(new Set())
    setShowMetadata(false)
    setCanonicalModes({})
    setError(null)
    setSearchTerm('')
    setStep('configure')
    onConnectorTypeChange?.(type)
  }

  const hasRequiredCredential = isApiKeyMode
    ? isApiKeyOptional || Boolean(apiKeyValue.trim())
    : isMembersMode || Boolean(effectiveCredentialId)
  const hasSearchAccess =
    !isSearchIndex ||
    Boolean(
      connectorConfig?.search &&
        access.accessMode !== 'workspace' &&
        (!isMembersMode || memberAccessAvailable) &&
        (access.accessMode !== 'admin' || mirroredAccessAvailable)
    )
  const canSubmit = Boolean(
    connectorConfig &&
      hasRequiredCredential &&
      hasSearchAccess &&
      connectorConfig.configFields.every(
        (field) =>
          !field.required ||
          !isFieldVisible(field) ||
          hiddenCapFieldIds.has(field.id) ||
          isFieldPopulated(field)
      )
  )

  const handleSubmit = () => {
    if (!selectedType || !canSubmit) return

    setError(null)

    const resolvedConfig: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(resolveSourceConfig())) {
      if (hiddenCapFieldIds.has(key)) continue
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
        accessMode: access.accessMode,
        ...(isApiKeyMode
          ? apiKeyValue.trim()
            ? { apiKey: apiKeyValue }
            : {}
          : isMembersMode
            ? {
                accessMode: 'members' as const,
                credentialId: contentCredentialId ?? undefined,
              }
            : { accessMode: access.accessMode, credentialId: effectiveCredentialId! }),
        sourceConfig: finalSourceConfig,
        syncIntervalMinutes: syncInterval,
      },
      {
        onSuccess: () => {
          closeSetup(false)
          onCreated?.(selectedType)
        },
        onError: (err) => {
          setError(err.message)
        },
      }
    )
  }

  const filteredEntries = useMemo(() => {
    const term = searchTerm.toLowerCase().trim()
    const entries = isSearchIndex
      ? CONNECTOR_ENTRIES.filter(([, config]) => config.search)
      : CONNECTOR_ENTRIES
    if (!term) return entries
    return entries.filter(
      ([, config]) =>
        config.name.toLowerCase().includes(term) || config.description.toLowerCase().includes(term)
    )
  }, [searchTerm, isSearchIndex])

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={closeSetup}
        srTitle={step === 'select-type' ? 'Connect Source' : `Configure ${connectorConfig?.name}`}
        size='md'
        dismissDisabled={isCreating}
      >
        <ChipModalHeader onClose={() => closeSetup(false)}>
          {step === 'configure' ? (
            <span className='flex items-center gap-2'>
              <Chip
                leftIcon={ArrowLeft}
                aria-label='Choose another source'
                onClick={() => {
                  if (setupDraftKey) useConnectorSetupStore.getState().clearDraft(setupDraftKey)
                  setStep('select-type')
                  onConnectorTypeChange?.('')
                }}
              />
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
                placeholder='Search sources...'
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
              {(memberAccessAvailable || mirroredAccessAvailable) && (
                <ConnectorAccessField
                  workspaceId={workspaceId}
                  connectorConfig={connectorConfig}
                  value={access}
                  onChange={setAccess}
                  canAdmin={canAdmin}
                  allowMembers={memberAccessAvailable}
                  allowAdmin={mirroredAccessAvailable}
                  allowWorkspace={!isSearchIndex}
                  disabled={isCreating}
                  searchSetupSource={
                    isSearchIndex && selectedType === 'slack' ? 'slack' : undefined
                  }
                  onSetupNavigate={saveSetup}
                />
              )}

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
                <ChipModalField
                  type='custom'
                  title={isMembersMode ? 'Browse with' : 'Account'}
                  hint={isMembersMode ? BROWSE_WITH_HINT : undefined}
                >
                  <ChipCombobox
                    options={[
                      ...credentials.map(
                        (cred): ComboboxOption => ({
                          label: cred.name || cred.provider,
                          value: cred.id,
                          icon: withBrandIcon(connectorConfig.icon),
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
                          saveSetup()
                          setShowOAuthModal(true)
                        },
                      },
                      ...(canConnectServiceAccount
                        ? [
                            {
                              label: serviceAccountTarget.label,
                              value: '__service_account__',
                              icon: Plus,
                              onSelect: () => setShowServiceAccountModal(true),
                            },
                          ]
                        : []),
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

              {isMembersMode && connectorConfig.supportsSeparateContentCredential && (
                <ConnectorContentCredentialField
                  credentialId={contentCredentialId}
                  onChange={setContentCredentialId}
                  options={credentials.map((credential) => ({
                    value: credential.id,
                    label: credential.name || credential.provider,
                  }))}
                  isLoading={credentialsLoading}
                  disabled={isCreating}
                />
              )}

              <ConnectorConfigFields
                connectorConfig={connectorConfig}
                sourceConfig={sourceConfig}
                credentialId={effectiveCredentialId}
                canonicalGroups={canonicalGroups}
                canonicalModes={canonicalModes}
                isFieldVisible={(field) =>
                  isFieldVisible(field) && !hiddenCapFieldIds.has(field.id)
                }
                onFieldChange={handleFieldChange}
                onToggleCanonicalMode={toggleCanonicalMode}
                disabled={isCreating}
              />

              {connectorConfig.tagDefinitions && connectorConfig.tagDefinitions.length > 0 && (
                <>
                  <div className='px-2'>
                    <Chip
                      type='button'
                      leftIcon={showMetadata ? ChevronDown : ChevronRight}
                      aria-expanded={showMetadata}
                      onClick={() => setShowMetadata((visible) => !visible)}
                    >
                      Document details (optional)
                    </Chip>
                  </div>
                  {showMetadata && (
                    <ChipModalField
                      type='custom'
                      title='Metadata tags'
                      hint='All document details below are included by default. Deselect any you do not need.'
                    >
                      <div className='flex flex-col gap-2'>
                        {connectorConfig.tagDefinitions.map((tagDef) => (
                          <label
                            key={tagDef.id}
                            htmlFor={`${metadataId}-${tagDef.id}`}
                            className='flex cursor-pointer items-center gap-2 text-small'
                          >
                            <Checkbox
                              id={`${metadataId}-${tagDef.id}`}
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
                            <OverflowText
                              label={tagDef.displayName}
                              className='flex-1 text-[var(--text-body)]'
                            />
                            <span className='shrink-0 text-[var(--text-muted)] text-xs'>
                              ({tagDef.fieldType})
                            </span>
                          </label>
                        ))}
                      </div>
                    </ChipModalField>
                  )}
                </>
              )}

              {!isSearchIndex && (
                <ChipModalField
                  type='custom'
                  title='Sync Frequency'
                  hint={connectorSyncFrequencyHint(
                    access.accessMode,
                    syncInterval,
                    Boolean(contentCredentialId)
                  )}
                >
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
              )}

              <ChipModalError>{error}</ChipModalError>
            </>
          ) : null}
        </ChipModalBody>

        {step === 'configure' && (
          <ChipModalFooter
            onCancel={() => closeSetup(false)}
            primaryAction={{
              label: isCreating
                ? isMembersMode
                  ? 'Creating…'
                  : 'Connecting…'
                : isMembersMode
                  ? 'Create & Invite'
                  : 'Connect & Sync',
              onClick: handleSubmit,
              disabled: !canSubmit || isCreating,
            }}
          />
        )}
      </ChipModal>
      {showServiceAccountModal && canConnectServiceAccount && (
        <ConnectServiceAccountModal
          open
          onOpenChange={setShowServiceAccountModal}
          workspaceId={workspaceId}
          serviceAccountProviderId={serviceAccountTarget.serviceAccountProviderId}
          serviceName={serviceAccountTarget.serviceName}
          serviceIcon={serviceAccountTarget.serviceIcon}
          atlassianProduct={selectedType === 'confluence' ? 'confluence' : undefined}
          onCreated={(credentialId) => {
            setSelectedCredentialId(credentialId)
            void refetchCredentials()
          }}
        />
      )}
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
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<IntegrationTile blockType={type} icon={config.icon} />}
      title={config.name}
      description={config.description}
      onClick={onClick}
      clickLabel={config.name}
      navigable
    />
  )
}
