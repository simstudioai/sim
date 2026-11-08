'use client'

import { Button } from '@sim/emcn/button'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import {
  type SelectorKey,
  useConnectorSelector,
} from '@/platform/lib/data/knowledge/connector-selectors'
import type {
  ConfigFieldMap,
  ConfigFieldValue,
  ConnectorConfigField,
  SourceSelectionLabel,
} from '@/platform/lib/data/knowledge/connectors'

interface ConnectorSelectorFieldProps {
  field: ConnectorConfigField & { selectorKey: SelectorKey }
  label: string
  hint?: string
  value: ConfigFieldValue
  onChange: (value: ConfigFieldValue, selectedOptions?: SourceSelectionLabel[]) => void
  credentialId: string | null
  serviceAccountSubjectFieldId?: string
  sourceConfig: ConfigFieldMap
  configFields: ConnectorConfigField[]
  canonicalModes: Record<string, 'basic' | 'advanced'>
  selectedLabels?: SourceSelectionLabel[]
  disabled?: boolean
}

/**
 * Chooses a connector's source items from the provider, through the selected account: one item or
 * several, searched on the provider, paged as the list scrolls, and all of them at once where the
 * source allows. It waits on the account and on any field it depends on.
 */
export function ConnectorSelectorField({
  field,
  label,
  hint,
  value,
  onChange,
  credentialId,
  serviceAccountSubjectFieldId,
  sourceConfig,
  configFields,
  canonicalModes,
  selectedLabels,
  disabled,
}: ConnectorSelectorFieldProps) {
  const selector = useConnectorSelector({
    field,
    value,
    onChange,
    credentialId,
    serviceAccountSubjectFieldId,
    sourceConfig,
    configFields,
    canonicalModes,
    selectedLabels,
    disabled,
  })
  const blocked = disabled || !credentialId || !selector.depsResolved
  const visible = selector.comboboxOptions.filter((option) => !option.hidden)
  const search = {
    query: selector.searchTerm,
    onQueryChange: (query: string, details: { reason: string }) => {
      if (details.reason !== 'item-press') selector.handleSearchChange(query)
    },
    hasMore: selector.hasMore,
    loading: selector.isLoading || selector.isFetchingMore || selector.isLoadingAll,
    error: selector.error ? 'Could not load options.' : undefined,
    onLoadMore: () => void selector.loadMore(),
    onRetry: () => void selector.refetch(),
    emptyMessage: selector.emptyMessage,
  }
  const labels = Object.fromEntries(
    selector.comboboxOptions.map((option) => [option.value, option.label])
  )

  if (selector.isMulti) {
    const values = Array.isArray(value) ? value : value ? [value] : []
    const canSelectAll =
      field.allowSelectAll &&
      (selector.options.length > 0 || selector.hasMore || selector.allSelected)
    return (
      <MultiSelect
        label={label}
        options={visible.map((option) => ({ value: option.value, label: option.label }))}
        value={values}
        selectedLabels={labels}
        onValueChange={selector.handleChange}
        placeholder={selector.placeholder}
        searchLabel={`Search ${field.title.toLowerCase()}`}
        disabled={blocked}
        error={selector.bulkError ?? undefined}
        hint={hint}
        search={{
          ...search,
          footer: canSelectAll ? (
            <Button
              variant='quiet'
              size='compact'
              disabled={
                !selector.isEnabled ||
                selector.hasSearch ||
                selector.isFetching ||
                selector.isLoadingAll
              }
              onClick={() => void selector.selectAll()}
            >
              {selector.isLoadingAll
                ? 'Selecting…'
                : selector.allSelected
                  ? 'Clear selection'
                  : 'Select all'}
            </Button>
          ) : undefined,
        }}
      />
    )
  }

  return (
    <SearchableSelect
      label={label}
      options={visible.map((option) => ({ value: option.value, label: option.label }))}
      value={selector.singleValue || null}
      selectedLabel={selector.singleValue ? labels[selector.singleValue] : undefined}
      onValueChange={(next) => selector.handleChange(next ?? '')}
      placeholder={selector.placeholder}
      searchLabel={`Search ${field.title.toLowerCase()}`}
      disabled={blocked}
      hint={hint}
      search={search}
    />
  )
}
