'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import type { Credential } from '@/lib/oauth'
import type { SelectorKey } from '@/lib/selectors/manifest'
import type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
import {
  ActionRow,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  ActionMenu,
  Button,
  FailureNotice,
  FieldFrame,
  FileField,
  InlineNotice,
  MultiSelect,
  SearchableSelect,
  SecretField,
  SegmentedControl,
  StatusTag,
  TextField,
  Tooltip,
} from '@/platform/design-system/components'
import {
  type ConnectorConfigFieldsProps,
  GITLAB_CSV_FILES,
  GITLAB_TOKEN_TABS,
  type GitLabPermissionForm,
  isConnectorFieldRequired,
  slackSearchSetupHref,
  useAvailableEnvVarKeys,
  useConnectorAccessField,
  useConnectorSelector,
} from '@/platform/lib/data/sources'

const SELECT_ALL = '__select_all__'

interface SelectorProps extends Omit<Parameters<typeof useConnectorSelector>[0], 'field'> {
  field: ConnectorConfigField & { selectorKey: SelectorKey }
  label: string
  hint?: string
  optional?: boolean
}

function ConnectorSelector({ label, hint, optional, ...options }: SelectorProps) {
  const { field, value, disabled, credentialId } = options
  const selector = useConnectorSelector(options)
  const visibleOptions = selector.comboboxOptions
    .filter((option) => !option.hidden)
    .map(({ value: optionValue, label: optionLabel }) => ({
      value: optionValue,
      label: optionLabel,
    }))
  const labels = Object.fromEntries(
    selector.comboboxOptions.map((option) => [option.value, option.label])
  )
  const loadingOptions =
    selector.isEnabled &&
    (selector.isLoading || (selector.options.length === 0 && selector.isLoadingSelectedOptions))
  const search = {
    query: selector.searchTerm,
    onQueryChange: selector.handleSearchChange,
    hasMore: selector.hasMore,
    loading: loadingOptions || selector.isFetchingMore || selector.isLoadingAll,
    error: selector.error?.message,
    onLoadMore: selector.loadMore,
    onRetry: () => void selector.refetch(),
  }
  const blocked = disabled || !credentialId || !selector.depsResolved
  const fieldHint = selector.truncated
    ? 'Too many to list. Try a more exact term.'
    : (hint ?? undefined)

  if (selector.isMulti) {
    const current = Array.isArray(value) ? value : value ? [value] : []
    const allValue = field.selectAllValue ?? SELECT_ALL
    const offersAll =
      field.allowSelectAll &&
      (selector.options.length > 0 || selector.hasMore || selector.allSelected)
    const shown =
      offersAll && selector.allSelected && !current.includes(allValue)
        ? [allValue, ...current]
        : current
    return (
      <>
        <MultiSelect
          label={label}
          searchLabel={`Search ${field.title.toLowerCase()}...`}
          placeholder={selector.placeholder}
          options={
            offersAll ? [{ value: allValue, label: 'All' }, ...visibleOptions] : visibleOptions
          }
          value={shown}
          selectedLabels={{ ...labels, [allValue]: 'All' }}
          onValueChange={(next) => {
            if (next.includes(allValue) !== shown.includes(allValue)) {
              void selector.selectAll()
              return
            }
            selector.handleChange(next.filter((item) => item !== SELECT_ALL))
          }}
          search={search}
          disabled={blocked}
          hint={fieldHint}
        />
        {selector.bulkError && <InlineNotice intent='danger' message={selector.bulkError} />}
      </>
    )
  }

  return (
    <SearchableSelect
      label={label}
      searchLabel={`Search ${field.title.toLowerCase()}...`}
      placeholder={selector.placeholder}
      options={visibleOptions}
      value={selector.singleValue || null}
      selectedLabel={selector.singleValue ? labels[selector.singleValue] : undefined}
      onValueChange={(next) => selector.handleChange(next ?? '')}
      search={search}
      disabled={blocked}
      hint={fieldHint}
    />
  )
}

/** A connector's dynamic configuration fields, with their selector/manual pairs. */
export function ConnectorConfigFields({
  scope,
  accessMode = 'workspace',
  connectorConfig,
  sourceConfig,
  selectionLabels,
  credentialId,
  credentialType,
  canonicalGroups,
  canonicalModes,
  isFieldVisible,
  onFieldChange,
  onToggleCanonicalMode,
  disabled,
}: ConnectorConfigFieldsProps) {
  return (
    <>
      {connectorConfig.configFields.map((field) => {
        if (!isFieldVisible(field)) return null
        const title = accessMode === 'admin' ? (field.titleInAdminMode ?? field.title) : field.title
        const description =
          accessMode === 'admin'
            ? (field.descriptionInAdminMode ?? field.description)
            : field.description
        const required = isConnectorFieldRequired(field, connectorConfig, accessMode)
        const canonicalId = field.canonicalParamId
        const hasCanonicalPair =
          canonicalId && (canonicalGroups.get(canonicalId)?.length ?? 0) === 2
        const raw = sourceConfig[field.id]
        return (
          <div key={field.id}>
            {field.type === 'selector' && field.selectorKey ? (
              <ConnectorSelector
                label={required ? title : `${title} (optional)`}
                hint={description}
                scope={scope}
                field={field as ConnectorConfigField & { selectorKey: SelectorKey }}
                value={raw ?? (field.multi ? [] : '')}
                onChange={(value, selectedOptions) =>
                  onFieldChange(field.id, value, selectedOptions)
                }
                selectedLabels={selectionLabels?.[field.canonicalParamId ?? field.id]}
                credentialId={credentialId}
                serviceAccountSubjectFieldId={
                  credentialType === 'service_account' && connectorConfig.auth.mode === 'oauth'
                    ? connectorConfig.auth.serviceAccountSubjectFieldId
                    : undefined
                }
                sourceConfig={sourceConfig}
                configFields={connectorConfig.configFields}
                canonicalModes={canonicalModes}
                disabled={disabled}
              />
            ) : field.type === 'dropdown' && field.options ? (
              <SearchableSelect
                label={required ? title : `${title} (optional)`}
                searchLabel={`Search ${title.toLowerCase()}`}
                hint={description}
                disabled={disabled}
                placeholder={field.placeholder || `Select ${title.toLowerCase()}`}
                options={field.options.map((option) => ({
                  value: option.id,
                  label: option.label,
                }))}
                value={typeof raw === 'string' ? raw || null : null}
                onValueChange={(value) => {
                  if (value !== null) onFieldChange(field.id, value)
                }}
              />
            ) : (
              <TextField
                label={title}
                optional={!required}
                hint={description}
                disabled={disabled}
                value={Array.isArray(raw) ? raw.join(', ') : raw || ''}
                onChange={(value) => onFieldChange(field.id, value)}
                placeholder={field.placeholder}
              />
            )}
            {hasCanonicalPair && canonicalId && (
              <Button
                variant='quiet'
                size='compact'
                disabled={disabled}
                onClick={() => onToggleCanonicalMode(canonicalId)}
              >
                {field.mode === 'basic' ? 'Switch to manual input' : 'Switch to selector'}
              </Button>
            )}
          </div>
        )
      })}
    </>
  )
}

interface ConnectorAccessProps {
  scope: ResourceScope
  connectorConfig: ConnectorMeta
  value: { accessMode: ConnectorAccessMode }
  onChange: (value: { accessMode: ConnectorAccessMode }) => void
  canAdmin: boolean
  disabled?: boolean
  lockAccessMode?: boolean
  isAvailabilityReady?: boolean
  allowMembers?: boolean
  allowAdmin?: boolean
  allowWorkspace?: boolean
  footer?: ReactNode
  searchSetupSource?: 'slack'
  slackSetupOnly?: boolean
  onSetupNavigate?: () => void
}

/** Chooses how a source connects while preserving its document permissions. */
export function ConnectorAccess({
  scope: explicitScope,
  connectorConfig,
  value,
  onChange,
  canAdmin,
  disabled = false,
  lockAccessMode = false,
  isAvailabilityReady = true,
  allowMembers = true,
  allowAdmin = false,
  allowWorkspace = true,
  footer,
  searchSetupSource,
  slackSetupOnly = false,
  onSetupNavigate,
}: ConnectorAccessProps) {
  const access = useConnectorAccessField({
    scope: explicitScope,
    connectorConfig,
    value,
    canAdmin,
    lockAccessMode,
    allowMembers,
    allowAdmin,
    allowWorkspace,
  })
  const { accountsQuery, currentMode, modes, scope, showSlackSetup, visibleModes } = access
  if (access.hidden) return null
  if (access.singleMode) return canAdmin && footer ? <div>{footer}</div> : null
  const hint =
    canAdmin && isAvailabilityReady && !currentMode?.allowed
      ? `This connection method is not available in this ${scope.kind}.`
      : value.accessMode === 'workspace'
        ? 'Everyone in this workspace can search these documents.'
        : undefined
  return (
    <FieldFrame
      label={slackSetupOnly ? 'Slack app' : allowWorkspace ? 'Connection method' : 'Sync using'}
      error={canAdmin && !showSlackSetup ? accountsQuery.error?.message : undefined}
      hint={hint}
    >
      {slackSetupOnly ? null : lockAccessMode ? (
        <div>
          <Tooltip label='Add a new connection to change the sync method.'>
            <span>
              <StatusTag label={currentMode?.label ?? 'Unavailable'} />
            </span>
          </Tooltip>
        </div>
      ) : access.showModeSelector ? (
        <SegmentedControl
          label='Connection method'
          value={value.accessMode}
          options={visibleModes.map((entry) => ({
            value: entry.mode,
            label: entry.label,
            disabled: !entry.allowed,
          }))}
          onSelect={(mode) => {
            const selection = modes.find((entry) => entry.mode === mode && entry.allowed)
            if (!disabled && selection) onChange({ accessMode: selection.mode })
          }}
        />
      ) : (
        <Muted>{modes.find((entry) => entry.mode === value.accessMode)?.label ?? ''}</Muted>
      )}
      {showSlackSetup &&
        (accountsQuery.isError ? (
          <FailureNotice
            message={getErrorMessage(accountsQuery.error, 'Could not check Slack setup')}
            retrying={accountsQuery.isFetching}
            onRetry={() => void accountsQuery.refetch()}
          />
        ) : accountsQuery.isPending ? (
          <Muted>Checking Slack setup…</Muted>
        ) : accountsQuery.isSuccess && !access.configured && scope.kind === 'organization' ? (
          <div>
            <Button
              size='compact'
              render={
                <Link
                  href={slackSearchSetupHref(scope.organizationId, searchSetupSource ?? 'search')}
                  onClick={onSetupNavigate}
                />
              }
            >
              Set up Slack
            </Button>
          </div>
        ) : null)}
      {canAdmin && footer}
    </FieldFrame>
  )
}

interface ContentCredentialFieldProps {
  credentialId: string | null
  onChange: (credentialId: string | null) => void
  options: readonly { value: string; label: string }[]
  disabled?: boolean
}

const CONNECTED_MEMBERS = '__connected_members__'

/** A dedicated source account supplies content; member accounts supply visibility only. */
export function ContentCredentialField({
  credentialId,
  onChange,
  options,
  disabled,
}: ContentCredentialFieldProps) {
  return (
    <SearchableSelect
      label='Sync documents with'
      searchLabel='Search accounts'
      placeholder='Choose an account'
      value={credentialId ?? CONNECTED_MEMBERS}
      options={[{ value: CONNECTED_MEMBERS, label: 'Connected members' }, ...options]}
      onValueChange={(value) => onChange(value === CONNECTED_MEMBERS ? null : value)}
      disabled={disabled}
    />
  )
}

interface GitHubConnectionFieldProps {
  installations: Credential[]
  credentialId: string | null
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  disabled: boolean
  onRetry: () => void
  onConnect: () => void
  onChange: (credentialId: string) => void
  connecting?: boolean
  connectionError?: string | null
  hint?: string
  onCancel?: () => void
  onCheckConnection: () => void
  isChecking?: boolean
  children?: ReactNode
}

export function GitHubConnectionField({
  installations,
  credentialId,
  isLoading,
  isFetching,
  error,
  disabled,
  onRetry,
  onConnect,
  onChange,
  connecting = false,
  connectionError,
  hint,
  onCancel,
  onCheckConnection,
  isChecking = false,
  children,
}: GitHubConnectionFieldProps) {
  return (
    <FieldFrame label='GitHub' hint={installations.length > 0 ? undefined : hint}>
      {connecting ? (
        <ActionRow>
          <Button size='compact' disabled={isChecking} onClick={onCheckConnection}>
            {isChecking ? 'Checking GitHub…' : 'Check connection'}
          </Button>
          <Button size='compact' variant='quiet' onClick={onCancel}>
            Cancel
          </Button>
        </ActionRow>
      ) : error && installations.length === 0 ? (
        <FailureNotice
          message={getErrorMessage(error, 'Could not load GitHub connections')}
          retrying={isFetching}
          onRetry={onRetry}
        />
      ) : installations.length > 0 ? (
        <SearchableSelect
          label='GitHub account'
          labelHidden
          searchLabel='Search GitHub connections'
          placeholder='Select GitHub connection'
          options={installations.map((credential) => ({
            value: credential.id,
            label: credential.name || 'GitHub',
          }))}
          value={credentialId}
          onValueChange={(value) => {
            if (value) onChange(value)
          }}
          createLabel='Connect another organization'
          onCreate={onConnect}
          disabled={disabled}
          hint={hint}
        />
      ) : (
        <div>
          <Button size='compact' disabled={disabled || isLoading} onClick={onConnect}>
            {isLoading ? 'Loading GitHub…' : 'Connect GitHub'}
          </Button>
        </div>
      )}
      {connectionError && <InlineNotice intent='danger' message={connectionError} />}
      {children}
    </FieldFrame>
  )
}

interface GitLabFieldsProps {
  form: GitLabPermissionForm
  disabled?: boolean
}

export function GitLabTokenTabs({ form, disabled }: GitLabFieldsProps) {
  return (
    <SegmentedControl
      label='GitLab token type'
      value={form.mode}
      options={GITLAB_TOKEN_TABS.map((tab) => ({ ...tab, disabled }))}
      onSelect={(value) => {
        if (!disabled) form.setMode(value)
      }}
    />
  )
}

/** Uploaded mappings stay in the form's ephemeral state, never in a saved draft. */
export function GitLabCsvUploads({ form, disabled }: GitLabFieldsProps) {
  if (form.mode !== 'csv') return null
  return (
    <>
      <Muted>Update these files when access changes. Confidential issues are excluded.</Muted>
      {(['userMapping', 'projectPermissions'] as const).map((kind) => {
        const definition = GITLAB_CSV_FILES[kind]
        const selected = form.files[kind]
        const saved = form.saved?.[kind]
        const filename = selected?.upload?.filename ?? saved?.filename
        const count = selected?.rowCount ?? saved?.rowCount
        return (
          <div key={kind}>
            <FileField
              label={definition.title}
              accept='.csv,text/csv'
              disabled={disabled || selected?.loading}
              prompt={selected?.loading ? 'Validating…' : 'Drop CSV or click to upload'}
              selection={
                filename
                  ? {
                      name: filename,
                      detail:
                        count !== undefined && !selected?.loading
                          ? `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'} · ${selected?.upload ? 'Ready to save' : 'Saved'}`
                          : undefined,
                    }
                  : undefined
              }
              error={selected?.error}
              onFileChange={(file) => void form.selectFile(kind, file)}
            />
            <Button
              variant='quiet'
              size='compact'
              onClick={() => {
                const link = document.createElement('a')
                link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(definition.template)}`
                link.download = definition.filename
                link.click()
              }}
            >
              Download template
            </Button>
          </div>
        )
      })}
    </>
  )
}

interface ApiKeyFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  workspaceId?: string
  disabled?: boolean
}

/** Takes a key or a `{{SECRET}}` reference. Only secret names are offered, never their values. */
export function ApiKeyField({
  label,
  value,
  onChange,
  placeholder,
  workspaceId,
  disabled,
}: ApiKeyFieldProps) {
  const [loadKeys, setLoadKeys] = useState(false)
  const keys = useAvailableEnvVarKeys(workspaceId, { enabled: loadKeys })
  return (
    <div onFocusCapture={() => setLoadKeys(true)} onPointerEnter={() => setLoadKeys(true)}>
      <SecretField
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        hint='Paste a key, or reference a secret as {{NAME}}.'
      />
      {keys && keys.size > 0 && (
        <ActionMenu
          label='Use a secret'
          icon='I050'
          triggerSize='compact'
          actions={[...keys].sort().map((key) => ({
            id: key,
            label: key,
            onSelect: () => onChange(`{{${key}}}`),
          }))}
        />
      )}
    </div>
  )
}
