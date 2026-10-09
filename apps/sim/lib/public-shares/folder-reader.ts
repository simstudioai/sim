import { db } from '@sim/db'
import { publicShare, type WorkspaceFileRow, workspace, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readActiveFolderAncestry } from '@/lib/public-shares/folder-scope'
import type { ResolvedFolderShare, ResolvedResourceShare } from '@/lib/public-shares/share-manager'

const PAGE_SIZE = 100
const cursorSchema = z
  .object({
    shareId: z.string(),
    folderId: z.string(),
    kind: z.enum(['folder', 'file']),
    direction: z.enum(['next', 'previous']),
    name: z.string().max(1024),
    id: z.string().max(128),
  })
  .strict()

interface SharedFolderEntry {
  id: string
  kind: 'folder' | 'file'
  name: string
  type: string
  size: number
  version: number
}

interface SharedFolderPage {
  folder: { id: string; name: string }
  breadcrumbs: { id: string; name: string }[]
  entries: SharedFolderEntry[]
  nextCursor: string | null
  previousCursor: string | null
}

/** Rechecks the grant before data access, including policy changes after authentication. */
async function shareIsCurrent(resolved: ResolvedResourceShare): Promise<boolean> {
  const { share } = resolved
  const [current] = await db
    .select({ id: publicShare.id })
    .from(publicShare)
    .innerJoin(workspace, eq(workspace.id, publicShare.workspaceId))
    .where(
      and(
        eq(publicShare.id, share.id),
        isNull(workspace.archivedAt),
        eq(publicShare.token, share.token),
        eq(publicShare.workspaceId, share.workspaceId),
        eq(publicShare.resourceType, share.resourceType),
        eq(publicShare.resourceId, share.resourceId),
        eq(publicShare.isActive, true),
        eq(publicShare.authType, share.authType),
        share.password === null
          ? isNull(publicShare.password)
          : eq(publicShare.password, share.password),
        sql`coalesce(nullif(${publicShare.allowedEmails}::jsonb, 'null'::jsonb), '[]'::jsonb) = ${JSON.stringify(share.allowedEmails ?? [])}::jsonb`
      )
    )
    .limit(1)
  return Boolean(current)
}

async function folderBreadcrumbs(resolved: ResolvedFolderShare, folderId: string) {
  const ancestry = await readActiveFolderAncestry(resolved.share.workspaceId, folderId)
  const rootIndex = ancestry?.findIndex((entry) => entry.id === resolved.folder.id) ?? -1
  return ancestry && rootIndex >= 0
    ? ancestry.slice(rootIndex).map(({ id, name }) => ({ id, name }))
    : null
}

/** Resolves only a live file in the current capability, never a sibling or another workspace. */
export async function resolveSharedFile(
  resolved: ResolvedResourceShare,
  fileId?: string
): Promise<WorkspaceFileRow | null> {
  if (!(await shareIsCurrent(resolved))) return null
  const targetId = resolved.kind === 'file' ? resolved.share.resourceId : fileId
  if (!targetId || (resolved.kind === 'file' && fileId !== undefined && fileId !== targetId))
    return null
  const [file] = await db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, targetId),
        eq(workspaceFiles.workspaceId, resolved.share.workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)
  if (!file) return null
  if (
    resolved.kind === 'folder' &&
    (!file.folderId || !(await folderBreadcrumbs(resolved, file.folderId)))
  )
    return null
  return file
}

/** Lists one page of immediate children after fresh subtree containment, without loading a tree. */
export async function readSharedFolderPage(
  resolved: ResolvedFolderShare,
  input: { folderId?: string; cursor?: string }
): Promise<SharedFolderPage | null> {
  if (!(await shareIsCurrent(resolved))) return null
  const folderId = input.folderId ?? resolved.folder.id
  const breadcrumbs = await folderBreadcrumbs(resolved, folderId)
  const current = breadcrumbs?.at(-1)
  if (!breadcrumbs || !current) return null

  let cursor: z.output<typeof cursorSchema> | undefined
  if (input.cursor !== undefined) {
    try {
      if (input.cursor.length > 4096) throw new Error('Cursor too long')
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
      )
      if (cursor.shareId !== resolved.share.id || cursor.folderId !== folderId)
        throw new Error('Cursor scope changed')
    } catch {
      throw new OrchestrationError(
        'validation',
        'Invalid folder cursor. Restart from the first page.'
      )
    }
  }

  const previous = cursor?.direction === 'previous'
  const order = previous ? sql`DESC` : sql`ASC`
  const afterFolder = !cursor
    ? sql`TRUE`
    : cursor.kind === 'file'
      ? previous
        ? sql`TRUE`
        : sql`FALSE`
      : previous
        ? sql`(name, id) < (${cursor.name}, ${cursor.id})`
        : sql`(name, id) > (${cursor.name}, ${cursor.id})`
  const afterFile = !cursor
    ? sql`TRUE`
    : cursor.kind === 'folder'
      ? previous
        ? sql`FALSE`
        : sql`TRUE`
      : previous
        ? sql`(original_name, id) < (${cursor.name}, ${cursor.id})`
        : sql`(original_name, id) > (${cursor.name}, ${cursor.id})`
  // Match the active name indexes’ coalesced parent key so each page seeks directly into name order.
  const rows = await db.execute<SharedFolderEntry & { rank: number } & Record<string, unknown>>(sql`
    SELECT * FROM (
      (SELECT id, 'folder'::text AS kind, name, ''::text AS type,
        0::double precision AS size, (extract(epoch FROM updated_at) * 1000)::double precision AS version,
        0 AS rank
       FROM folder
       WHERE workspace_id = ${resolved.share.workspaceId} AND resource_type = 'file'
         AND coalesce(parent_id, '') = ${folderId} AND deleted_at IS NULL AND ${afterFolder}
       ORDER BY name ${order}, id ${order} LIMIT ${PAGE_SIZE + 1})
      UNION ALL
      (SELECT id, 'file'::text AS kind, original_name AS name, content_type AS type,
        coalesce(size_bytes, 0)::double precision AS size,
        (extract(epoch FROM updated_at) * 1000)::double precision AS version, 1 AS rank
       FROM workspace_files
       WHERE workspace_id = ${resolved.share.workspaceId} AND context = 'workspace'
         AND coalesce(folder_id, '') = ${folderId} AND deleted_at IS NULL AND ${afterFile}
       ORDER BY original_name ${order}, id ${order} LIMIT ${PAGE_SIZE + 1})
    ) entries ORDER BY rank ${order}, name ${order}, id ${order} LIMIT ${PAGE_SIZE + 1}
  `)
  const entries = rows.slice(0, PAGE_SIZE).map(({ rank: _rank, ...entry }) => entry)
  if (previous) entries.reverse()
  const encode = (entry: SharedFolderEntry | undefined, direction: 'next' | 'previous') =>
    entry
      ? Buffer.from(
          JSON.stringify({
            shareId: resolved.share.id,
            folderId,
            kind: entry.kind,
            direction,
            name: entry.name,
            id: entry.id,
          })
        ).toString('base64url')
      : null
  const hasMore = rows.length > PAGE_SIZE
  return {
    folder: current,
    breadcrumbs,
    entries,
    nextCursor: previous || hasMore ? encode(entries.at(-1), 'next') : null,
    previousCursor: (previous ? hasMore : Boolean(cursor)) ? encode(entries[0], 'previous') : null,
  }
}
