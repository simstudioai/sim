import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { BrandConfig, OrganizationWhitelabelSettings } from '@/lib/branding/types'
import { getBrandConfig } from '@/ee/whitelabeling/branding'
import { mergeOrgBrandConfig } from '@/ee/whitelabeling/org-branding-utils'

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

/**
 * Get the merged brand config for an org, combining instance env vars with org DB settings.
 */
export async function getOrgBrandConfig(orgId: string): Promise<BrandConfig> {
  const orgSettings = await getOrgWhitelabelSettings(orgId)
  return mergeOrgBrandConfig(orgSettings, getBrandConfig())
}
