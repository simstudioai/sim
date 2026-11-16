/**
 * The source directory `workflows source get --dir` writes and `workflows source apply --dir`
 * (or `create --dir`) reads back. One definition, so the two commands cannot drift apart.
 */

/** The entry file every source directory holds; function code sits beside it under `functions/`. */
export const SOURCE_ENTRY_FILE = 'workflow.ts'
/** The identity lock (`WorkflowLockV1`). */
export const SOURCE_LOCK_FILE = '.sim/lock.json'
/** The freshness facts for the lock in this environment (`SourceBase`). */
export const SOURCE_BASE_FILE = '.sim/base.json'
/** Generated SDK declarations: every block in the workspace catalog, plus `workspace.d.ts`. */
export const SOURCE_SDK_DIR = '.sim/sdk'
/** A short guide for an agent working in the directory. */
export const SOURCE_AGENTS_FILE = 'AGENTS.md'
