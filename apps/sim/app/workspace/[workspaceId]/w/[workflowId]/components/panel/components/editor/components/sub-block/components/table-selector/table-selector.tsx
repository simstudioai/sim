'use client'

import { useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Combobox, type ComboboxOption } from '@/components/emcn'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useTablesList } from '@/hooks/queries/tables'

interface TableSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
}

/**
 * Table selector component with dropdown for selecting workspace tables
 *
 * @remarks
 * Provides a dropdown to select workspace tables.
 * Uses React Query for efficient data fetching and caching.
 * The external link to view the table is rendered in the label row by the parent SubBlock.
 */
export function TableSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: TableSelectorProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)

  const {
    data: tables = [],
    isLoading,
    error,
  } = useTablesList(isPreview || disabled ? undefined : workspaceId)

  const value = isPreview ? previewValue : storeValue
  const tableId = typeof value === 'string' ? value : null

  const options = useMemo<ComboboxOption[]>(() => {
    return tables.map((table) => ({
      label: table.name.toLowerCase(),
      value: table.id,
    }))
  }, [tables])

  const handleChange = useCallback(
    (selectedValue: string) => {
      if (isPreview || disabled) return
      setStoreValue(selectedValue)
    },
    [isPreview, disabled, setStoreValue]
  )

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined

  return (
    <Combobox
      options={options}
      value={tableId ?? undefined}
      onChange={handleChange}
      placeholder={subBlock.placeholder || 'Select a table'}
      disabled={disabled || isPreview}
      editable={false}
      isLoading={isLoading}
      error={errorMessage}
      searchable={options.length > 5}
      searchPlaceholder='Search...'
    />
  )
}
