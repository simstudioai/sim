import type { ResourceSource } from '@/resources/source'

/**
 * Address helpers for the log resource — the log half of what `file-source.ts`
 * does for files.
 *
 * Pure TypeScript, no React: nothing here may reach for a hook or the DOM.
 */

/** Path to a workflow in the editor. */
export function workflowEditorPath(workspaceId: string, workflowId: string): string {
  return `/workspace/${workspaceId}/w/${workflowId}`
}

/**
 * Resolves the workflow a log row points at, or null when there is nowhere to
 * navigate. Sim agent jobs have no workflow of their own, and a deleted
 * workflow leaves both id fields empty.
 *
 * Single source of truth for "is this log's workflow reachable" — the list row,
 * its context menu, and the details panel must agree, or a row can render as
 * "Deleted Workflow" while still linking somewhere.
 */
export function resolveLogWorkflowId(log: {
  trigger?: string | null
  workflowId?: string | null
  workflow?: { id?: string } | null
}): string | null {
  if (log.trigger === 'mothership') return null
  return log.workflow?.id || log.workflowId || null
}

/**
 * The in-app editor link for a log's workflow, or `null` when there is none to
 * link to. Always `null` in share scope — an anonymous visitor has no workspace
 * route to be sent to, so the view renders static text instead of a link
 * without needing to know which host it is mounted on.
 */
export function logWorkflowHref(
  source: ResourceSource<'log'>,
  log: { trigger?: string | null; workflowId?: string | null; workflow?: { id?: string } | null }
): string | null {
  if (source.via !== 'workspace') return null
  const workflowId = resolveLogWorkflowId(log)
  return workflowId ? workflowEditorPath(source.workspaceId, workflowId) : null
}
