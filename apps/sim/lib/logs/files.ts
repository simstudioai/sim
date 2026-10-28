import { workflowRunFileDownloadPath } from '@/lib/workflows/executor/execution-run-files'
import { isRunOutputFileKey } from '@/lib/workflows/executor/run-file-scope'

/**
 * One file a log row publishes: the run resource's descriptor without the bytes.
 *
 * The storage `key` and the recorded `url` are deliberately absent. The key is
 * the addressing secret the download path exists to avoid handing out — the run
 * contract states the rule — and the recorded `url` points at
 * `/api/files/serve/…`, which authenticates by session or internal token and
 * refuses an API key outright, so publishing it offered a v2 caller a link it
 * could never follow.
 */
export interface PublicLogFile {
  id: string
  name: string
  size: number
  type: string
  downloadPath: string
}

/** The scope columns a log row carries, plus its recorded `files` blob. */
export interface RecordedLogFileRow {
  workspaceId: string | null
  workflowId: string | null
  executionId: string
  files: unknown
}

interface RecordedFile {
  id: string
  name: string
  size: number
  type: string
  key: string
}

/**
 * Whether one recorded entry carries every field the published descriptor needs.
 *
 * An entry that does not is dropped rather than back-filled: the executor writes
 * the full `UserFile` shape for every file a run produces, so a partial entry
 * came from somewhere else, and inventing a size or a MIME type for it would
 * publish a fact the recording does not contain. This runs on a response that is
 * `.parse`d on the way out, so a value that cannot satisfy the schema has to be
 * removed here rather than reaching it.
 */
function isRecordedFile(value: unknown): value is RecordedFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Record<string, unknown>
  return (
    typeof file.id === 'string' &&
    file.id.length > 0 &&
    typeof file.name === 'string' &&
    typeof file.key === 'string' &&
    typeof file.type === 'string' &&
    typeof file.size === 'number' &&
    Number.isFinite(file.size) &&
    file.size >= 0
  )
}

/**
 * Projects a log row's recorded `files` blob onto the files the run itself
 * produced.
 *
 * `workflow_execution_logs.files` is a recording, not a manifest. It is
 * extracted from trace spans, final output, AND the workflow input, and the
 * start block copies every caller-supplied input field verbatim into its output
 * — so the blob carries input attachments a caller sent and can carry a
 * `UserFile` naming any storage key at all. Publishing it as stored leaked the
 * key and offered a URL the v2 surface cannot serve.
 *
 * Every entry is therefore filtered through `isRunOutputFileKey`, which admits
 * only keys under this run's own `execution/<workspaceId>/<workflowId>/
 * <executionId>/…` prefix, and re-addressed through the run resource's download
 * path. A run whose workflow row is gone has no such path to offer, so its files
 * are dropped rather than pointed at a route that cannot resolve them.
 *
 * `null` in, `null` out — a run that recorded nothing is different from one
 * whose recorded entries were all out of scope, which yields `[]`.
 */
export function projectLogFiles(row: RecordedLogFileRow): PublicLogFile[] | null {
  if (row.files == null) return null
  if (!Array.isArray(row.files) || row.workflowId === null) return []

  const scope = {
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    executionId: row.executionId,
  }
  const files: PublicLogFile[] = []
  for (const entry of row.files) {
    if (!isRecordedFile(entry) || !isRunOutputFileKey(entry.key, scope)) continue
    files.push({
      id: entry.id,
      name: entry.name,
      size: Math.trunc(entry.size),
      type: entry.type,
      downloadPath: workflowRunFileDownloadPath(row.workflowId, row.executionId, entry.id),
    })
  }
  return files
}
