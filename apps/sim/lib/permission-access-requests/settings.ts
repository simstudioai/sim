import { db } from '@sim/db'
import { organizationAccessRequestSettings } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
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

/** The rollout flag is evaluated globally; organization preferences can only narrow it. */
export async function isAccessRequestEnabled(
  organizationId: string,
  executor: DbOrTx = db,
  globalEnabled?: boolean
): Promise<boolean> {
  if (!(globalEnabled ?? (await isFeatureEnabled('permission-access-requests')))) return false
  return (await readAccessRequestSettings(organizationId, executor)).allowRequests
}
