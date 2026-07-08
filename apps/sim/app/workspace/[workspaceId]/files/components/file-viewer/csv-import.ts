'use client'

import { useCallback, useEffect, useRef } from 'react'
import { toast } from '@sim/emcn'
import { generateId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { CSV_PREVIEW_MAX_ROWS } from '@/lib/api/contracts/workspace-file-table'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useImportFileAsTable } from '@/hooks/queries/tables'
import { useImportTrayStore } from '@/stores/table/import-tray/store'

export type CsvImportFileDescriptor = Pick<WorkspaceFileRecord, 'key' | 'name'>

/**
 * Wires the "Import as a table" affordance for a capped CSV preview. When the preview is
 * `truncated`, raises a one-time warning toast whose action kicks off a background import of the
 * existing workspace file — no re-upload, source preserved — and navigates to the new table.
 */
export function useCsvTruncationImport(
  workspaceId: string,
  file: CsvImportFileDescriptor,
  truncated: boolean,
  readOnly = false
) {
  const router = useRouter()
  const importFile = useImportFileAsTable()

  // Guards against a double-tap on the toast action kicking off two parallel imports of the same
  // file. Reset once the kickoff settles so a failed import can be retried.
  const importingRef = useRef(false)

  const importAsTable = useCallback(() => {
    if (importingRef.current) return
    importingRef.current = true
    const pendingId = `pending_${generateId()}`
    useImportTrayStore
      .getState()
      .startUpload({ uploadId: pendingId, workspaceId, title: file.name })
    toast.success(`Importing "${file.name}" as a table`, {
      description: 'This runs in the background.',
      action: {
        label: 'View tables',
        onClick: () => router.push(`/workspace/${workspaceId}/tables`),
      },
    })
    importFile.mutate(
      { workspaceId, fileKey: file.key, fileName: file.name },
      {
        onSettled: () => {
          importingRef.current = false
          useImportTrayStore.getState().endUpload(pendingId)
        },
      }
    )
    // importFile.mutate and router are stable references
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, file.key, file.name])

  // Surface the cap as a warning toast with an import action, once per file.
  const notifiedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (readOnly || !truncated || notifiedKeyRef.current === file.key) return
    notifiedKeyRef.current = file.key
    toast.warning(`Showing the first ${CSV_PREVIEW_MAX_ROWS.toLocaleString()} rows`, {
      description: 'Import this file as a table to view all of its rows.',
      action: { label: 'Import as a table', onClick: importAsTable },
    })
  }, [readOnly, truncated, file.key, importAsTable])
}
