'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Combobox, type ComboboxOption, Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'

interface TableSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
}

interface TableOption {
  label: string
  id: string
}

/**
 * Table selector component with dropdown and link to view table
 *
 * @remarks
 * Provides a dropdown to select workspace tables and an external link
 * to navigate directly to the table page view when a table is selected.
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
  const [tables, setTables] = useState<TableOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = isPreview ? previewValue : storeValue
  const tableId = typeof value === 'string' ? value : null

  /**
   * Fetches available tables from the API
   */
  const fetchTables = useCallback(async () => {
    if (!workspaceId || isPreview || disabled) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/table?workspaceId=${workspaceId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch tables')
      }

      const data = await response.json()
      const tableOptions = (data.data?.tables || []).map((table: { id: string; name: string }) => ({
        label: table.name,
        id: table.id,
      }))
      setTables(tableOptions)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch tables'
      setError(errorMessage)
      setTables([])
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, isPreview, disabled])

  useEffect(() => {
    if (!isPreview && !disabled && tables.length === 0 && !isLoading && !error) {
      void fetchTables()
    }
  }, [fetchTables, isPreview, disabled, tables.length, isLoading, error])

  const options = useMemo<ComboboxOption[]>(() => {
    return tables.map((table) => ({
      label: table.label.toLowerCase(),
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
          onOpenChange={(open) => {
            if (open) {
              void fetchTables()
            }
          }}
          isLoading={isLoading}
          error={error}
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
