/** The scope a run's own output files are written under. */
export interface RunFileScope {
  workspaceId: string | null
  workflowId: string | null
  executionId: string
}

/**
 * Whether a storage key names a file this specific run produced.
 *
 * A run's recorded output is not a trustworthy source of storage keys. The start
 * block copies every caller-supplied input field verbatim into its output
 * (`buildUnifiedStartOutput`), and `collectUserFilesById` accepts any object
 * carrying the `UserFile` shape — so a caller can put `{id, name, url, size,
 * type, key}` under any input field and have it recorded as though the run had
 * emitted it. Only the reserved `files` key passes through `normalizeStartFile`,
 * and that normalizer derives its key from a caller-supplied URL anyway.
 *
 * Serving bytes for such a record would be a cross-workspace read: nothing
 * downstream re-authorizes, because the run itself is legitimately the caller's.
 * So the id→key mapping is filtered to keys that are structurally this run's
 * own: the `execution/<workspaceId>/<workflowId>/<executionId>/…` layout the
 * executor writes output under. A caller cannot forge one without already
 * knowing all three canonical ids, and even then it names only its own run.
 *
 * Input files a caller attached are deliberately out of scope — they live under
 * the workspace prefix, they are not this run's output, and they are already
 * addressable through the files API under that resource's own authorization.
 */
export function isRunOutputFileKey(key: string, scope: RunFileScope): boolean {
  const parts = key.split('/')
  if (parts[0] !== 'execution' || parts.length < 5) {
    return false
  }

  const [, workspaceId, workflowId, executionId] = parts
  if (scope.workspaceId && workspaceId !== scope.workspaceId) {
    return false
  }

  if (scope.workflowId && workflowId !== scope.workflowId) {
    return false
  }

  return executionId === scope.executionId
}
