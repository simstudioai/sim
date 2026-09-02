'use client'

import { useCallback, useMemo } from 'react'
import { Combobox, type ComboboxOption } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  isTableInFolderScope,
  parseFolderScope,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/table-selector/scope'
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

  /*
   * A sibling folder field narrows what this picker offers, so a user cannot
   * build a selection from outside the folder they just chose. Purely a
   * design-time affordance — the folder never travels, because every operation
   * here addresses exactly one table.
   *
   * Falling back to this control's own id keeps the hook call unconditional for
   * a picker with no folder scope; its own value is a table id, never a folder
   * path, so the scope reads as absent.
   */
  const [folderScopeValue] = useSubBlockValue<unknown>(
    blockId,
    subBlock.folderScope?.fieldId ?? subBlock.id
  )
  const folderScopePath =
    subBlock.folderScope && typeof folderScopeValue === 'string' ? folderScopeValue.trim() : ''

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
    /* Decode the scope once for the whole list rather than per row. */
    const scopeSegments = parseFolderScope(folderScopePath)
    const scoped = scopeSegments?.length
      ? tables.filter((table) => isTableInFolderScope(table, tableFolders, scopeSegments))
      : tables
    const duplicateNames = collectDuplicateNames(scoped.map((table) => table.name.toLowerCase()))
    return scoped.map((table) => ({
      label: disambiguateLabelByFolder(
        table.name.toLowerCase(),
        table.folderId,
        tableFolders,
        duplicateNames
      ),
      value: table.id,
    }))
  }, [tables, tableFolders, folderScopePath])

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
