/**
 * The source directory `workflows source get --out` writes and `workflows source apply --from`
 * reads back. One definition, so the two commands cannot drift apart.
 */

/** The entry file every source directory holds; function code sits beside it under `functions/`. */
export const SOURCE_ENTRY_FILE = 'workflow.ts'
/** The identity lock (`WorkflowLockV1`). */
export const SOURCE_LOCK_FILE = '.sim/lock.json'
/** The freshness facts for the lock in this environment (`LockBase`). */
export const SOURCE_BASE_FILE = '.sim/base.json'
/** Generated SDK declarations for the block types the workflow uses. */
export const SOURCE_SDK_DIR = '.sim/sdk'
