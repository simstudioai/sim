import { iterateDocumentFileReferences } from '@/lib/uploads/documents/references'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

interface CopiedFileReferenceMaps {
  sourceOwner: EditableFileOwner
  destinationOwner: EditableFileOwner
  fileIds: ReadonlyMap<string, string>
  fileKeys: ReadonlyMap<string, string>
}

interface SourceReplacement {
  start: number
  end: number
  value: string
}

const FILE_REFERENCE_RE =
  /(^|[\s("'<>`])((?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\/\/|sim:file\/|\/(?:api\/(?:files\/(?:view|serve)\/|projects\/)|workspace\/|projects\/))[^\s)"'<>`]+)/g

function absoluteReferenceEnd(content: string, start: number): number {
  let parentheses = 0
  let end = start
  for (; end < content.length; end++) {
    const character = content[end]
    if (/[\s"'<>`]/.test(character)) break
    if (character === '(') parentheses++
    if (character === ')') {
      if (parentheses === 0) break
      parentheses--
    }
  }
  return end
}

function decodedIdentity(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value)
    return /^[A-Za-z0-9_-]+$/.test(decoded) ? decoded : undefined
  } catch {
    return undefined
  }
}

function destinationBytes(owner: EditableFileOwner, fileId: string): string {
  return owner.entityType === 'project'
    ? `/api/projects/${encodeURIComponent(owner.entityId)}/files/${encodeURIComponent(fileId)}/content`
    : `/api/files/view/${encodeURIComponent(fileId)}`
}

function destinationPage(owner: EditableFileOwner, fileId: string): string {
  const namespace = owner.entityType === 'project' ? 'projects' : 'workspace'
  return `/${namespace}/${encodeURIComponent(owner.entityId)}/files/${encodeURIComponent(fileId)}`
}

function matchesOwner(owner: EditableFileOwner, entityType: string, entityId: string): boolean {
  return owner.entityType === entityType && owner.entityId === decodedIdentity(entityId)
}

function rewriteFileReference(reference: string, maps: CopiedFileReferenceMaps): string | null {
  const hashIndex = reference.indexOf('#')
  const fragment = hashIndex < 0 ? '' : reference.slice(hashIndex)
  const withoutFragment = hashIndex < 0 ? reference : reference.slice(0, hashIndex)
  const queryIndex = withoutFragment.indexOf('?')
  const pathname = queryIndex < 0 ? withoutFragment : withoutFragment.slice(0, queryIndex)
  const query = queryIndex < 0 ? null : new URLSearchParams(withoutFragment.slice(queryIndex + 1))
  const mappedId = (spelledId: string) => {
    const fileId = decodedIdentity(spelledId)
    return fileId === undefined ? undefined : maps.fileIds.get(fileId)
  }

  const simLink = /^sim:file\/([^/]+)$/.exec(pathname)
  if (simLink) {
    const fileId = mappedId(simLink[1])
    if (!fileId) return null
    if (query === null) return `sim:file/${encodeURIComponent(fileId)}${fragment}`
    const entries = [...query]
    const entry = entries[0]
    if (
      entries.length !== 1 ||
      !entry ||
      entry[0] !== maps.sourceOwner.entityType ||
      entry[1] !== maps.sourceOwner.entityId
    ) {
      return null
    }
    return `sim:file/${encodeURIComponent(fileId)}?${maps.destinationOwner.entityType}=${encodeURIComponent(maps.destinationOwner.entityId)}${fragment}`
  }

  const serve = /^\/api\/files\/serve\/(?:s3\/|blob\/|gcs\/)?(.+)$/.exec(pathname)
  if (serve) {
    if (query !== null) {
      const entries = [...query]
      const entry = entries[0]
      if (
        entries.length !== 1 ||
        !entry ||
        entry[0] !== 'context' ||
        entry[1] !== maps.sourceOwner.entityType
      ) {
        return null
      }
    }
    let key: string
    try {
      key = decodeURIComponent(serve[1])
    } catch {
      return null
    }
    if (!key.startsWith(`${maps.sourceOwner.entityType}/${maps.sourceOwner.entityId}/`)) return null
    const fileId = maps.fileKeys.get(key)
    return fileId ? destinationBytes(maps.destinationOwner, fileId) + fragment : null
  }

  if (query !== null) return null
  const view = /^\/api\/files\/view\/([^/]+)$/.exec(pathname)
  if (view) {
    const fileId = mappedId(view[1])
    return fileId ? destinationBytes(maps.destinationOwner, fileId) + fragment : null
  }
  const page = /^\/(workspace|projects)\/([^/]+)\/files\/([^/]+)$/.exec(pathname)
  if (page) {
    const entityType = page[1] === 'projects' ? 'project' : 'workspace'
    if (!matchesOwner(maps.sourceOwner, entityType, page[2])) return null
    const fileId = mappedId(page[3])
    return fileId ? destinationPage(maps.destinationOwner, fileId) + fragment : null
  }
  const projectContent = /^\/api\/projects\/([^/]+)\/files\/([^/]+)\/content$/.exec(pathname)
  if (projectContent) {
    if (!matchesOwner(maps.sourceOwner, 'project', projectContent[1])) return null
    const fileId = mappedId(projectContent[2])
    return fileId ? destinationBytes(maps.destinationOwner, fileId) + fragment : null
  }
  return null
}

/** Repoints only the canonical selected identities; it neither discovers nor copies dependencies. */
export function rewriteCopiedFileReferences(
  content: string,
  maps: CopiedFileReferenceMaps
): string {
  if (!content || (maps.fileIds.size === 0 && maps.fileKeys.size === 0)) return content
  const replacements: SourceReplacement[] = []
  let protectedEnd = 0
  for (const match of content.matchAll(FILE_REFERENCE_RE)) {
    const reference = match[2]
    const start = match.index + match[1].length
    if (start < protectedEnd) continue
    if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\/\/)/.test(reference)) {
      protectedEnd = absoluteReferenceEnd(content, start)
      continue
    }
    const value = rewriteFileReference(reference, maps)
    if (value === null) continue
    replacements.push({ start, end: start + reference.length, value })
  }
  for (const { fileId, start, end } of iterateDocumentFileReferences(content)) {
    const value = maps.fileIds.get(fileId)
    if (value !== undefined) replacements.push({ start, end, value })
  }
  replacements.sort((left, right) => left.start - right.start)
  const chunks: string[] = []
  let offset = 0
  for (const { start, end, value } of replacements) {
    chunks.push(content.slice(offset, start), value)
    offset = end
  }
  chunks.push(content.slice(offset))
  return chunks.join('')
}
