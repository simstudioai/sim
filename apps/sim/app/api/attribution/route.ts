import { db } from '@sim/db'
import { DEFAULT_REFERRAL_BONUS_CREDITS } from '@sim/db/constants'
import { referralAttribution, referralCampaigns, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { applyBonusCredits } from '@/lib/billing/credits/bonus'

const logger = createLogger('AttributionAPI')

const COOKIE_NAME = 'sim_utm'

/**
 * Maximum allowed gap between when the UTM cookie was set and when the user
 * account was created. Accounts for client/server clock skew. If the user's
 * `createdAt` is more than this amount *before* the cookie timestamp, the
 * attribution is rejected (the user already existed before visiting the link).
 */
const CLOCK_DRIFT_TOLERANCE_MS = 60 * 1000

/**
 * Finds the most specific active campaign matching the given UTM params.
 * Specificity = number of non-null UTM fields that match. A null field on
 * the campaign acts as a wildcard (matches anything).
 */
async function findMatchingCampaign(utmData: Record<string, string>) {
  const campaigns = await db
    .select()
    .from(referralCampaigns)
    .where(eq(referralCampaigns.isActive, true))

  let bestMatch: (typeof campaigns)[number] | null = null
  let bestScore = -1

  for (const campaign of campaigns) {
    let score = 0
    let mismatch = false

    const fields = [
      { campaignVal: campaign.utmSource, utmVal: utmData.utm_source },
      { campaignVal: campaign.utmMedium, utmVal: utmData.utm_medium },
      { campaignVal: campaign.utmCampaign, utmVal: utmData.utm_campaign },
      { campaignVal: campaign.utmContent, utmVal: utmData.utm_content },
    ] as const

    for (const { campaignVal, utmVal } of fields) {
      if (campaignVal === null) continue
      if (campaignVal === utmVal) {
        score++
      } else {
        mismatch = true
        break
      }
    }

    if (!mismatch && score > 0) {
      if (
        score > bestScore ||
        (score === bestScore &&
          bestMatch &&
          campaign.createdAt.getTime() > bestMatch.createdAt.getTime())
      ) {
        bestScore = score
        bestMatch = campaign
      }
    }
  }

  return bestMatch
}

export async function POST() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const cookieStore = await cookies()
    const utmCookie = cookieStore.get(COOKIE_NAME)
    if (!utmCookie?.value) {
      return NextResponse.json({ attributed: false, reason: 'no_utm_cookie' })
    }

    let utmData: Record<string, string>
    try {
      utmData = JSON.parse(decodeURIComponent(utmCookie.value))
    } catch {
      logger.warn('Failed to parse UTM cookie', { userId: session.user.id })
      cookieStore.delete(COOKIE_NAME)
      return NextResponse.json({ attributed: false, reason: 'invalid_cookie' })
    }

    // Verify user was created AFTER visiting the UTM link.
    // The cookie embeds a `created_at` timestamp from when the UTM link was
    // visited. If `user.createdAt` predates that timestamp (minus a small
    // clock-drift tolerance), the user already existed and is not eligible.
    const cookieCreatedAt = Number(utmData.created_at)
    if (!cookieCreatedAt || !Number.isFinite(cookieCreatedAt)) {
      logger.warn('UTM cookie missing created_at timestamp', { userId: session.user.id })
      cookieStore.delete(COOKIE_NAME)
      return NextResponse.json({ attributed: false, reason: 'invalid_cookie' })
    }

    const userRows = await db
      .select({ createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    if (userRows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const userCreatedAt = userRows[0].createdAt.getTime()
    if (userCreatedAt < cookieCreatedAt - CLOCK_DRIFT_TOLERANCE_MS) {
      logger.info('User account predates UTM cookie, skipping attribution', {
        userId: session.user.id,
        userCreatedAt: new Date(userCreatedAt).toISOString(),
        cookieCreatedAt: new Date(cookieCreatedAt).toISOString(),
      })
      cookieStore.delete(COOKIE_NAME)
      return NextResponse.json({ attributed: false, reason: 'account_predates_cookie' })
    }

    // Ensure userStats record exists (may not yet for brand-new signups)
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

    // Look up the matching campaign to determine bonus amount
    const matchedCampaign = await findMatchingCampaign(utmData)
    const bonusAmount = matchedCampaign
      ? Number(matchedCampaign.bonusCreditAmount)
      : DEFAULT_REFERRAL_BONUS_CREDITS

    // Attribution insert + credit application in a single transaction.
    // If the credit update fails, the attribution record rolls back so
    // the client can safely retry on next workspace load.
    let attributed = false
    await db.transaction(async (tx) => {
      const result = await tx
        .insert(referralAttribution)
        .values({
          id: nanoid(),
          userId: session.user.id,
          campaignId: matchedCampaign?.id ?? null,
          utmSource: utmData.utm_source || null,
          utmMedium: utmData.utm_medium || null,
          utmCampaign: utmData.utm_campaign || null,
          utmContent: utmData.utm_content || null,
          referrerUrl: utmData.referrer_url || null,
          landingPage: utmData.landing_page || null,
          bonusCreditAmount: bonusAmount.toString(),
        })
        .onConflictDoNothing({ target: referralAttribution.userId })
        .returning({ id: referralAttribution.id })

      if (result.length > 0) {
        await applyBonusCredits(session.user.id, bonusAmount, tx)
        attributed = true
      }
    })

    if (attributed) {
      logger.info('Referral attribution created and bonus credits applied', {
        userId: session.user.id,
        campaignId: matchedCampaign?.id,
        campaignName: matchedCampaign?.name,
        utmSource: utmData.utm_source,
        utmCampaign: utmData.utm_campaign,
        utmContent: utmData.utm_content,
        bonusAmount,
      })
    } else {
      logger.info('User already attributed, skipping', { userId: session.user.id })
    }

    cookieStore.delete(COOKIE_NAME)

    return NextResponse.json({
      attributed,
      bonusAmount: attributed ? bonusAmount : undefined,
    })
  } catch (error) {
    logger.error('Attribution error', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
