import { peopleDirectoryScimChange as change, peopleDirectorySync as sync } from '@sim/db/schema'
import { sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/** An upsert serializes concurrent changes with the short claim that consumes the marker. */
export async function markScimPeopleChanged(tx: DbOrTx, organizationId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO ${change} (organization_id)
    SELECT organization_id FROM ${sync} WHERE organization_id=${organizationId} AND source='scim'
    ON CONFLICT (organization_id) DO UPDATE SET changed_at=excluded.changed_at
  `)
}

export const pendingScimChange = sql<Date | null>`(SELECT ${change.changedAt} FROM ${change}
  WHERE ${change.organizationId}=${sync.organizationId} AND ${sync.source}='scim')`.mapWith(
  change.changedAt
)
