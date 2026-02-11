/**
 * POST /api/attribution
 *
 * Automatic UTM-based referral attribution for new signups.
 *
 * Reads the `sim_utm` cookie (set by proxy on auth pages), verifies the user
 * account was created after the cookie was set, matches a campaign by UTM
 * specificity, and atomically inserts an attribution record + applies bonus credits.
 *
 * Idempotent — the unique constraint on `userId` prevents double-attribution.
 */

import { db } from '@sim/db'
import { DEFAULT_REFERRAL_BONUS_CREDITS } from '@sim/db/constants'
import { referralAttribution, referralCampaigns, user, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { applyBonusCredits } from '@/lib/billing/credits/bonus'

const logger = createLogger('AttributionAPI')

const COOKIE_NAME = 'sim_utm'
const CLOCK_DRIFT_TOLERANCE_MS = 60 * 1000

const UtmCookieSchema = z.object({
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  referrer_url: z.string().optional(),
  landing_page: z.string().optional(),
  created_at: z.string().min(1),
})

/**
 * Finds the most specific active campaign matching the given UTM params.
 * Null fields on a campaign act as wildcards. Ties broken by newest campaign.
 */
async function findMatchingCampaign(utmData: z.infer<typeof UtmCookieSchema>) {
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

    let utmData: z.infer<typeof UtmCookieSchema>
    try {
      let decoded: string
      try {
        decoded = decodeURIComponent(utmCookie.value)
      } catch {
        decoded = utmCookie.value
      }
      utmData = UtmCookieSchema.parse(JSON.parse(decoded))
    } catch {
      logger.warn('Failed to parse UTM cookie', { userId: session.user.id })
      cookieStore.delete(COOKIE_NAME)
      return NextResponse.json({ attributed: false, reason: 'invalid_cookie' })
    }

    const cookieCreatedAt = Number(utmData.created_at)
    if (!Number.isFinite(cookieCreatedAt)) {
      logger.warn('UTM cookie has invalid created_at timestamp', { userId: session.user.id })
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

    const matchedCampaign = await findMatchingCampaign(utmData)
    const bonusAmount = matchedCampaign
      ? Number(matchedCampaign.bonusCreditAmount)
      : DEFAULT_REFERRAL_BONUS_CREDITS

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
