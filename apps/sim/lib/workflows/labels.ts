/**
 * Display labels for workflow references that no longer resolve.
 *
 * Deliberately a dependency-free leaf. The label is read by the workflow editor's
 * collapsed subblock rows, the workflow selector, the preview editor, the logs
 * table, and the log view — a constant that broad has to live somewhere none of
 * them owns, or the surfaces start importing each other's component barrels to
 * reach it.
 */

/** Shown in place of a workflow name when the referenced workflow is gone. */
export const DELETED_WORKFLOW_LABEL = 'Deleted Workflow'
