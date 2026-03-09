/**
 * GET   /api/v1/admin/referral-campaigns/:id
 *
 * Get a single referral campaign by ID.
 *
 * PATCH /api/v1/admin/referral-campaigns/:id
 *
 * Update campaign fields. All fields are optional.
 *
 * Body:
 *   - name: string (non-empty) - Campaign name
 *   - bonusCreditAmount: number (> 0) - Bonus credits in dollars
 *   - isActive: boolean - Enable/disable the campaign
 *   - code: string | null (min 6 chars, auto-uppercased, null to remove) - Redeemable code
 *   - utmSource: string | null - UTM source match (null = wildcard)
 *   - utmMedium: string | null - UTM medium match (null = wildcard)
 *   - utmCampaign: string | null - UTM campaign match (null = wildcard)
 *   - utmContent: string | null - UTM content match (null = wildcard)
 */

import { db } from '@sim/db'
import { referralCampaigns } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { toAdminReferralCampaign } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminReferralCampaignDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (_, context) => {
  try {
    const { id: campaignId } = await context.params

    const [campaign] = await db
      .select()
      .from(referralCampaigns)
      .where(eq(referralCampaigns.id, campaignId))
      .limit(1)

    if (!campaign) {
      return notFoundResponse('Campaign')
    }

    logger.info(`Admin API: Retrieved referral campaign ${campaignId}`)

    return singleResponse(toAdminReferralCampaign(campaign, getBaseUrl()))
  } catch (error) {
    logger.error('Admin API: Failed to get referral campaign', { error })
    return internalErrorResponse('Failed to get referral campaign')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  try {
    const { id: campaignId } = await context.params
    const body = await request.json()

    const [existing] = await db
      .select()
      .from(referralCampaigns)
      .where(eq(referralCampaigns.id, campaignId))
      .limit(1)

    if (!existing) {
      return notFoundResponse('Campaign')
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return badRequestResponse('name must be a non-empty string')
      }
      updateData.name = body.name.trim()
    }

    if (body.bonusCreditAmount !== undefined) {
      if (
        typeof body.bonusCreditAmount !== 'number' ||
        !Number.isFinite(body.bonusCreditAmount) ||
        body.bonusCreditAmount <= 0
      ) {
        return badRequestResponse('bonusCreditAmount must be a positive number')
      }
      updateData.bonusCreditAmount = body.bonusCreditAmount.toString()
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        return badRequestResponse('isActive must be a boolean')
      }
      updateData.isActive = body.isActive
    }

    if (body.code !== undefined) {
      if (body.code !== null) {
        if (typeof body.code !== 'string') {
          return badRequestResponse('code must be a string or null')
        }
        if (body.code.trim().length < 6) {
          return badRequestResponse('code must be at least 6 characters')
        }
      }
      updateData.code = body.code ? body.code.trim().toUpperCase() : null
    }

    for (const field of ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent'] as const) {
      if (body[field] !== undefined) {
        if (body[field] !== null && typeof body[field] !== 'string') {
          return badRequestResponse(`${field} must be a string or null`)
        }
        updateData[field] = body[field] || null
      }
    }

    const [updated] = await db
      .update(referralCampaigns)
      .set(updateData)
      .where(eq(referralCampaigns.id, campaignId))
      .returning()

    logger.info(`Admin API: Updated referral campaign ${campaignId}`, {
      fields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
    })

    return singleResponse(toAdminReferralCampaign(updated, getBaseUrl()))
  } catch (error) {
    logger.error('Admin API: Failed to update referral campaign', { error })
    return internalErrorResponse('Failed to update referral campaign')
  }
})
