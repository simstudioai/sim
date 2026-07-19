'use client'

import { useMemo } from 'react'
import { ChipCombobox, type ComboboxOption } from '@sim/emcn'
import type { FileModuleConfig } from '@/lib/interfaces'
import { InspectorField } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/inspector-field'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

export interface FileModuleFieldsProps {
  workspaceId: string
  value: FileModuleConfig
  /**
   * The second argument reports whether the emitted config is safe to persist.
   * A file binding has no invalid intermediate state — an unresolvable id is
   * tolerated by design — so this section always reports `true`.
   */
  onChange: (next: FileModuleConfig, isValid: boolean) => void
  disabled?: boolean
}

/**
 * Config section for a file module: the one workspace file it previews.
 *
 * The picker gains a leading `None` entry once a file is bound so the binding
 * can be cleared, and surfaces an error when the bound id no longer resolves —
 * layout validation only guards writes, so a file deleted after wiring stays in
 * the config until the user repoints it.
 */
export function FileModuleFields({
  workspaceId,
  value,
  onChange,
  disabled = false,
}: FileModuleFieldsProps) {
  const files = useWorkspaceFiles(workspaceId)

  const options = useMemo<ComboboxOption[]>(() => {
    const list = (files.data ?? []).map((file) => ({ label: file.name, value: file.id }))
    if (!value.fileId) return list
    return [{ label: 'None', value: '' }, ...list]
  }, [files.data, value.fileId])

  const fileMissing =
    value.fileId !== null &&
    files.data !== undefined &&
    !files.data.some((file) => file.id === value.fileId)

  return (
    <InspectorField
      title='File'
      hint="The module shows the file's details with a link to open it."
      error={fileMissing ? 'This file is no longer in the workspace.' : undefined}
    >
      <ChipCombobox
        options={options}
        value={value.fileId ?? ''}
        onChange={(next) => onChange({ fileId: next === '' ? null : next }, true)}
        placeholder='Select a file'
        searchable
        searchPlaceholder='Search files...'
        emptyMessage='No files in this workspace'
        isLoading={files.isLoading}
        disabled={disabled}
        maxHeight={260}
        aria-label='File'
      />
    </InspectorField>
  )
}
