/**
 * GET  /api/v1/admin/referral-campaigns
 *
 * List referral campaigns with optional filtering and pagination.
 *
 * Query Parameters:
 *   - active: string (optional) - Filter by active status ('true' or 'false')
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * POST /api/v1/admin/referral-campaigns
 *
 * Create a new referral campaign.
 *
 * Body:
 *   - name: string (required) - Campaign name
 *   - bonusCreditAmount: number (required, > 0) - Bonus credits in dollars
 *   - code: string | null (optional, min 6 chars, auto-uppercased) - Redeemable code
 *   - utmSource: string | null (optional) - UTM source match (null = wildcard)
 *   - utmMedium: string | null (optional) - UTM medium match (null = wildcard)
 *   - utmCampaign: string | null (optional) - UTM campaign match (null = wildcard)
 *   - utmContent: string | null (optional) - UTM content match (null = wildcard)
 */

import { db } from '@sim/db'
import { referralCampaigns } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count, eq, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminReferralCampaign,
  createPaginationMeta,
  parsePaginationParams,
  toAdminReferralCampaign,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminReferralCampaignsAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)
  const activeFilter = url.searchParams.get('active')

  try {
    const conditions: SQL<unknown>[] = []
    if (activeFilter === 'true') {
      conditions.push(eq(referralCampaigns.isActive, true))
    } else if (activeFilter === 'false') {
      conditions.push(eq(referralCampaigns.isActive, false))
    }

    const whereClause = conditions.length > 0 ? conditions[0] : undefined
    const baseUrl = getBaseUrl()

    const [countResult, campaigns] = await Promise.all([
      db.select({ total: count() }).from(referralCampaigns).where(whereClause),
      db
        .select()
        .from(referralCampaigns)
        .where(whereClause)
        .orderBy(referralCampaigns.createdAt)
        .limit(limit)
        .offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminReferralCampaign[] = campaigns.map((c) => toAdminReferralCampaign(c, baseUrl))
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} referral campaigns (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list referral campaigns', { error })
    return internalErrorResponse('Failed to list referral campaigns')
  }
})

export const POST = withAdminAuth(async (request) => {
  try {
    const body = await request.json()
    const { name, code, utmSource, utmMedium, utmCampaign, utmContent, bonusCreditAmount } = body

    if (!name || typeof name !== 'string') {
      return badRequestResponse('name is required and must be a string')
    }

    if (
      typeof bonusCreditAmount !== 'number' ||
      !Number.isFinite(bonusCreditAmount) ||
      bonusCreditAmount <= 0
    ) {
      return badRequestResponse('bonusCreditAmount must be a positive number')
    }

    if (code !== undefined && code !== null) {
      if (typeof code !== 'string') {
        return badRequestResponse('code must be a string or null')
      }
      if (code.trim().length < 6) {
        return badRequestResponse('code must be at least 6 characters')
      }
    }

    const id = nanoid()

    const [campaign] = await db
      .insert(referralCampaigns)
      .values({
        id,
        name,
        code: code ? code.trim().toUpperCase() : null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        utmContent: utmContent || null,
        bonusCreditAmount: bonusCreditAmount.toString(),
      })
      .returning()

    logger.info(`Admin API: Created referral campaign ${id}`, {
      name,
      code: campaign.code,
      bonusCreditAmount,
    })

    return singleResponse(toAdminReferralCampaign(campaign, getBaseUrl()))
  } catch (error) {
    logger.error('Admin API: Failed to create referral campaign', { error })
    return internalErrorResponse('Failed to create referral campaign')
  }
})
