'use client'

import { useCallback, useMemo } from 'react'
import { Combobox, type ComboboxOption } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import type { SubBlockConfig } from '@/blocks/types'
import { useFolderMap } from '@/hooks/queries/folders'
import { useTablesList } from '@/hooks/queries/tables'
import { collectDuplicateNames, disambiguateLabelByFolder } from '@/hooks/queries/utils/folder-tree'

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
  const activeSearchTarget = useActiveSearchTarget()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)

  const {
    data: tables = [],
    isLoading,
    error,
  } = useTablesList(isPreview || disabled ? undefined : workspaceId)

  const { data: tableFolders = {} } = useFolderMap(
    isPreview || disabled ? undefined : workspaceId,
    'table'
  )

  const value = isPreview ? previewValue : storeValue
  const tableId = typeof value === 'string' ? value : null

  /**
   * Two tables can share a name in different folders, so a colliding name is
   * suffixed with its folder path. Table names are lowercased for display (the
   * pre-existing styling here), and collisions are detected on that same
   * lowercased form so `Leads` and `leads` — identical once displayed — are
   * disambiguated too. The folder path keeps its authored casing.
   */
  const options = useMemo<ComboboxOption[]>(() => {
    const duplicateNames = collectDuplicateNames(tables.map((table) => table.name.toLowerCase()))
    return tables.map((table) => ({
      label: disambiguateLabelByFolder(
        table.name.toLowerCase(),
        table.folderId,
        tableFolders,
        duplicateNames
      ),
      value: table.id,
    }))
  }, [tables, tableFolders])

  const handleChange = useCallback(
    (selectedValue: string) => {
      if (isPreview || disabled) return
      setStoreValue(selectedValue)
    },
    [isPreview, disabled, setStoreValue]
  )

  const errorMessage = error?.message
  const selectedLabel = options.find((option) => option.value === tableId)?.label ?? ''
  const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
    activeSearchTarget,
    subBlockId: subBlock.id,
    valuePath: [],
    label: selectedLabel,
  })

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
      overlayContent={
        workflowSearchHighlight ? (
          <span className='block truncate'>
            {formatDisplayText(selectedLabel, { workflowSearchHighlight })}
          </span>
        ) : undefined
      }
    />
  )
}
