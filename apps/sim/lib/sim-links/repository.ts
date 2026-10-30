import { db } from '@sim/db'
import { simLink, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { escapeLikePattern } from '@sim/utils/string'
import { and, asc, eq, gt, ilike, or, type SQL } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { normalizeSimLinkName, type SimLinkFields } from '@/lib/sim-links/validation'

export const SIM_LINK_PAGE_SIZE = 50

export interface SimLinkRecord {
  id: string
  name: string
  normalizedName: string
  url: string
  defaultUrl: string | null
  description: string | null
  unlisted: boolean
  restrictEdit: boolean
  createdBy: { id: string; name: string; image: string | null } | null
  updatedAt: Date
}

export interface SimLinkAccess {
  name: string
  createdBy: string | null
  unlisted: boolean
  restrictEdit: boolean
}

/** Who is looking: unlisted links are listed only to their creator and organization admins. */
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

/** One page of the links `viewer` may browse, in name order; `cursor` is the last normalized name. */
export async function listSimLinks(
  organizationId: string,
  viewer: SimLinkViewer,
  { search, cursor }: { search?: string; cursor?: string }
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
        ilike(simLink.name, pattern),
        ilike(simLink.url, pattern),
        ilike(simLink.description, pattern),
        normalized ? ilike(simLink.normalizedName, `%${escapeLikePattern(normalized)}%`) : undefined
      )
    )
  }
  if (cursor) conditions.push(gt(simLink.normalizedName, cursor))
  const rows = await selectRecords(db)
    .where(and(...conditions))
    .orderBy(asc(simLink.normalizedName))
    .limit(SIM_LINK_PAGE_SIZE + 1)
  const links = rows.slice(0, SIM_LINK_PAGE_SIZE).map(toRecord)
  return {
    links,
    nextCursor: rows.length > SIM_LINK_PAGE_SIZE ? (links.at(-1)?.normalizedName ?? null) : null,
  }
}

export async function getSimLink(
  executor: DbOrTx,
  organizationId: string,
  id: string
): Promise<SimLinkRecord | null> {
  const [row] = await selectRecords(executor)
    .where(and(eq(simLink.organizationId, organizationId), eq(simLink.id, id)))
    .limit(1)
  return row ? toRecord(row) : null
}

/** The destination a typed name leads to, matched case- and punctuation-insensitively. */
export async function findSimLinkDestination(
  organizationId: string,
  name: string
): Promise<{ name: string; url: string; defaultUrl: string | null } | null> {
  const [row] = await db
    .select({ name: simLink.name, url: simLink.url, defaultUrl: simLink.defaultUrl })
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
  organizationId: string,
  createdBy: string,
  fields: SimLinkFields
): Promise<string> {
  const id = generateId()
  await db.insert(simLink).values({
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
