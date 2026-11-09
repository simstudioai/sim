'use client'

import { ChipCombobox, type ChipModalFieldAria } from '@sim/emcn-legacy'
import {
  type ConnectorSelectorOptions,
  useConnectorSelector,
} from '@/hooks/kb/connectors/use-connector-selector'

interface ConnectorSelectorFieldProps extends ConnectorSelectorOptions {
  controlAria?: ChipModalFieldAria
}

export function ConnectorSelectorField({ controlAria, ...options }: ConnectorSelectorFieldProps) {
  const { field, value, disabled, credentialId } = options
  const {
    allSelected,
    bulkError,
    comboboxOptions,
    depsResolved,
    emptyMessage,
    error,
    handleChange,
    handleSearchChange,
    hasMore,
    hasSearch,
    isEnabled,
    isFetching,
    isFetchingMore,
    isLoading,
    isLoadingAll,
    isLoadingSelectedOptions,
    isMulti,
    loadAll,
    loadMore,
    options: selectorOptions,
    placeholder,
    refetch,
    selectAll,
    singleValue,
    truncated,
  } = useConnectorSelector(options)

  if (isMulti) {
    const multiValues = Array.isArray(value) ? value : value ? [value] : []
    return (
      <div className='flex flex-col gap-1'>
        <ChipCombobox
          {...controlAria}
          aria-label={field.title}
          multiSelect
          options={
            field.allowSelectAll && (selectorOptions.length > 0 || hasMore || allSelected)
              ? [
                  {
                    value: field.selectAllValue ?? '',
                    label: 'All',
                    disabled: !isEnabled || hasSearch || isFetching || isLoadingAll,
                    onSelect: () => void selectAll(),
                    keepOpen: true,
                    selected: allSelected,
                  },
                  ...comboboxOptions,
                ]
              : comboboxOptions
          }
          multiSelectValues={multiValues}
          onMultiSelectChange={handleChange}
          searchable
          onSearchChange={handleSearchChange}
          searchPlaceholder={`Search ${field.title.toLowerCase()}...`}
          placeholder={placeholder}
          disabled={disabled || !credentialId || !depsResolved}
          isLoading={
            isEnabled && (isLoading || (selectorOptions.length === 0 && isLoadingSelectedOptions))
          }
          hasMore={hasMore || Boolean(error)}
          isLoadingMore={isFetchingMore}
          isLoadingAll={isLoadingAll}
          truncated={truncated}
          onLoadMore={error ? refetch : loadMore}
          onLoadAll={error ? refetch : loadAll}
          emptyMessage={emptyMessage}
          error={error?.message}
        />
        {bulkError && (
          <p role='alert' className='text-[var(--text-error)] text-caption'>
            {bulkError}
          </p>
        )}
      </div>
    )
  }

  return (
    <ChipCombobox
      {...controlAria}
      aria-label={field.title}
      options={comboboxOptions}
      value={singleValue || undefined}
      onChange={handleChange}
      searchable
      onSearchChange={handleSearchChange}
      searchPlaceholder={`Search ${field.title.toLowerCase()}...`}
      placeholder={placeholder}
      disabled={disabled || !credentialId || !depsResolved}
      isLoading={
        isEnabled && (isLoading || (selectorOptions.length === 0 && isLoadingSelectedOptions))
      }
      hasMore={hasMore || Boolean(error)}
      isLoadingMore={isFetchingMore}
      isLoadingAll={isLoadingAll}
      truncated={truncated}
      onLoadMore={error ? refetch : loadMore}
      onLoadAll={error ? refetch : loadAll}
      emptyMessage={emptyMessage}
      error={error?.message}
    />
  )
}
