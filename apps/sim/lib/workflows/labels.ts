/**
 * Display labels for workflow references and blocks, shared by the surfaces
 * that name them in prose.
 *
 * Lives in `lib/` rather than beside the logs table that first needed it because
 * `lib/workflows/subblocks/display.ts` reads it too, and importing it from
 * `app/workspace/[workspaceId]/logs/utils` inverted the app/lib layering while
 * pulling React, `@sim/emcn`, and the block registry into every consumer of that
 * module for the sake of one string.
 */
export const DELETED_WORKFLOW_LABEL = 'Deleted Workflow'

/**
 * A block named in prose: `"Name"`, or `"id"` when it has no name. With
 * `withId`, a named block also carries its id (`"Name" (id)`) for a reader whose
 * next call addresses the block by id.
 */
export function quotedBlockLabel(
  id: string,
  name: string | null | undefined,
  options: { withId?: boolean } = {}
): string {
  if (!name) return `"${id}"`
  return options.withId ? `"${name}" (${id})` : `"${name}"`
}
