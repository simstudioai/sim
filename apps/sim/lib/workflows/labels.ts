/**
 * Display labels for workflow references that no longer resolve.
 *
 * Lives in `lib/` rather than beside the logs table that first needed it because
 * `lib/workflows/subblocks/display.ts` reads it too, and importing it from
 * `app/workspace/[workspaceId]/logs/utils` inverted the app/lib layering while
 * pulling React, `@sim/emcn`, and the block registry into every consumer of that
 * module for the sake of one string.
 */
export const DELETED_WORKFLOW_LABEL = 'Deleted Workflow'
