import { decodeVfsPathSegments } from '@/lib/vfs/path'

/** A workflow's two build-notes files live flat in this namespace, named by the workflow id. */
const BUILD_NOTES_PREFIX = 'build-notes/'
const NOTES_SUFFIX = '.md'
const BASELINE_SUFFIX = '.baseline.json'
const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

export type BuildNotesFile = 'notes' | 'baseline'

export function buildNotesFileName(workflowId: string, file: BuildNotesFile): string {
  return `${workflowId}${file === 'notes' ? NOTES_SUFFIX : BASELINE_SUFFIX}`
}

export function buildNotesPath(workflowId: string, file: BuildNotesFile): string {
  return `${BUILD_NOTES_PREFIX}${buildNotesFileName(workflowId, file)}`
}

/**
 * The owner key in a `build-notes/<workflowId>.md` or `.baseline.json` reference, as
 * `<workflowId>:notes` or `<workflowId>:baseline`; null for any other reference.
 */
export function parseBuildNotesReference(reference: string): string | null {
  const trimmed = reference.trim().replace(/^\/+/, '')
  if (!trimmed.startsWith(BUILD_NOTES_PREFIX)) return null
  const segments = decodeVfsPathSegments(trimmed)
  if (segments.length !== 2) return null
  const name = segments[1]
  for (const [file, suffix] of [
    ['baseline', BASELINE_SUFFIX],
    ['notes', NOTES_SUFFIX],
  ] as const) {
    if (!name.endsWith(suffix)) continue
    const workflowId = name.slice(0, -suffix.length)
    return WORKFLOW_ID_PATTERN.test(workflowId) ? `${workflowId}:${file}` : null
  }
  return null
}

export function parseBuildNotesKey(key: string): { workflowId: string; file: BuildNotesFile } {
  const separator = key.lastIndexOf(':')
  return {
    workflowId: key.slice(0, separator),
    file: key.slice(separator + 1) === 'baseline' ? 'baseline' : 'notes',
  }
}
