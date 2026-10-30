import { db } from '@sim/db'
import { simLink, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { escapeLikePattern } from '@sim/utils/string'
import { and, asc, desc, eq, gt, ilike, lt, or, type SQL, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import {
  normalizeSimLinkName,
  type SimLinkFields,
  type SimLinkSort,
} from '@/lib/sim-links/validation'

const PAGE_SIZE = 50

export interface SimLinkRecord {
  id: string
  name: string
  normalizedName: string
  url: string
  defaultUrl: string | null
  description: string | null
  unlisted: boolean
  restrictEdit: boolean
  visitCount: number
  createdBy: { id: string; name: string; image: string | null } | null
  updatedAt: Date
}

export interface SimLinkAccess {
  name: string
  createdBy: string | null
  unlisted: boolean
  restrictEdit: boolean
}

export interface SimLinkViewer {
  userId: string
  isAdmin: boolean
}

const recordColumns = {
  id: simLink.id,
  name: simLink.name,
  normalizedName: simLink.normalizedName,
  url: simLink.url,
  defaultUrl: simLink.defaultUrl,
  description: simLink.description,
  unlisted: simLink.unlisted,
  restrictEdit: simLink.restrictEdit,
  visitCount: simLink.visitCount,
  updatedAt: simLink.updatedAt,
  creatorId: user.id,
  creatorName: user.name,
  creatorImage: user.image,
}

function selectRecords(executor: DbOrTx) {
  return executor.select(recordColumns).from(simLink).leftJoin(user, eq(user.id, simLink.createdBy))
}

function toRecord({
  creatorId,
  creatorName,
  creatorImage,
  ...row
}: Awaited<ReturnType<typeof selectRecords>>[number]): SimLinkRecord {
  return {
    ...row,
    createdBy:
      creatorId && creatorName ? { id: creatorId, name: creatorName, image: creatorImage } : null,
  }
}

/**
 * A keyset position: the last row's normalized name, preceded by its visit count when sorting
 * by use. Normalized names never contain `:`, so the first one separates the two.
 */
function cursorOf(sort: SimLinkSort, row: SimLinkRecord): string {
  return sort === 'popular' ? `${row.visitCount}:${row.normalizedName}` : row.normalizedName
}

function afterCursor(sort: SimLinkSort, cursor: string): SQL | undefined {
  if (sort === 'name') return gt(simLink.normalizedName, cursor)
  const separator = cursor.indexOf(':')
  const visits = Number(cursor.slice(0, separator))
  if (separator < 1 || !Number.isSafeInteger(visits)) {
    throw new OrchestrationError('validation', 'Invalid cursor')
  }
  const name = cursor.slice(separator + 1)
  return or(
    lt(simLink.visitCount, visits),
    and(eq(simLink.visitCount, visits), gt(simLink.normalizedName, name))
  )
}

/**
 * One page of the links `viewer` may browse, by name or by most visited. Unlisted links are
 * listed only to their creator and organization admins.
 */
export async function listSimLinks(
  organizationId: string,
  viewer: SimLinkViewer,
  { search, cursor, sort = 'name' }: { search?: string; cursor?: string; sort?: SimLinkSort }
): Promise<{ links: SimLinkRecord[]; nextCursor: string | null }> {
  const conditions: (SQL | undefined)[] = [eq(simLink.organizationId, organizationId)]
  if (!viewer.isAdmin) {
    conditions.push(or(eq(simLink.unlisted, false), eq(simLink.createdBy, viewer.userId)))
  }
  const query = search?.trim().replace(/^sim\//i, '')
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`
    const normalized = normalizeSimLinkName(query)
    conditions.push(
      or(
        ilike(simLink.url, pattern),
        ilike(simLink.description, pattern),
        normalized ? ilike(simLink.normalizedName, `%${escapeLikePattern(normalized)}%`) : undefined
      )
    )
  }
  if (cursor) conditions.push(afterCursor(sort, cursor))
  const order =
    sort === 'popular'
      ? [desc(simLink.visitCount), asc(simLink.normalizedName)]
      : [asc(simLink.normalizedName)]
  const rows = await selectRecords(db)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(PAGE_SIZE + 1)
  const links = rows.slice(0, PAGE_SIZE).map(toRecord)
  const last = links.at(-1)
  return { links, nextCursor: rows.length > PAGE_SIZE && last ? cursorOf(sort, last) : null }
}

export async function getSimLink(
  tx: DbTransaction,
  organizationId: string,
  id: string
): Promise<SimLinkRecord | null> {
  const [row] = await selectRecords(tx)
    .where(and(eq(simLink.organizationId, organizationId), eq(simLink.id, id)))
    .limit(1)
  return row ? toRecord(row) : null
}

/** The destination a typed name leads to, matched case- and punctuation-insensitively. */
export async function findSimLinkDestination(
  organizationId: string,
  name: string
): Promise<{ id: string; name: string; url: string; defaultUrl: string | null } | null> {
  const [row] = await db
    .select({
      id: simLink.id,
      name: simLink.name,
      url: simLink.url,
      defaultUrl: simLink.defaultUrl,
    })
    .from(simLink)
    .where(
      and(
        eq(simLink.organizationId, organizationId),
        eq(simLink.normalizedName, normalizeSimLinkName(name))
      )
    )
    .limit(1)
  return row ?? null
}

/** Counts a redirect. Visits never change `updated_at`, which tracks edits. */
export async function recordSimLinkVisit(organizationId: string, id: string): Promise<void> {
  await db
    .update(simLink)
    .set({ visitCount: sql`${simLink.visitCount} + 1`, lastVisitedAt: new Date() })
    .where(and(eq(simLink.organizationId, organizationId), eq(simLink.id, id)))
}

/** Locks a link's access fields for the rest of `tx`, so an edit is judged against current access. */
export async function lockSimLinkAccess(
  tx: DbTransaction,
  organizationId: string,
  id: string
): Promise<SimLinkAccess | null> {
  const [row] = await tx
    .select({
      name: simLink.name,
      createdBy: simLink.createdBy,
      unlisted: simLink.unlisted,
      restrictEdit: simLink.restrictEdit,
    })
    .from(simLink)
    .where(and(eq(simLink.organizationId, organizationId), eq(simLink.id, id)))
    .for('update')
    .limit(1)
  return row ?? null
}

export async function insertSimLink(
  tx: DbTransaction,
  organizationId: string,
  createdBy: string,
  fields: SimLinkFields
): Promise<string> {
  const id = generateId()
  await tx.insert(simLink).values({
    id,
    organizationId,
    createdBy,
    normalizedName: normalizeSimLinkName(fields.name),
    ...fields,
  })
  return id
}

export async function updateSimLink(
  tx: DbTransaction,
  organizationId: string,
  id: string,
  fields: SimLinkFields
): Promise<void> {
  await tx
    .update(simLink)
    .set({ ...fields, normalizedName: normalizeSimLinkName(fields.name), updatedAt: new Date() })
    .where(and(eq(simLink.organizationId, organizationId), eq(simLink.id, id)))
}

export async function deleteSimLink(
  tx: DbTransaction,
  organizationId: string,
  id: string
): Promise<void> {
  await tx
    .delete(simLink)
    .where(and(eq(simLink.organizationId, organizationId), eq(simLink.id, id)))
}
