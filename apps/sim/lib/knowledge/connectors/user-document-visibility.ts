import { db } from '@sim/db'
import { document } from '@sim/db/schema'
import { sql } from 'drizzle-orm'
import { sourceAclFreshnessCutoff } from '@/lib/knowledge/access/predicate'
import { userToken } from '@/lib/knowledge/access/tokens'

/**
 * Whether readers can still see any of this connector's documents granted to one user: a live,
 * included document carrying their token with permission evidence inside the freshness limit.
 * The user's grants are materialized from `doc_acl_gin_idx` first, so the probe is bounded by
 * that user's grants instead of the connector's size. Planned inline, `LIMIT 1` makes a
 * sequential scan look cheaper than the index, because PostgreSQL cannot estimate array overlap.
 */
export async function hasVisibleUserDocuments(
  connectorId: string,
  email: string
): Promise<boolean> {
  const token = userToken(email)
  if (!token) return false
  const rows = await db.execute(sql`
    WITH granted AS MATERIALIZED (
      SELECT ${document.connectorId}, ${document.userExcluded}, ${document.archivedAt}, ${document.aclVerifiedAt}
      FROM ${document}
      WHERE ${document.deletedAt} IS NULL AND ${document.acl} && ARRAY[${token}]::text[]
    )
    SELECT 1 FROM granted AS ${document}
    WHERE ${document.connectorId} = ${connectorId}
      AND ${document.userExcluded} = false
      AND ${document.archivedAt} IS NULL
      AND ${document.aclVerifiedAt} > ${sourceAclFreshnessCutoff()}
    LIMIT 1
  `)
  return rows.length > 0
}
