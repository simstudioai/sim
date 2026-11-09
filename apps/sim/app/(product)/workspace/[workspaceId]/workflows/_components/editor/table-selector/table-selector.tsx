'use client'

import { useMemo } from 'react'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { isWorkflowSearchTargetForField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/table-selector/table-selector.module.css'
import {
  type SubBlockConfig,
  useFolderMap,
  useSubBlockValue,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'
import {
  collectDuplicateNames,
  disambiguateLabelByFolder,
  useTablesList,
} from '@/platform/lib/data/workflow-editor/selectors'

interface TableSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

/**
 * Picks one of the workspace's tables. Two tables can share a name in different folders, so a
 * colliding name carries its folder path; the label row links to the chosen table.
 */
export function TableSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: TableSelectorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { workspaceId } = useWorkflowScope()
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlock.id)
  const readable = !isPreview && !disabled
  const { data: tables = [], error } = useTablesList(readable ? workspaceId : undefined)
  const { data: tableFolders = {} } = useFolderMap(readable ? workspaceId : undefined, 'table')

  const value = isPreview ? previewValue : storeValue
  const tableId = typeof value === 'string' && value ? value : null

  // Names show in lowercase, so collisions are found on that same form; folder paths keep their case.
  const options = useMemo(() => {
    const duplicateNames = collectDuplicateNames(tables.map((table) => table.name.toLowerCase()))
    return tables.map((table) => ({
      value: table.id,
      label: disambiguateLabelByFolder(
        table.name.toLowerCase(),
        table.folderId,
        tableFolders,
        duplicateNames
      ),
    }))
  }, [tables, tableFolders])

  const searchMatch = isWorkflowSearchTargetForField({
    activeSearchTarget,
    subBlockId: subBlock.id,
  })
  const label = subBlock.title || subBlock.placeholder || 'Table'
  const selectedLabel = options.find((option) => option.value === tableId)?.label
  const handleChange = (next: string | null) => {
    if (readable && next) setStoreValue(next)
  }

  return (
    <div className={styles.picker} data-search-match={searchMatch || undefined}>
      <SearchableSelect
        label={label}
        labelHidden
        options={options}
        value={tableId}
        selectedLabel={tableId ? (selectedLabel ?? tableId) : undefined}
        onValueChange={handleChange}
        placeholder={subBlock.placeholder || 'Select a table'}
        searchLabel='Search...'
        error={error?.message}
        disabled={!readable}
      />
    </div>
  )
}
