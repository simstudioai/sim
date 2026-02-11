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
 *   - name?: string — Campaign name (non-empty)
 *   - bonusCreditAmount?: number — Bonus credits in dollars (> 0)
 *   - isActive?: boolean — Enable/disable the campaign
 *   - code?: string | null — Redeemable code (min 6 chars, auto-uppercased, null to remove)
 *   - utmSource?: string | null — UTM source match (null = wildcard)
 *   - utmMedium?: string | null — UTM medium match (null = wildcard)
 *   - utmCampaign?: string | null — UTM campaign match (null = wildcard)
 *   - utmContent?: string | null — UTM content match (null = wildcard)
 */

import { db } from '@sim/db'
import { referralCampaigns } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminReferralCampaign')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (_request, context) => {
  try {
    const { id } = await context.params

    const [campaign] = await db
      .select()
      .from(referralCampaigns)
      .where(eq(referralCampaigns.id, id))
      .limit(1)

    if (!campaign) {
      return notFoundResponse('Campaign')
    }

    return singleResponse(campaign)
  } catch (error) {
    logger.error('Failed to get referral campaign', { error })
    return internalErrorResponse('Failed to get referral campaign')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  try {
    const { id } = await context.params
    const body = await request.json()

    const [existing] = await db
      .select()
      .from(referralCampaigns)
      .where(eq(referralCampaigns.id, id))
      .limit(1)

    if (!existing) {
      return notFoundResponse('Campaign')
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name) {
        return badRequestResponse('name must be a non-empty string')
      }
      updates.name = body.name
    }

    if (body.bonusCreditAmount !== undefined) {
      if (
        typeof body.bonusCreditAmount !== 'number' ||
        !Number.isFinite(body.bonusCreditAmount) ||
        body.bonusCreditAmount <= 0
      ) {
        return badRequestResponse('bonusCreditAmount must be a positive number')
      }
      updates.bonusCreditAmount = body.bonusCreditAmount.toString()
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        return badRequestResponse('isActive must be a boolean')
      }
      updates.isActive = body.isActive
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
      updates.code = body.code ? body.code.trim().toUpperCase() : null
    }

    for (const field of ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent'] as const) {
      if (body[field] !== undefined) {
        if (body[field] !== null && typeof body[field] !== 'string') {
          return badRequestResponse(`${field} must be a string or null`)
        }
        updates[field] = body[field]
      }
    }

    const [updated] = await db
      .update(referralCampaigns)
      .set(updates)
      .where(eq(referralCampaigns.id, id))
      .returning()

    logger.info('Updated referral campaign', { id, updates })

    return singleResponse(updated)
  } catch (error) {
    logger.error('Failed to update referral campaign', { error })
    return internalErrorResponse('Failed to update referral campaign')
  }
})
