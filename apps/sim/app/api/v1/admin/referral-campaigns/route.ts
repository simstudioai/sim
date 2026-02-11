/**
 * GET  /api/v1/admin/referral-campaigns — List all campaigns (optional ?active=true filter)
 * POST /api/v1/admin/referral-campaigns — Create a new campaign
 */

import { db } from '@sim/db'
import { referralCampaigns } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { createPaginationMeta, parsePaginationParams } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminReferralCampaigns')

export const GET = withAdminAuth(async (request) => {
  try {
    const url = new URL(request.url)
    const { limit, offset } = parsePaginationParams(url)
    const activeFilter = url.searchParams.get('active')

    let query = db.select().from(referralCampaigns).$dynamic()

    if (activeFilter === 'true') {
      query = query.where(eq(referralCampaigns.isActive, true))
    } else if (activeFilter === 'false') {
      query = query.where(eq(referralCampaigns.isActive, false))
    }

    const rows = await query.limit(limit).offset(offset)

    // Count total for pagination
    let countQuery = db.select().from(referralCampaigns).$dynamic()
    if (activeFilter === 'true') {
      countQuery = countQuery.where(eq(referralCampaigns.isActive, true))
    } else if (activeFilter === 'false') {
      countQuery = countQuery.where(eq(referralCampaigns.isActive, false))
    }
    const allRows = await countQuery
    const total = allRows.length

    return listResponse(rows, createPaginationMeta(total, limit, offset))
  } catch (error) {
    logger.error('Failed to list referral campaigns', { error })
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

    if (code !== undefined && code !== null && typeof code !== 'string') {
      return badRequestResponse('code must be a string or null')
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

    logger.info('Created referral campaign', {
      id,
      name,
      code: campaign.code,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      bonusCreditAmount,
    })

    return singleResponse(campaign)
  } catch (error) {
    logger.error('Failed to create referral campaign', { error })
    return internalErrorResponse('Failed to create referral campaign')
  }
})
