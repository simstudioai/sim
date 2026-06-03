import type { ImportTrayEntry } from '@/stores/table/import-tray/store'

type ProgressStatus = 'pending' | 'success' | 'error'

/** Uniform view model for a tray entry — every stage fills the same slots. */
export interface ImportStageView {
  status: ProgressStatus
  /** Primary line: `{status} {name}`, e.g. `Processing data.csv`. */
  title: string
  /** Right-aligned on the title row: the percent (when known). */
  meta?: string
  /** Secondary line: the row progress, or the error message on failure. */
  detail?: string
  dismissible: boolean
}

/**
 * Maps a tray entry to the stage shown in the import dropdown. The single place the import
 * stages (Uploading → Processing → Imported / Failed) are defined; the row component just
 * renders the returned slots, so every stage looks consistent: `{status} {name}` with the
 * percent on the right and the row count underneath.
 */
export function getImportStage(entry: ImportTrayEntry): ImportStageView {
  const rows = entry.rowsProcessed.toLocaleString()
  const name = entry.title

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

  // importing: processing once the worker reports rows/total, otherwise still uploading.
  if (entry.total && entry.total > 0) {
    const percent = Math.min(99, Math.round((entry.rowsProcessed / entry.total) * 100))
    return {
      status: 'pending',
      title: `Processing ${name}`,
      meta: `${percent}%`,
      detail: `${rows} / ${entry.total.toLocaleString()} rows`,
      dismissible: false,
    }
  }

  return {
    status: 'pending',
    title: `Uploading ${name}`,
    meta: typeof entry.uploadPercent === 'number' ? `${entry.uploadPercent}%` : undefined,
    dismissible: false,
  }
}
