import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

/** Parses the ID, optional single owner, and fragment of a sim:file resource reference. */
export function parseSimFileReference(reference: string, defaultOwner?: EditableFileOwner) {
  const match = /^([^?#]+)(?:\?([^#]*))?(#.*)?$/.exec(reference)
  if (!match) return null
  let fileId: string
  try {
    fileId = decodeURIComponent(match[1])
  } catch {
    return null
  }
  if (!/^[A-Za-z0-9_-]+$/.test(fileId)) return null
  let owner = defaultOwner
  if (match[2] !== undefined) {
    const entries = [...new URLSearchParams(match[2])]
    const entry = entries[0]
    if (entries.length !== 1 || !entry) return null
    const [entityType, entityId] = entry
    if (
      (entityType !== 'workspace' && entityType !== 'project') ||
      !/^[A-Za-z0-9_-]+$/.test(entityId)
    ) {
      return null
    }
    owner = { entityType, entityId }
  }
  return { fileId, owner, fragment: match[3] ?? '' }
}
