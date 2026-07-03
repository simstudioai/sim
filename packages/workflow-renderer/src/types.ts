/**
 * Shared rendering types for the pure workflow renderer.
 *
 * These describe the visual state a View component needs, resolved by the
 * editor (or docs) container and passed in as props. They deliberately carry no
 * store, socket, or query coupling.
 */

/** Diff state of an edge when comparing two workflow versions. */
export type EdgeDiffStatus = 'new' | 'deleted' | 'unchanged' | null

/** Execution outcome of an edge for run-path visualization. */
export type EdgeRunStatus = 'success' | 'error' | 'not-executed' | undefined

/** Diff state of a block when comparing two workflow versions. */
export type DiffStatus = 'new' | 'edited' | undefined

/** Execution outcome of a block on its run path. */
export type BlockRunStatus = 'success' | 'error' | undefined
