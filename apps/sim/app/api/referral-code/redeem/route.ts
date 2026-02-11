/**
 * POST /api/referral-code/redeem
 *
 * Redeem a referral/promo code to receive bonus credits.
 *
 * Body:
 *   - code: string — The referral code to redeem
 *
 * Response: { redeemed: boolean, bonusAmount?: number, error?: string }
 *
 * Constraints:
 *   - Enterprise users cannot redeem codes
 *   - One redemption per user, ever (unique constraint on userId)
 *   - One redemption per organization for team users (partial unique on organizationId)
 */

import { db } from '@sim/db'
import { referralAttribution, referralCampaigns, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { applyBonusCredits } from '@/lib/billing/credits/bonus'

const logger = createLogger('ReferralCodeRedemption')

const RedeemCodeSchema = z.object({
  code: z.string().min(1, 'Code is required'),
})

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { code } = RedeemCodeSchema.parse(body)

    const subscription = await getHighestPrioritySubscription(session.user.id)

    if (subscription?.plan === 'enterprise') {
      return NextResponse.json({
        redeemed: false,
        error: 'Enterprise accounts cannot redeem referral codes',
      })
    }

    const isTeam = subscription?.plan === 'team'
    const orgId = isTeam ? subscription.referenceId : null

    const normalizedCode = code.trim().toUpperCase()

    const [campaign] = await db
      .select()
      .from(referralCampaigns)
      .where(and(eq(referralCampaigns.code, normalizedCode), eq(referralCampaigns.isActive, true)))
      .limit(1)

    if (!campaign) {
      logger.info('Invalid code redemption attempt', {
        userId: session.user.id,
        code: normalizedCode,
      })
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 404 })
    }

    const [existingUserAttribution] = await db
      .select({ id: referralAttribution.id })
      .from(referralAttribution)
      .where(eq(referralAttribution.userId, session.user.id))
      .limit(1)

    if (existingUserAttribution) {
      return NextResponse.json({
        redeemed: false,
        error: 'You have already redeemed a code',
      })
    }

    if (orgId) {
      const [existingOrgAttribution] = await db
        .select({ id: referralAttribution.id })
        .from(referralAttribution)
        .where(eq(referralAttribution.organizationId, orgId))
        .limit(1)

      if (existingOrgAttribution) {
        return NextResponse.json({
          redeemed: false,
          error: 'A code has already been redeemed for your organization',
        })
      }
    }

    const [existingStats] = await db
      .select({ id: userStats.id })
      .from(userStats)
      .where(eq(userStats.userId, session.user.id))
      .limit(1)

    if (!existingStats) {
      await db.insert(userStats).values({
        id: nanoid(),
        userId: session.user.id,
      })
    }

    const bonusAmount = Number(campaign.bonusCreditAmount)

    let redeemed = false
    await db.transaction(async (tx) => {
      const result = await tx
        .insert(referralAttribution)
        .values({
          id: nanoid(),
          userId: session.user.id,
          organizationId: orgId,
          campaignId: campaign.id,
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          utmContent: null,
          referrerUrl: null,
          landingPage: null,
          bonusCreditAmount: bonusAmount.toString(),
        })
        .onConflictDoNothing()
        .returning({ id: referralAttribution.id })

      if (result.length > 0) {
        await applyBonusCredits(session.user.id, bonusAmount, tx)
        redeemed = true
      }
    })

    if (redeemed) {
      logger.info('Referral code redeemed', {
        userId: session.user.id,
        organizationId: orgId,
        code: normalizedCode,
        campaignId: campaign.id,
        campaignName: campaign.name,
        bonusAmount,
      })
    }

    if (!redeemed) {
      return NextResponse.json({
        redeemed: false,
        error: 'You have already redeemed a code',
      })
    }

    return NextResponse.json({
      redeemed: true,
      bonusAmount,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    logger.error('Referral code redemption error', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
