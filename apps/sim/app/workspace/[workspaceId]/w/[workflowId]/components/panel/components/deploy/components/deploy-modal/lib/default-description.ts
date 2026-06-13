/** Placeholder descriptions auto-assigned to new workflows; treated as "no description". */
const DEFAULT_WORKFLOW_DESCRIPTIONS = [
  'new workflow',
  'your first workflow - start building here!',
] as const

/**
 * Returns true when a workflow description is empty or a known auto-generated
 * placeholder (including the workflow name used as a fallback). Shared by every
 * deployment tab so the "is this a real description?" rule has one definition.
 */
export function isDefaultDescription(
  description: string | null | undefined,
  workflowName: string
): boolean {
  if (!description) return true
  const normalized = description.toLowerCase().trim()
  return (
    normalized === '' ||
    normalized === workflowName.toLowerCase().trim() ||
    (DEFAULT_WORKFLOW_DESCRIPTIONS as readonly string[]).includes(normalized)
  )
}
