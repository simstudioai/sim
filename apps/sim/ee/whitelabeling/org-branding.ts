import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { OrganizationWhitelabelSettings } from '@/lib/branding/types'

const logger = createLogger('OrgBranding')

/**
 * Fetch whitelabel settings for an organization from the database.
 */
export async function getOrgWhitelabelSettings(
  orgId: string
): Promise<OrganizationWhitelabelSettings | null> {
  try {
    const [org] = await db
      .select({ whitelabelSettings: organization.whitelabelSettings })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)

    return org?.whitelabelSettings ?? null
  } catch (error) {
    logger.error('Failed to fetch org whitelabel settings', { error, orgId })
    return null
  }
}
