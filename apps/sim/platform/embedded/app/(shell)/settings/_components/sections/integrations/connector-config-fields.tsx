'use client'

import { Button } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { PopupNote, PopupRow } from '@sim/emcn/menu/popup-row'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { InlineNotice } from '@sim/emcn/status'
import { isConnectorFieldRequired } from '@/lib/knowledge/connectors/access-fields'
import type { SelectorKey } from '@/lib/selectors/manifest'
import type { ConnectorConfigField } from '@/connectors/types'
import type { ConnectorConfigFieldsProps } from '@/hooks/kb/connectors/use-connector-config-fields'
import { useConnectorSelector } from '@/hooks/kb/connectors/use-connector-selector'

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
  const query = selector.searchTerm.trim().toLowerCase()
  const visibleOptions = selector.comboboxOptions
    .filter((option) => !option.hidden && option.label.toLowerCase().includes(query))
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
    emptyMessage:
      selector.truncated && selector.hasSearch
        ? 'No matches in partial results'
        : selector.hasMore && selector.hasSearch
          ? 'No matches in loaded options'
          : selector.hasMore
            ? 'No options loaded'
            : selector.emptyMessage,
    footer:
      selector.hasMore && selector.hasSearch ? (
        <PopupRow
          disabled={selector.isFetchingMore}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void (selector.error ? selector.refetch() : selector.loadAll())}
        >
          {selector.isFetchingMore
            ? 'Searching options…'
            : selector.error
              ? 'Try again'
              : 'Search all options'}
        </PopupRow>
      ) : selector.truncated && visibleOptions.length > 0 ? (
        <PopupNote>Showing partial results</PopupNote>
      ) : undefined,
  }
  const blocked = disabled || !credentialId || !selector.depsResolved
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
          hint={hint}
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
      hint={hint}
    />
  )
}

interface ConnectorFieldListProps {
  config: Omit<ConnectorConfigFieldsProps, 'isFieldVisible'>
  isFieldVisible: ConnectorConfigFieldsProps['isFieldVisible']
}

/** A connector's dynamic configuration fields, with their selector/manual pairs. */
export function ConnectorConfigFields({ config, isFieldVisible }: ConnectorFieldListProps) {
  const {
    scope,
    accessMode = 'workspace',
    connectorConfig,
    sourceConfig,
    selectionLabels,
    credentialId,
    credentialType,
    canonicalGroups,
    canonicalModes,
    onFieldChange,
    onToggleCanonicalMode,
    disabled,
  } = config
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
                placeholder={field.placeholder || `Enter ${title.toLowerCase()}`}
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
