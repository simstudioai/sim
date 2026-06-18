import { db } from '@sim/db'
import { publicShare, user, workspace, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ShareRecord,
  shareAccessLevelSchema,
  shareAuthTypeSchema,
  shareResourceTypeSchema,
} from '@/lib/api/contracts/public-shares'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('PublicShareManager')

type ShareResourceType = z.infer<typeof shareResourceTypeSchema>
type ShareAccessLevel = z.infer<typeof shareAccessLevelSchema>
type ShareAuthType = z.infer<typeof shareAuthTypeSchema>

type PublicShareRow = typeof publicShare.$inferSelect

/** Public share URL for a token: `{baseUrl}/f/{token}`. */
export function buildShareUrl(token: string): string {
  return `${getBaseUrl()}/f/${token}`
}

function mapShareRecord(row: PublicShareRow): ShareRecord {
  return {
    id: row.id,
    token: row.token,
    url: buildShareUrl(row.token),
    isActive: row.isActive,
    accessLevel: row.accessLevel as ShareAccessLevel,
    authType: row.authType as ShareAuthType,
    resourceType: row.resourceType as ShareResourceType,
    resourceId: row.resourceId,
  }
}

export async function getShareForResource(
  resourceType: ShareResourceType,
  resourceId: string
): Promise<ShareRecord | null> {
  const [row] = await db
    .select()
    .from(publicShare)
    .where(and(eq(publicShare.resourceType, resourceType), eq(publicShare.resourceId, resourceId)))
    .limit(1)

  return row ? mapShareRecord(row) : null
}

/**
 * Batch-fetch shares for many resources of the same type, keyed by `resourceId`.
 * Used to enrich the files list without an N+1 query.
 */
export async function getSharesForResources(
  resourceType: ShareResourceType,
  resourceIds: string[]
): Promise<Map<string, ShareRecord>> {
  const result = new Map<string, ShareRecord>()
  if (resourceIds.length === 0) return result

  const rows = await db
    .select()
    .from(publicShare)
    .where(
      and(eq(publicShare.resourceType, resourceType), inArray(publicShare.resourceId, resourceIds))
    )

  for (const row of rows) {
    result.set(row.resourceId, mapShareRecord(row))
  }
  return result
}

interface UpsertFileShareInput {
  workspaceId: string
  fileId: string
  userId: string
  isActive: boolean
}

/**
 * Enable or disable the public share for a file. First enable inserts a row with
 * a fresh unguessable token; subsequent calls flip `isActive` and keep the token
 * stable (so an existing link resolves again after re-enable).
 */
export async function upsertFileShare({
  workspaceId,
  fileId,
  userId,
  isActive,
}: UpsertFileShareInput): Promise<ShareRecord> {
  const [row] = await db
    .insert(publicShare)
    .values({
      id: generateId(),
      resourceType: 'file',
      resourceId: fileId,
      workspaceId,
      createdBy: userId,
      token: generateShortId(),
      isActive,
    })
    .onConflictDoUpdate({
      target: [publicShare.resourceType, publicShare.resourceId],
      set: { isActive, updatedAt: new Date() },
    })
    .returning()

  logger.info('Upserted file share', { fileId, workspaceId, isActive, token: row.token })
  return mapShareRecord(row)
}

/**
 * Resolve a public token to its active share and the underlying (non-deleted)
 * file. Returns null if the token is unknown, the share is inactive, or the file
 * is gone. The caller treats null as a 404 — the existence of a file is never
 * leaked through this path.
 */
export interface ResolvedShare {
  share: PublicShareRow
  file: typeof workspaceFiles.$inferSelect
  /** Owning workspace name, for provenance on the public page. */
  workspaceName: string | null
  /** Display name of the file's uploader. */
  ownerName: string | null
}

export async function resolveActiveShareByToken(token: string): Promise<ResolvedShare | null> {
  const [row] = await db
    .select({
      share: publicShare,
      file: workspaceFiles,
      workspaceName: workspace.name,
      ownerName: user.name,
    })
    .from(publicShare)
    .innerJoin(workspaceFiles, eq(workspaceFiles.id, publicShare.resourceId))
    .leftJoin(workspace, eq(workspace.id, workspaceFiles.workspaceId))
    .leftJoin(user, eq(user.id, workspaceFiles.userId))
    .where(
      and(
        eq(publicShare.token, token),
        eq(publicShare.isActive, true),
        eq(publicShare.resourceType, 'file')
      )
    )
    .limit(1)

  if (!row) return null
  if (row.file.deletedAt) return null

  return {
    share: row.share,
    file: row.file,
    workspaceName: row.workspaceName,
    ownerName: row.ownerName,
  }
}
