/**
 * The single-letter avatar initial for a workspace, ignoring the word
 * "workspace" in its name (e.g. "Acme Workspace" → "A").
 */
export function getWorkspaceInitial(name: string | undefined): string {
  const stripped = (name ?? '').replace(/workspace/gi, '').trim()
  return (stripped[0] || name?.[0] || 'W').toUpperCase()
}
