import type { ImportRow } from './use-workspace-imports'

type ProgressStatus = 'pending' | 'success' | 'error'

/** Uniform view model for a tray entry — every stage fills the same slots. */
export interface ImportStageView {
  status: ProgressStatus
  /** Primary line: `{status} {name}`, e.g. `Processing data.csv`. */
  title: string
  /** Right-aligned on the title row: the percent (when known). */
  meta?: string
  /** Secondary line: the row count, or the error message on failure. */
  detail?: string
  dismissible: boolean
}

/**
 * Maps a tray entry to the stage shown in the import dropdown. The single place the import
 * stages (Uploading → Processing → Imported / Failed) are defined; the row component just
 * renders the returned slots, so every stage looks consistent: `{status} {name}`. While
 * uploading, the right slot shows the byte-based upload percent (from the client XHR). Once the
 * server is processing we only know the committed row count (polled from the table row), so the
 * detail line reads `{rows} rows` with no percent.
 */
export function getImportStage(entry: ImportRow): ImportStageView {
  const rows = entry.rowsProcessed.toLocaleString()
  const name = entry.title
  const meta = typeof entry.percent === 'number' ? `${entry.percent}%` : undefined

  if (entry.phase === 'failed') {
    return {
      status: 'error',
      title: `Failed ${name}`,
      detail: entry.error ?? 'Something went wrong',
      dismissible: true,
    }
  }

  if (entry.phase === 'ready') {
    return {
      status: 'success',
      title: `Imported ${name}`,
      detail: `${rows} rows`,
      dismissible: true,
    }
  }

  // importing: rows only start arriving once the worker is processing; before that it's the upload.
  if (entry.rowsProcessed > 0) {
    return {
      status: 'pending',
      title: `Processing ${name}`,
      detail: `${rows} rows`,
      dismissible: false,
    }
  }
  return { status: 'pending', title: `Uploading ${name}`, meta, dismissible: false }
}
