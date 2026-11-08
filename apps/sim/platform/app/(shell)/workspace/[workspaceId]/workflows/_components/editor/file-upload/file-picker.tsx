'use client'

import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import type { FilePickerState } from '@/platform/lib/data/workflow-editor/uploads'

/** What choosing a file does: fill an empty field, add to the list, or replace the one file. */
type FilePickerPurpose = 'choose' | 'add' | 'replace'

const PLACEHOLDER: Record<FilePickerPurpose, string> = {
  choose: 'Select or upload file',
  add: 'Add more files',
  replace: 'Replace',
}

const LABEL: Record<FilePickerPurpose, string> = {
  choose: 'File',
  add: 'Add a file',
  replace: 'Replace file',
}

/** Base UI also rewrites the query as the popup opens, closes or picks; only typing searches. */
const EDIT_REASONS = new Set(['input-change', 'input-clear', 'input-paste'])

interface FilePickerProps {
  picker: FilePickerState
  purpose: FilePickerPurpose
  disabled: boolean
  uploadBlocked: boolean
  onSelect: (fileId: string) => void
  onUpload: () => void
}

/**
 * The workspace file picker: server search a page at a time, unaccepted or unpublishable files
 * listed but unavailable, and an Upload action at the foot while uploads are allowed.
 */
export function FilePicker({
  picker,
  purpose,
  disabled,
  uploadBlocked,
  onSelect,
  onUpload,
}: FilePickerProps) {
  const replacing = purpose === 'replace'
  return (
    <SearchableSelect
      label={LABEL[purpose]}
      labelHidden
      variant={replacing ? 'text' : 'field'}
      options={picker.options}
      value={replacing ? picker.selectedFileId : null}
      selectedLabel={replacing ? PLACEHOLDER.replace : undefined}
      onValueChange={(next) => {
        if (next) onSelect(next)
      }}
      placeholder={PLACEHOLDER[purpose]}
      searchLabel='Search files'
      search={{
        query: picker.query,
        onQueryChange: (query, { reason }) => {
          if (EDIT_REASONS.has(reason)) picker.onQueryChange(query)
        },
        hasMore: picker.hasMore,
        loading: picker.loading,
        error: picker.error,
        onLoadMore: picker.loadMore,
        onRetry: picker.retry,
        emptyMessage: picker.query.trim() ? 'No matching files' : 'No files yet',
      }}
      onOpenChange={picker.onOpenChange}
      disabled={disabled}
      createLabel={uploadBlocked ? undefined : 'Upload new file'}
      onCreate={onUpload}
    />
  )
}
