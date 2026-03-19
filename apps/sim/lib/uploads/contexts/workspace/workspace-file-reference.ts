/**
 * Normalize a workspace file reference to its display name.
 * Supports raw names and VFS-style paths like `files/name`, `files/name/content`,
 * and `files/name/meta.json`.
 *
 * Used by storage resolution (`findWorkspaceFileRecord`), not by `open_resource`, which
 * requires the canonical database UUID only.
 */
export function normalizeWorkspaceFileReference(fileReference: string): string {
  const trimmed = fileReference.trim().replace(/^\/+/, '')

  if (trimmed.startsWith('files/')) {
    const withoutPrefix = trimmed.slice('files/'.length)
    if (withoutPrefix.endsWith('/meta.json')) {
      return withoutPrefix.slice(0, -'/meta.json'.length)
    }
    if (withoutPrefix.endsWith('/content')) {
      return withoutPrefix.slice(0, -'/content'.length)
    }
    return withoutPrefix
  }

  return trimmed
}
