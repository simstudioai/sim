/**
 * Pure rewriter for the in-content references embedded in copied free-text (skill bodies,
 * markdown file blobs) at fork/sync time. It rewrites the two reference shapes a copy must
 * keep pointing at the right workspace:
 *
 * - `sim:<kind>/<id>` deep links (the `@`-mention / chip scheme) - the id is remapped through
 *   the matching fork id map by kind (file, folder, table, knowledge, workflow, skill).
 * - Embedded file/image URLs - `/api/files/serve/<key>` (workspace storage key), `/api/files/view/<id>`
 *   (workspace file id), and the in-app `/workspace/<id>/files/<id>` path - remapped through the file
 *   key / file id / workspace id maps.
 *
 * A reference whose target has no mapping is LEFT UNCHANGED (a graceful broken link), never deleted,
 * so a copied document is never silently corrupted. Pure and isomorphic (no DOM/Node/DB).
 */

/** Per-kind source->target id maps a content copy threads in (any subset may be supplied). */
export interface ForkContentRefMaps {
  /** Workspace id rewrite for the in-app `/workspace/<id>/files/...` path. */
  workspaceId?: { from: string; to: string }
  /** source workspace-file storage key -> child storage key (serve-url embeds). */
  fileKeys?: ReadonlyMap<string, string>
  /** source workspace-file id -> child id (view-url + in-app-path embeds). */
  fileIds?: ReadonlyMap<string, string>
  /** source workflow id -> child id (`sim:workflow/<id>`). */
  workflows?: ReadonlyMap<string, string>
  /** source knowledge-base id -> child id (`sim:knowledge/<id>`). */
  knowledgeBases?: ReadonlyMap<string, string>
  /** source table id -> child id (`sim:table/<id>`). */
  tables?: ReadonlyMap<string, string>
  /** source skill id -> child id (`sim:skill/<id>`). */
  skills?: ReadonlyMap<string, string>
  /** source folder id -> child id (`sim:folder/<id>`). */
  folders?: ReadonlyMap<string, string>
}

/** `sim:<kind>/<id>` token; the id charset matches generateId/generateShortId so it stops at delimiters. */
const SIM_LINK_RE = /sim:([a-z_]+)\/([A-Za-z0-9_-]+)/g
/** `/api/files/serve/[s3/|blob/]<key>` (key may be raw or percent-encoded, ends at a delimiter). */
const SERVE_URL_RE = /\/api\/files\/serve\/(s3\/|blob\/)?([^\s)"'<>?]+)/g
/** `/api/files/view/<workspaceFileId>`. */
const VIEW_URL_RE = /\/api\/files\/view\/([A-Za-z0-9_-]+)/g
/** In-app `/workspace/<workspaceId>/files/<workspaceFileId>` embed path. */
const INAPP_FILE_RE = /\/workspace\/([A-Za-z0-9-]+)\/files\/([A-Za-z0-9_-]+)/g

export function rewriteForkContentRefs(content: string, maps: ForkContentRefMaps): string {
  if (!content) return content

  const idMapForSimKind: Record<string, ReadonlyMap<string, string> | undefined> = {
    file: maps.fileIds,
    folder: maps.folders,
    table: maps.tables,
    knowledge: maps.knowledgeBases,
    workflow: maps.workflows,
    skill: maps.skills,
  }

  let result = content.replace(SIM_LINK_RE, (full, kind: string, id: string) => {
    const target = idMapForSimKind[kind]?.get(id)
    return target ? `sim:${kind}/${target}` : full
  })

  result = result.replace(SERVE_URL_RE, (full, prefix: string | undefined, encodedKey: string) => {
    if (!maps.fileKeys) return full
    let key: string
    try {
      key = decodeURIComponent(encodedKey)
    } catch {
      return full
    }
    const target = maps.fileKeys.get(key)
    return target ? `/api/files/serve/${prefix ?? ''}${encodeURIComponent(target)}` : full
  })

  result = result.replace(VIEW_URL_RE, (full, id: string) => {
    const target = maps.fileIds?.get(id)
    return target ? `/api/files/view/${target}` : full
  })

  // Both-or-nothing: rewrite only when the workspace id is the mapped source AND the file id
  // resolves, so we never emit a child-workspace path with an unmapped (guaranteed-404) id -
  // matching the serve/view branches and rewriteForkResourceUrls. A foreign workspace id or an
  // unmapped file id leaves the original path untouched (graceful).
  result = result.replace(INAPP_FILE_RE, (full, wsId: string, fileId: string) => {
    if (maps.workspaceId?.from !== wsId) return full
    const mappedFile = maps.fileIds?.get(fileId)
    return mappedFile ? `/workspace/${maps.workspaceId.to}/files/${mappedFile}` : full
  })

  return result
}

/**
 * In-app `/workspace/<wsId>/(w|tables|knowledge|files)/<resourceId>` deep link - the form a TABLE
 * CELL renders as a resource chip (`resolveSimResourceKind`), but ONLY when `wsId` matches the
 * current workspace. The id charset stops at delimiters.
 */
const RESOURCE_URL_RE =
  /\/workspace\/([A-Za-z0-9-]+)\/(w|tables|knowledge|files)\/([A-Za-z0-9_-]+)/g

/**
 * Rewrite the in-workspace resource deep links a copied table cell renders as a resource chip, so
 * the chip keeps resolving after a cross-workspace copy (a cell chip renders only when the URL's
 * workspace id is the current workspace, so a stale source id silently degrades to a plain link).
 * Repoints both the workspace id and the resource id at the child copy, per section: `w` ->
 * workflows, `tables` -> tables, `knowledge` -> knowledge bases, `files` -> file ids.
 *
 * Both-or-nothing: a match is rewritten ONLY when its workspace id is the mapped source AND its
 * resource id is in that section's map - otherwise it is left UNCHANGED. Emitting a child-workspace
 * URL with an unmapped id would render a "Not found" chip (worse than the graceful plain link an
 * unchanged URL degrades to). Distinct from {@link rewriteForkContentRefs}: table cells do NOT
 * specially render the `sim:` / serve / view forms that skill + markdown bodies do.
 */
export function rewriteForkResourceUrls(content: string, maps: ForkContentRefMaps): string {
  if (!content || !maps.workspaceId) return content
  const { from, to } = maps.workspaceId
  const idMapForSection: Record<string, ReadonlyMap<string, string> | undefined> = {
    w: maps.workflows,
    tables: maps.tables,
    knowledge: maps.knowledgeBases,
    files: maps.fileIds,
  }
  return content.replace(RESOURCE_URL_RE, (full, wsId: string, section: string, id: string) => {
    if (wsId !== from) return full
    const mappedId = idMapForSection[section]?.get(id)
    return mappedId ? `/workspace/${to}/${section}/${mappedId}` : full
  })
}
