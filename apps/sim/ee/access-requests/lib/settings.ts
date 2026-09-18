import { db } from '@sim/db'
import { organizationAccessRequestSettings } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/** Missing settings preserve the default-on organization preference. */
export async function readAccessRequestSettings(organizationId: string, executor: DbOrTx = db) {
  const [row] = await executor
    .select({ allowRequests: organizationAccessRequestSettings.allowRequests })
    .from(organizationAccessRequestSettings)
    .where(eq(organizationAccessRequestSettings.organizationId, organizationId))
    .limit(1)
  return { allowRequests: row?.allowRequests ?? true }
}

/** Access requests are on unless the organization has opted out. */
export async function isAccessRequestEnabled(
  organizationId: string,
  executor: DbOrTx = db
): Promise<boolean> {
  return (await readAccessRequestSettings(organizationId, executor)).allowRequests
}
