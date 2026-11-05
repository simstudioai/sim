/**
 * The block a copilot `read` path names, without resolving it: a component schema or an organization
 * custom block by exact type, an integration by its family. Null for every other path.
 */
export function parseReadTarget(
  path: string | undefined
): { kind: 'block' | 'integration'; type: string } | null {
  if (!path) return null
  const segments = path.trim().split('/').filter(Boolean)

  if (segments[0] === 'organization' && segments[1] === 'custom-blocks' && segments.length === 3) {
    return { kind: 'block', type: segments[2].replace(/\.json$/, '') }
  }

  if (segments[0] !== 'components' || segments.length < 3) return null
  if (segments[1] === 'blocks' && segments.length === 3) {
    return { kind: 'block', type: segments[2].replace(/\.json$/, '') }
  }
  if (segments[1] === 'integrations') {
    return { kind: 'integration', type: segments[2] }
  }
  return null
}
