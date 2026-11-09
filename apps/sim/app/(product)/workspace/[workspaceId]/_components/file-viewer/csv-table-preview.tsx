'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { DataTable } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/data-table'
import {
  PreviewError,
  resolvePreviewError,
} from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/preview-shared'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/table-frame.module.css'
import { useHorizontalWheelScroll } from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/use-horizontal-wheel-scroll'
import type { WorkspaceFileRecord } from '@/platform/lib/data/files'
import { useCsvTruncationImport, useWorkspaceCsvPreview } from '@/platform/lib/data/files/preview'

interface CsvTablePreviewProps {
  file: WorkspaceFileRecord
  workspaceId: string
}

/**
 * A CSV too large for the editor: the server streams its first rows, and when there are more a
 * notice offers to import the whole file as a table.
 */
export function CsvTablePreview({ file, workspaceId }: CsvTablePreviewProps) {
  const scrollRef = useHorizontalWheelScroll()
  const version = Number(new Date(file.updatedAt)) || file.size
  const { data, error } = useWorkspaceCsvPreview(workspaceId, file.id, file.key, version)
  useCsvTruncationImport(workspaceId, file, data?.truncated ?? false)
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
