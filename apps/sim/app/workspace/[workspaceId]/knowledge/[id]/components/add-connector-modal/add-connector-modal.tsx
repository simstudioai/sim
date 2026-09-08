'use client'

import { useId, useState } from 'react'
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
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { getIntegrationsForCredentialProvider } from '@/lib/integrations/credential-display'
import {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  getServiceAccountProviderForProviderId,
  type OAuthProvider,
} from '@/lib/oauth'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { SIM_SEARCH_SYNC_INTERVAL_MINUTES } from '@/lib/sim-search/constants'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import {
  ConnectServiceAccountModal,
  useServiceAccountConnectTarget,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  derivedAclCapFieldIds,
  isConnectorFieldRequired,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import {
  ConnectorAccessField,
  type ConnectorAccessSelection,
  ConnectorContentCredentialField,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import { ConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields'
import {
  BROWSE_WITH_HINT,
  connectorSyncFrequencyHint,
  SYNC_INTERVALS,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
import { MaxBadge } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/max-badge'
import { useConnectorConfigFields } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
import { useConnectorScope } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-scope'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { withBrandIcon } from '@/blocks/brand-icon'
import { getConnectorApiKeyConfig, isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
import { useCreateConnector } from '@/hooks/queries/kb/connectors'
import { useOAuthCredentials } from '@/hooks/queries/oauth/oauth-credentials'
import { useSourceAccounts } from '@/hooks/queries/source-accounts'
import { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
import { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useConnectorSetupStore } from '@/stores/connector-setup/store'

const CONNECTOR_ENTRIES = Object.entries(CONNECTOR_META_REGISTRY)

const WORKSPACE_ACCESS: ConnectorAccessSelection = { accessMode: 'workspace' }

interface AddConnectorModalProps {
  scope?: ResourceScope
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnectorTypeChange?: (connectorType: string | null) => void
  knowledgeBaseId: string
  isSearchIndex?: boolean
  initialConnectorType?: string | null
  initialAccessMode?: ConnectorAccessSelection['accessMode']
  membersOnly?: boolean
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
  membersOnly = false,
  initialSyncIntervalMinutes = 1440,
  onCreated,
  setupDraftKey,
  scope: explicitScope,
}: AddConnectorModalProps) {
  const metadataId = useId()
  const initialType =
    initialConnectorType &&
    (!isSearchIndex || CONNECTOR_META_REGISTRY[initialConnectorType]?.search)
      ? initialConnectorType
      : null
  const { scope, canAdmin, memberAccessAvailable, mirroredAccessAvailable, hasMaxAccess } =
    useConnectorScope(explicitScope)
  const owner = resourceScopeFields(scope)
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
      (membersOnly ? 'members' : draft?.accessMode) ??
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
  const [useApiKey, setUseApiKey] = useState(!isSearchIndex)
  const [apiKeyFocused, setApiKeyFocused] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  useOAuthReturnForKBConnectors(
    isSearchIndex ? knowledgeBaseId : undefined,
    setSelectedCredentialId,
    selectedType ?? undefined,
    scope
  )
  const { mutate: createConnector, isPending: isCreating } = useCreateConnector()

  const connectorConfig = selectedType ? CONNECTOR_META_REGISTRY[selectedType] : null
  const docsUrl = isSearchIndex ? connectorConfig?.searchDocsUrl : undefined
  const setupGuideActions = docsUrl
    ? [
        {
          label: 'Setup guide',
          onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
        },
      ]
    : undefined
  const isMembersMode = access.accessMode === 'members'
  const apiKeyConfig = connectorConfig ? getConnectorApiKeyConfig(connectorConfig.auth) : undefined
  const isApiKeyMode =
    connectorConfig?.auth.mode === 'apiKey' || Boolean(apiKeyConfig && !isMembersMode && useApiKey)
  const {
    integrationAvailability,
    oauthServiceAvailability,
    isIntegrationAvailabilityReady,
    isIntegrationAvailabilityFetching,
    isIntegrationAvailabilityLoading,
    integrationAvailabilityError,
    refetchIntegrationAvailability,
  } = usePermissionConfig()
  const { admin: allowAdmin, members: allowMembers } = connectorConfig
    ? getConnectorAccessAvailability(connectorConfig, integrationAvailability, {
        memberAccessAvailable,
        mirroredAccessAvailable,
        oauthServiceAvailability,
        isIntegrationAvailabilityReady,
      })
    : { admin: false, members: false }
  const needsSlackSetup = selectedType === 'slack' && isMembersMode
  const { data: sourceAccounts } = useSourceAccounts(
    canAdmin && needsSlackSetup ? scope : undefined
  )
  const slackConfigured =
    sourceAccounts?.credentialGroup?.status === 'active' &&
    sourceAccounts.credentialGroup.options.some(
      (option) =>
        option.provider === 'slack' &&
        option.status === 'active' &&
        option.configurationStatus === 'ready'
    )
  const slackSetupRequired = needsSlackSetup && !slackConfigured
  const hiddenCapFieldIds = derivedAclCapFieldIds(connectorConfig, access.accessMode)
  /** True when the connector declares its key optional (public sources need none). */
  const isApiKeyOptional =
    connectorConfig?.auth.mode === 'apiKey' && connectorConfig.auth.optional === true
  const connectorProviderId =
    connectorConfig?.auth.mode === 'oauth'
      ? (getProviderIdFromServiceId(connectorConfig.auth.provider) as OAuthProvider)
      : null

  const serviceAccountProviderId = connectorProviderId
    ? getServiceAccountProviderForProviderId(connectorProviderId)
    : undefined
  const requiresServiceAccount =
    access.accessMode === 'admin' &&
    connectorConfig?.auth.mode === 'oauth' &&
    !isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, 'oauth')
  const serviceAccountTarget = useServiceAccountConnectTarget({
    serviceAccountProviderId:
      (isSearchIndex || requiresServiceAccount) &&
      (serviceAccountProviderId === 'google-service-account' ||
        serviceAccountProviderId === 'atlassian-service-account')
        ? serviceAccountProviderId
        : undefined,
    serviceName: connectorConfig?.name,
    serviceIcon: connectorConfig?.icon,
  })
  const deploymentType = connectorProviderId
    ? (getIntegrationsForCredentialProvider(connectorProviderId)[0]?.type ?? selectedType)
    : selectedType
  const deploymentState = deploymentType
    ? integrationAvailability.get(deploymentType.toLowerCase())?.state
    : undefined
  const canConnectServiceAccount =
    serviceAccountTarget &&
    !serviceAccountTarget.hidden &&
    (deploymentState === 'ready' || deploymentState === 'limited')

  const {
    data: rawCredentials = [],
    isLoading: credentialsLoading,
    refetch: refetchCredentials,
  } = useOAuthCredentials(connectorProviderId ?? undefined, {
    enabled: Boolean(connectorConfig) && !isApiKeyMode,
    ...owner,
  })

  useCredentialRefreshTriggers(refetchCredentials, connectorProviderId ?? '', scope)

  const credentials = rawCredentials.filter(
    (credential) =>
      !connectorConfig ||
      isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, credential.type)
  )
  const canConnectOAuth =
    connectorConfig &&
    isConnectorCredentialTypeAllowed(connectorConfig.auth, access.accessMode, 'oauth')
  const effectiveCredentialId =
    selectedCredentialId && credentials.some((credential) => credential.id === selectedCredentialId)
      ? selectedCredentialId
      : credentials.length === 1
        ? credentials[0].id
        : null

  const {
    sourceConfig,
    setSourceConfig,
    canonicalModes,
    setCanonicalModes,
    canonicalGroups,
    isFieldVisible: isConfigFieldVisible,
    isFieldPopulated,
    handleFieldChange,
    toggleCanonicalMode,
    resolveSourceConfig,
  } = useConnectorConfigFields({
    connectorConfig,
    accessMode: access.accessMode,
    initialSourceConfig: draft?.sourceConfig,
    initialCanonicalModes: draft?.canonicalModes,
  })

  const indexingCredentialId = isApiKeyMode
    ? null
    : isMembersMode
      ? contentCredentialId
      : effectiveCredentialId
  const indexingCredential = credentials.find(
    (credential) => credential.id === indexingCredentialId
  )
  const isFieldVisible = (field: ConnectorConfigField) =>
    isConfigFieldVisible(field) &&
    (connectorConfig?.auth.mode !== 'oauth' ||
      connectorConfig.auth.serviceAccountSubjectFieldId !== field.id ||
      indexingCredential?.type === 'service_account')

  const showCredentialPicker =
    !isMembersMode ||
    connectorConfig?.supportsSeparateContentCredential ||
    connectorConfig?.configFields.some(
      (field) => field.type === 'selector' && isFieldVisible(field)
    )

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
    setUseApiKey(!isSearchIndex)
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
        (!isMembersMode || allowMembers) &&
        (access.accessMode !== 'admin' || allowAdmin)
    )
  const canSubmit = Boolean(
    connectorConfig &&
      hasRequiredCredential &&
      hasSearchAccess &&
      (access.accessMode !== 'admin' || allowAdmin) &&
      (!isMembersMode || allowMembers) &&
      !slackSetupRequired &&
      connectorConfig.configFields.every(
        (field) =>
          !isConnectorFieldRequired(field, connectorConfig, access.accessMode) ||
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

  const term = searchTerm.toLowerCase().trim()
  const entries = isSearchIndex
    ? CONNECTOR_ENTRIES.filter(([, config]) => config.search)
    : CONNECTOR_ENTRIES
  const filteredEntries = term
    ? entries.filter(
        ([, config]) =>
          config.name.toLowerCase().includes(term) ||
          config.description.toLowerCase().includes(term)
      )
    : entries

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
              {!membersOnly && (
                <Chip
                  leftIcon={ArrowLeft}
                  aria-label='Choose another source'
                  onClick={() => {
                    if (setupDraftKey) useConnectorSetupStore.getState().clearDraft(setupDraftKey)
                    setStep('select-type')
                    onConnectorTypeChange?.('')
                  }}
                />
              )}
              {`Configure ${connectorConfig?.name}`}
            </span>
          ) : (
            'Connect Source'
          )}
        </ChipModalHeader>

        <ChipModalBody
          className={
            step === 'select-type'
              ? 'max-h-[520px] pb-0'
              : slackSetupRequired
                ? undefined
                : 'h-[80vh] max-h-[560px]'
          }
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
                    <SettingsEmptyState variant='inline'>
                      {CONNECTOR_ENTRIES.length === 0
                        ? 'No connectors available.'
                        : `No sources found matching "${searchTerm}"`}
                    </SettingsEmptyState>
                  )}
                </div>
              </div>
            </div>
          ) : connectorConfig ? (
            <>
              {integrationAvailabilityError && (
                <ChipModalField type='custom' title='Connection availability'>
                  <SettingsQueryErrorState
                    error={integrationAvailabilityError}
                    isRetrying={isIntegrationAvailabilityFetching}
                    fallback='Could not load connection availability'
                    onRetry={() => void refetchIntegrationAvailability()}
                    variant='inline'
                  />
                </ChipModalField>
              )}
              {!membersOnly &&
                (memberAccessAvailable || mirroredAccessAvailable || slackSetupRequired) && (
                  <ConnectorAccessField
                    scope={scope}
                    connectorConfig={connectorConfig}
                    value={access}
                    onChange={setAccess}
                    canAdmin={canAdmin}
                    allowMembers={allowMembers}
                    allowAdmin={allowAdmin}
                    allowWorkspace={!isSearchIndex}
                    disabled={isCreating}
                    searchSetupSource={
                      isSearchIndex && selectedType === 'slack' ? 'slack' : undefined
                    }
                    onSetupNavigate={saveSetup}
                  />
                )}

              {!slackSetupRequired && (
                <>
                  {connectorConfig.auth.mode === 'oauth' && apiKeyConfig && !isMembersMode && (
                    <ChipModalField type='custom' title='Authentication'>
                      <ChipCombobox
                        disabled={isCreating}
                        value={isApiKeyMode ? 'apiKey' : 'oauth'}
                        options={[
                          { label: apiKeyConfig.label || 'API key', value: 'apiKey' },
                          { label: 'Connected account', value: 'oauth' },
                        ]}
                        onChange={(value) => {
                          setUseApiKey(value === 'apiKey')
                          setApiKeyValue('')
                          setSelectedCredentialId(null)
                        }}
                      />
                    </ChipModalField>
                  )}
                  {isApiKeyMode ? (
                    <ChipModalField type='custom' title={apiKeyConfig?.label || 'API Key'}>
                      <ChipInput
                        type={apiKeyFocused ? 'text' : 'password'}
                        autoComplete='new-password'
                        value={apiKeyValue}
                        onChange={(e) => setApiKeyValue(e.target.value)}
                        onFocus={() => setApiKeyFocused(true)}
                        onBlur={() => setApiKeyFocused(false)}
                        placeholder={apiKeyConfig?.placeholder || 'Enter API key'}
                      />
                    </ChipModalField>
                  ) : showCredentialPicker ? (
                    <ChipModalField
                      type='custom'
                      title={
                        isMembersMode
                          ? 'Browse with'
                          : canConnectOAuth
                            ? 'Account'
                            : 'Service account'
                      }
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
                          ...(canConnectOAuth
                            ? [
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
                              ]
                            : []),
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
                        placeholder={
                          canConnectOAuth
                            ? `Select ${connectorConfig.name} account`
                            : 'Select a service account'
                        }
                        isLoading={credentialsLoading || isIntegrationAvailabilityLoading}
                        disabled={!isIntegrationAvailabilityReady}
                      />
                    </ChipModalField>
                  ) : null}

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
                    scope={scope}
                    accessMode={access.accessMode}
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
              )}
            </>
          ) : null}
        </ChipModalBody>

        {step === 'configure' &&
          (slackSetupRequired ? (
            <ChipModalFooter
              onCancel={() => closeSetup(false)}
              secondaryActions={setupGuideActions}
              defaultAction='none'
            />
          ) : (
            <ChipModalFooter
              onCancel={() => closeSetup(false)}
              secondaryActions={setupGuideActions}
              primaryAction={{
                label: isCreating
                  ? isMembersMode
                    ? 'Creating…'
                    : 'Connecting…'
                  : isMembersMode
                    ? scope.kind === 'organization'
                      ? 'Add source'
                      : 'Create & Invite'
                    : 'Connect & Sync',
                onClick: handleSubmit,
                disabled: !canSubmit || isCreating,
              }}
            />
          ))}
      </ChipModal>
      {showServiceAccountModal && canConnectServiceAccount && (
        <ConnectServiceAccountModal
          open
          onOpenChange={setShowServiceAccountModal}
          {...owner}
          serviceAccountProviderId={serviceAccountTarget.serviceAccountProviderId}
          serviceName={serviceAccountTarget.serviceName}
          serviceIcon={serviceAccountTarget.serviceIcon}
          atlassianProduct={selectedType === 'confluence' ? 'confluence' : undefined}
          onCreated={setSelectedCredentialId}
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
            docsUrl={docsUrl}
            requiredScopes={getCanonicalScopesForProvider(connectorProviderId)}
            {...owner}
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
