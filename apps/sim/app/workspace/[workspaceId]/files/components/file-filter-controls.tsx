'use client'

import { Button, ChipCombobox, type ComboboxOption } from '@sim/emcn'
import { FILE_BROWSER_SIZE_OPTIONS, FILE_BROWSER_TYPE_OPTIONS } from '@/lib/workspace-files/browser'
import {
  ResourceFilterPanel,
  ResourceFilterSection,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'

interface FileFilterControlsProps {
  types: string[]
  sizes: string[]
  creatorIds: string[]
  creators: ComboboxOption[]
  onTypes: (values: string[]) => void
  onSizes: (values: string[]) => void
  onCreators: (values: string[]) => void
  onClear: () => void
}

export function FileFilterControls({
  types,
  sizes,
  creatorIds,
  creators,
  onTypes,
  onSizes,
  onCreators,
  onClear,
}: FileFilterControlsProps) {
  const typeLabel =
    types.length === 0
      ? 'All'
      : types.length === 1
        ? (FILE_BROWSER_TYPE_OPTIONS.find((option) => option.value === types[0])?.label ?? types[0])
        : `${types.length} selected`
  const sizeLabel =
    sizes.length === 0
      ? 'All'
      : sizes.length === 1
        ? (FILE_BROWSER_SIZE_OPTIONS.find((option) => option.value === sizes[0])?.label.split(
            ' ('
          )[0] ?? sizes[0])
        : `${sizes.length} selected`
  const creatorLabel =
    creatorIds.length === 0
      ? 'All'
      : creatorIds.length === 1
        ? (creators.find((option) => option.value === creatorIds[0])?.label ?? '1 creator')
        : `${creatorIds.length} creators`
  return (
    <ResourceFilterPanel>
      <ResourceFilterSection label='File Type'>
        <ChipCombobox
          options={[...FILE_BROWSER_TYPE_OPTIONS]}
          multiSelect
          multiSelectValues={types}
          onMultiSelectChange={onTypes}
          overlayLabel={typeLabel}
          overlayContent={typeLabel}
          showAllOption
          allOptionLabel='All'
          className='w-full'
        />
      </ResourceFilterSection>
      <ResourceFilterSection label='Size'>
        <ChipCombobox
          options={[...FILE_BROWSER_SIZE_OPTIONS]}
          multiSelect
          multiSelectValues={sizes}
          onMultiSelectChange={onSizes}
          overlayLabel={sizeLabel}
          overlayContent={sizeLabel}
          showAllOption
          allOptionLabel='All'
          className='w-full'
        />
      </ResourceFilterSection>
      {creators.length > 0 && (
        <ResourceFilterSection label='Uploaded By'>
          <ChipCombobox
            options={creators}
            multiSelect
            multiSelectValues={creatorIds}
            onMultiSelectChange={onCreators}
            overlayLabel={creatorLabel}
            overlayContent={creatorLabel}
            searchable
            searchPlaceholder='Search creators...'
            showAllOption
            allOptionLabel='All'
            className='w-full'
          />
        </ResourceFilterSection>
      )}
      {(types.length > 0 || sizes.length > 0 || creatorIds.length > 0) && (
        <Button
          variant='ghost'
          onClick={onClear}
          className='h-[32px] w-full text-caption hover-hover:bg-[var(--surface-active)]'
        >
          Clear all filters
        </Button>
      )}
    </ResourceFilterPanel>
  )
}
