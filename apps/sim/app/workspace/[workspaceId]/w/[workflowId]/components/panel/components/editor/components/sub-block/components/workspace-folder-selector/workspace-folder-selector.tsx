'use client'

import { useMemo } from 'react'
import { ChipCombobox } from '@sim/emcn'
import { useParams } from 'next/navigation'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { parseFolderPath } from '@/lib/folders/paths'
import { readFolderPath, readFolderPaths } from '@/lib/folders/selection'
import { useResourceFolders } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-resource-folders'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'

interface WorkspaceFolderSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
}

/**
 * Picks one or more workspace folders and stores their canonical percent-encoded paths.
 *
 * Folder hierarchy is shown as a searchable breadcrumb instead of a second
 * bespoke tree surface. This keeps the field to one standard EMCN control,
 * makes duplicate leaf names unambiguous, and gives keyboard users the same
 * interaction as every other editor combobox.
 */
export function WorkspaceFolderSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: WorkspaceFolderSelectorProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const resourceType = (subBlock.resourceType as FolderResourceType | undefined) ?? 'file'

  const [storeValue, setStoreValue] = useSubBlockValue<unknown>(blockId, subBlock.id)
  const value = isPreview ? previewValue : storeValue
  const selected = readFolderPath(value)
  const selectedPaths = readFolderPaths(value)
  const { folders, isLoading } = useResourceFolders(workspaceId, resourceType)

  const options = useMemo(() => {
    const folderOptions = folders.map((folder) => ({
      value: folder.path,
      label: parseFolderPath(folder.path).join(' / '),
    }))
    return subBlock.multiSelect
      ? folderOptions
      : [{ value: '', label: 'Anywhere in the workspace' }, ...folderOptions]
  }, [folders, subBlock.multiSelect])

  return (
    <ChipCombobox
      options={options}
      value={subBlock.multiSelect ? undefined : selected}
      onChange={(value) => {
        if (!isPreview) setStoreValue(value)
      }}
      multiSelect={subBlock.multiSelect}
      multiSelectValues={subBlock.multiSelect ? selectedPaths : undefined}
      onMultiSelectChange={(values) => {
        if (!isPreview) setStoreValue(values.length > 0 ? values : '')
      }}
      showAllOption={subBlock.multiSelect}
      allOptionLabel='Anywhere in the workspace'
      placeholder={subBlock.placeholder ?? 'Anywhere in the workspace'}
      disabled={disabled || isPreview}
      isLoading={isLoading}
      searchable
      searchPlaceholder='Search folders...'
      emptyMessage='No folders found'
      className='w-full'
    />
  )
}
