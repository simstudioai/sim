'use client'

import { useCallback, useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Combobox, type ComboboxOption, Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
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
 * Table selector component with dropdown and link to view table
 *
 * @remarks
 * Provides a dropdown to select workspace tables and an external link
 * to navigate directly to the table page view when a table is selected.
 * Uses React Query for efficient data fetching and caching.
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

  // Use React Query hook for table data - it handles caching, loading, and error states
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

  const handleNavigateToTable = useCallback(() => {
    if (tableId && workspaceId) {
      window.open(`/workspace/${workspaceId}/tables/${tableId}`, '_blank')
    }
  }, [workspaceId, tableId])

  const hasSelectedTable = tableId && !tableId.startsWith('<')

  // Convert error object to string if needed
  const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined

  return (
    <div className='flex items-center gap-[6px]'>
      <div className='flex-1'>
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
      </div>
      {hasSelectedTable && !isPreview && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              size='sm'
              className='h-[30px] w-[30px] flex-shrink-0 p-0'
              onClick={handleNavigateToTable}
            >
              <ExternalLink className='h-[14px] w-[14px] text-[var(--text-secondary)]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            <p>View table</p>
          </Tooltip.Content>
        </Tooltip.Root>
      )}
    </div>
  )
}
