'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { useCsvTruncationImport } from '@/components/file-viewer/csv-import'
import { DataTable } from '@/components/file-viewer/data-table'
import { PreviewError, resolvePreviewError } from '@/components/file-viewer/preview-shared'
import styles from '@/components/file-viewer/table-frame.module.css'
import { useHorizontalWheelScroll } from '@/components/file-viewer/use-horizontal-wheel-scroll'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useWorkspaceCsvPreview } from '@/hooks/queries/workspace-file-table'

interface CsvTablePreviewProps {
  file: WorkspaceFileRecord
  workspaceId: string
  /** A viewer who cannot create tables is not offered the import. */
  readOnly: boolean
}

/**
 * A CSV too large for the editor: the server streams its first rows, and when there are more a
 * notice offers to import the whole file as a table.
 */
export function CsvTablePreview({ file, workspaceId, readOnly }: CsvTablePreviewProps) {
  const scrollRef = useHorizontalWheelScroll()
  const version = Number(new Date(file.updatedAt)) || file.size
  const { data, error } = useWorkspaceCsvPreview(workspaceId, file.id, file.key, version)
  useCsvTruncationImport(workspaceId, file, data?.truncated ?? false, readOnly)
  const failure = resolvePreviewError((error as Error | null) ?? null, null)
  if (failure) return <PreviewError label='CSV' error={failure} />
  if (!data) return null
  if (data.headers.length === 0) return <EmptyState title='No data to display' />
  return (
    <div ref={scrollRef} className={styles.frame}>
      <DataTable headers={data.headers} rows={data.rows} />
    </div>
  )
}
