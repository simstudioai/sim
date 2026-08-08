'use client'

import { memo } from 'react'
import { DataTable } from '@/components/resources/file-view/components/data-table/data-table'
import {
  PreviewError,
  PreviewLoadingFrame,
  resolvePreviewError,
} from '@/components/resources/file-view/components/preview-shared/preview-shared'
import { useCsvTruncationImport } from '@/components/resources/file-view/hooks/csv-import'
import { useResourceOfKind } from '@/components/resources/resource-provider'
import { useWorkspaceCsvPreview } from '@/hooks/queries/workspace-file-table'
import { type FileViewRecord, fileWorkspaceId } from '@/resources/file-source'

/**
 * Read-only preview for a CSV that is too large to load fully into the editor. Streams only the
 * first {@link CSV_PREVIEW_MAX_ROWS} rows from storage; when there are more, a warning toast offers
 * "Import as a table", which builds a full Table from the file (memory-safe streaming import).
 */
export const CsvTablePreview = memo(function CsvTablePreview({ file }: { file: FileViewRecord }) {
  const { source } = useResourceOfKind('file')
  const workspaceId = fileWorkspaceId(source) ?? ''
  const version = Number(new Date(file.updatedAt)) || file.size
  const {
    data,
    isLoading,
    error: fetchError,
  } = useWorkspaceCsvPreview(workspaceId, file.id, file.key, version)
  useCsvTruncationImport(workspaceId, file, data?.truncated ?? false)

  const error = resolvePreviewError((fetchError as Error | null) ?? null, null)
  if (error) return <PreviewError label='CSV' error={error} />
  if (isLoading || !data) {
    return <PreviewLoadingFrame className='flex flex-1 flex-col overflow-hidden' />
  }

  if (data.headers.length === 0) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <p className='text-[13px] text-[var(--text-muted)]'>No data to display</p>
      </div>
    )
  }

  return (
    <div className='flex flex-1 flex-col overflow-auto p-6'>
      <DataTable headers={data.headers} rows={data.rows} />
    </div>
  )
})
