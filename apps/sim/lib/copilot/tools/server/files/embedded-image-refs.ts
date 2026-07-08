import { getFileMetadataById } from '@/lib/uploads/server/metadata'
import { extractEmbeddedFileRefs } from '@/lib/uploads/utils/embedded-image-ref'

/** View-URL embed (`/api/files/view/<id>`) — the only form the file agent writes; see {@link findUnembeddableImageRefs}. */
const VIEW_EMBED_RE = /\/api\/files\/view\/([A-Za-z0-9_-]+)/g

/**
 * De-duplicated workspace file **ids** embedded in `content` (view URL or in-app workspace path).
 * Shares the {@link extractEmbeddedFileRefs} grammar with the frontend renderer so the referenced-by-doc
 * gate authorizes exactly what the client links. Resolution and access are checked by the caller.
 */
export function extractEmbeddedImageIds(content: string): string[] {
  return extractEmbeddedFileRefs(content).ids
}

/**
 * De-duplicated workspace storage **keys** (`workspace/<wsId>/…`) embedded in `content` via the serve URL.
 * Same shared grammar as {@link extractEmbeddedImageIds}.
 */
export function extractEmbeddedImageKeys(content: string): string[] {
  return extractEmbeddedFileRefs(content).keys
}

/**
 * Returns the ids of `/api/files/view/<id>` image embeds in `content` that will not render or survive a
 * workspace export. An embed is valid only when its id resolves to a workspace file in this same
 * workspace — the only thing the view route serves and an export can bundle. Every other case (missing,
 * archived, a different workspace, or a non-`workspace` upload such as a chat-scoped `mothership` file)
 * is flagged by id alone, without disclosing the referenced file's real context or owning workspace, so
 * the result can't be used to probe files outside this workspace. Best-effort and never throws, so a
 * content write is never blocked by this validation.
 */
export async function findUnembeddableImageRefs(
  content: string,
  workspaceId: string
): Promise<string[]> {
  const ids = new Set<string>()
  for (const match of content.matchAll(VIEW_EMBED_RE)) ids.add(match[1])
  if (ids.size === 0) return []

  const checked = await Promise.all(
    [...ids].map(async (id): Promise<string | null> => {
      try {
        const record = await getFileMetadataById(id)
        const embeddable = record?.context === 'workspace' && record.workspaceId === workspaceId
        return embeddable ? null : id
      } catch {
        return null
      }
    })
  )

  return checked.filter((id): id is string => id !== null)
}

/**
 * Builds an actionable suffix appended to a successful file-write tool result so the model can
 * self-correct: only workspace files in this workspace embed, so any other reference must be re-saved
 * into the workspace and re-referenced by the workspace file's id. Empty when there is nothing to flag.
 */
export async function buildEmbeddedImageRefWarning(
  content: string,
  workspaceId: string
): Promise<string> {
  const ids = await findUnembeddableImageRefs(content, workspaceId)
  if (ids.length === 0) return ''
  const list = ids.map((id) => `/api/files/view/${id}`).join('; ')
  return ` Warning: embedded image(s) will not render or export because they are not workspace files in this workspace — ${list}. Save each image as a workspace file (under files/) and reference it via /api/files/view/<workspace-file-id>.`
}
