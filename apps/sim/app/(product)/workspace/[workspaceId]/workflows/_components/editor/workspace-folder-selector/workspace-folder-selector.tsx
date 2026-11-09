'use client'

import { useMemo } from 'react'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/workspace-folder-selector/workspace-folder-selector.module.css'
import {
  type SubBlockConfig,
  useResourceFolders,
  useSubBlockValue,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'
import {
  type FolderResourceType,
  parseFolderPath,
  readFolderPath,
  readFolderPaths,
} from '@/platform/lib/data/workflow-editor/selectors'

/** The multi-select row standing for no folder filter at all. */
const ANYWHERE = '__anywhere__'
const ANYWHERE_LABEL = 'Anywhere in the workspace'

interface WorkspaceFolderSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  /** A required field offers no workspace-root choice. */
  required?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

/**
 * Picks one or more workspace folders and stores their canonical percent-encoded paths. Each folder
 * reads as its breadcrumb, so folders sharing a name stay distinct.
 */
export function WorkspaceFolderSelector({
  blockId,
  subBlock,
  disabled = false,
  required = false,
  isPreview = false,
  previewValue,
}: WorkspaceFolderSelectorProps) {
  const { workspaceId } = useWorkflowScope()
  const resourceType = (subBlock.resourceType as FolderResourceType | undefined) ?? 'file'
  const [storeValue, setStoreValue] = useSubBlockValue<unknown>(blockId, subBlock.id)
  const value = isPreview ? previewValue : storeValue
  const selected = readFolderPath(value)
  const selectedPaths = readFolderPaths(value)
  const { folders, isPlaceholderData, error, refetch } = useResourceFolders(
    workspaceId,
    resourceType
  )

  const folderOptions = useMemo(
    () =>
      (isPlaceholderData ? [] : folders).map((folder) => ({
        value: folder.path,
        label: parseFolderPath(folder.path).join(' / '),
      })),
    [folders, isPlaceholderData]
  )
  const fieldDisabled = disabled || isPreview || isPlaceholderData
  const label = subBlock.title || subBlock.placeholder || 'Folder'

  if (subBlock.multiSelect) {
    const options = [{ value: ANYWHERE, label: ANYWHERE_LABEL }, ...folderOptions]
    const chosen = selectedPaths.length > 0 ? selectedPaths : [ANYWHERE]
    return (
      <div className={styles.picker}>
        <MultiSelect
          label={label}
          labelHidden
          options={options}
          value={chosen}
          onValueChange={(values) => {
            if (isPreview) return
            const pickedAnywhere = values.includes(ANYWHERE) && !chosen.includes(ANYWHERE)
            const paths = pickedAnywhere ? [] : values.filter((path) => path !== ANYWHERE)
            setStoreValue(paths.length > 0 ? paths : '')
          }}
          placeholder={subBlock.placeholder ?? ANYWHERE_LABEL}
          searchLabel='Search folders...'
          onOpenChange={(open) => {
            if (open && error) void refetch()
          }}
          error={error ?? undefined}
          disabled={fieldDisabled}
        />
      </div>
    )
  }

  const options = required
    ? folderOptions
    : [{ value: '', label: subBlock.placeholder ?? 'Workspace root' }, ...folderOptions]
  const selectedOption = options.find((option) => option.value === selected)
  return (
    <div className={styles.picker}>
      <SearchableSelect
        label={label}
        labelHidden
        options={options}
        value={selectedOption ? selected : null}
        selectedLabel={selectedOption?.label ?? (selected || undefined)}
        onValueChange={(next) => {
          if (!isPreview && next !== null) setStoreValue(next)
        }}
        onOpenChange={(open) => {
          if (open && error) void refetch()
        }}
        placeholder={subBlock.placeholder ?? ANYWHERE_LABEL}
        searchLabel='Search folders...'
        error={error ?? undefined}
        disabled={fieldDisabled}
      />
    </div>
  )
}
