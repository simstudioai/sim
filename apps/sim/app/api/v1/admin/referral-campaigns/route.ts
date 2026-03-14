/**
 * GET  /api/v1/admin/referral-campaigns
 *
 * List Stripe promotion codes with cursor-based pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 100)
 *   - starting_after: string (cursor — Stripe promotion code ID)
 *   - active: 'true' | 'false' (optional filter)
 *
 * POST /api/v1/admin/referral-campaigns
 *
 * Create a Stripe coupon and an associated promotion code.
 *
 * Body:
 *   - name: string (required) — Display name for the coupon
 *   - percentOff: number (required, 1–100) — Percentage discount
 *   - code: string | null (optional, min 6 chars, auto-uppercased) — Desired code
 *   - duration: 'once' | 'repeating' | 'forever' (default: 'once')
 *   - durationInMonths: number (required when duration is 'repeating')
 *   - maxRedemptions: number (optional) — Total redemption cap
 *   - expiresAt: ISO 8601 string (optional) — Promotion code expiry
 */

import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminPromoCodes')

const VALID_DURATIONS = ['once', 'repeating', 'forever'] as const
type Duration = (typeof VALID_DURATIONS)[number]

interface PromoCodeResponse {
  id: string
  code: string
  couponId: string
  name: string
  percentOff: number
  duration: string
  durationInMonths: number | null
  maxRedemptions: number | null
  expiresAt: string | null
  active: boolean
  timesRedeemed: number
  createdAt: string
}

function formatPromoCode(promo: {
  id: string
  code: string
  coupon: {
    id: string
    name: string | null
    percent_off: number | null
    duration: string
    duration_in_months: number | null
  }
  max_redemptions: number | null
  expires_at: number | null
  active: boolean
  times_redeemed: number
  created: number
}): PromoCodeResponse {
  return {
    id: promo.id,
    code: promo.code,
    couponId: promo.coupon.id,
    name: promo.coupon.name ?? '',
    percentOff: promo.coupon.percent_off ?? 0,
    duration: promo.coupon.duration,
    durationInMonths: promo.coupon.duration_in_months,
    maxRedemptions: promo.max_redemptions,
    expiresAt: promo.expires_at ? new Date(promo.expires_at * 1000).toISOString() : null,
    active: promo.active,
    timesRedeemed: promo.times_redeemed,
    createdAt: new Date(promo.created * 1000).toISOString(),
  }
}

export const GET = withAdminAuth(async (request) => {
  try {
    const stripe = requireStripeClient()
    const url = new URL(request.url)

    const limitParam = url.searchParams.get('limit')
    let limit = limitParam ? Number.parseInt(limitParam, 10) : 50
    if (Number.isNaN(limit) || limit < 1) limit = 50
    if (limit > 100) limit = 100

    const startingAfter = url.searchParams.get('starting_after') || undefined
    const activeFilter = url.searchParams.get('active')

    const listParams: Record<string, unknown> = { limit }
    if (startingAfter) listParams.starting_after = startingAfter
    if (activeFilter === 'true') listParams.active = true
    else if (activeFilter === 'false') listParams.active = false

    const promoCodes = await stripe.promotionCodes.list(listParams)

    const data = promoCodes.data.map(formatPromoCode)

    logger.info(`Admin API: Listed ${data.length} Stripe promotion codes`)

    return NextResponse.json({
      data,
      hasMore: promoCodes.has_more,
      ...(data.length > 0 ? { nextCursor: data[data.length - 1].id } : {}),
    })
  } catch (error) {
    logger.error('Admin API: Failed to list promotion codes', { error })
    return internalErrorResponse('Failed to list promotion codes')
  }
})

export const POST = withAdminAuth(async (request) => {
  try {
    const stripe = requireStripeClient()
    const body = await request.json()

    const { name, percentOff, code, duration, durationInMonths, maxRedemptions, expiresAt } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return badRequestResponse('name is required and must be a non-empty string')
    }

    if (
      typeof percentOff !== 'number' ||
      !Number.isFinite(percentOff) ||
      percentOff < 1 ||
      percentOff > 100
    ) {
      return badRequestResponse('percentOff must be a number between 1 and 100')
    }

    const effectiveDuration: Duration = duration ?? 'once'
    if (!VALID_DURATIONS.includes(effectiveDuration)) {
      return badRequestResponse(`duration must be one of: ${VALID_DURATIONS.join(', ')}`)
    }

    if (effectiveDuration === 'repeating') {
      if (
        typeof durationInMonths !== 'number' ||
        !Number.isInteger(durationInMonths) ||
        durationInMonths < 1
      ) {
        return badRequestResponse(
          'durationInMonths is required and must be a positive integer when duration is "repeating"'
        )
      }
    }

    if (code !== undefined && code !== null) {
      if (typeof code !== 'string') {
        return badRequestResponse('code must be a string or null')
      }
      if (code.trim().length < 6) {
        return badRequestResponse('code must be at least 6 characters')
      }
    }

    if (maxRedemptions !== undefined && maxRedemptions !== null) {
      if (
        typeof maxRedemptions !== 'number' ||
        !Number.isInteger(maxRedemptions) ||
        maxRedemptions < 1
      ) {
        return badRequestResponse('maxRedemptions must be a positive integer')
      }
    }

    if (expiresAt !== undefined && expiresAt !== null) {
      const parsed = new Date(expiresAt)
      if (Number.isNaN(parsed.getTime())) {
        return badRequestResponse('expiresAt must be a valid ISO 8601 date string')
      }
      if (parsed.getTime() <= Date.now()) {
        return badRequestResponse('expiresAt must be in the future')
      }
    }

    const coupon = await stripe.coupons.create({
      name: name.trim(),
      percent_off: percentOff,
      duration: effectiveDuration,
      ...(effectiveDuration === 'repeating' ? { duration_in_months: durationInMonths } : {}),
    })

    let promoCode
    try {
      const promoParams: Stripe.PromotionCodeCreateParams = {
        coupon: coupon.id,
        ...(code ? { code: code.trim().toUpperCase() } : {}),
        ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
        ...(expiresAt ? { expires_at: Math.floor(new Date(expiresAt).getTime() / 1000) } : {}),
      }

      promoCode = await stripe.promotionCodes.create(promoParams)
    } catch (promoError) {
      try {
        await stripe.coupons.del(coupon.id)
      } catch (cleanupError) {
        logger.error(
          'Admin API: Failed to clean up orphaned coupon after promo code creation failed',
          {
            couponId: coupon.id,
            cleanupError,
          }
        )
      }
      throw promoError
    }

    logger.info('Admin API: Created Stripe promotion code', {
      promoCodeId: promoCode.id,
      code: promoCode.code,
      couponId: coupon.id,
      percentOff,
      duration: effectiveDuration,
    })

    return singleResponse(formatPromoCode(promoCode))
  } catch (error) {
    if (
      error instanceof Error &&
      'type' in error &&
      (error as { type: string }).type === 'StripeInvalidRequestError'
    ) {
      logger.warn('Admin API: Stripe rejected promotion code request', { error: error.message })
      return badRequestResponse(error.message)
    }
    logger.error('Admin API: Failed to create promotion code', { error })
    return internalErrorResponse('Failed to create promotion code')
  }
})
