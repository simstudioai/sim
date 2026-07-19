import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { LagoWebhookEnvelope } from '@/lib/billing/lago/types'
import { handleLagoWebhook, verifyLagoWebhookSignature } from '@/lib/billing/lago/webhooks'
import { isLagoBillingProvider } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('LagoWebhookAPI')

/**
 * Lago webhook health check (Lago UI and load balancers probe with GET).
 */
export const GET = withRouteHandler(async () => {
  if (!isLagoBillingProvider) {
    return NextResponse.json({ error: 'Lago billing is not enabled' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, provider: 'lago' })
})

/**
 * Receives Lago billing webhooks and syncs subscription state into Sim.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  if (!isLagoBillingProvider) {
    return NextResponse.json({ error: 'Lago billing is not enabled' }, { status: 404 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-lago-signature')

  if (!verifyLagoWebhookSignature(rawBody, signature)) {
    logger.warn('Rejected Lago webhook with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: LagoWebhookEnvelope
  // boundary-raw-json: Lago webhook signature verification requires raw body before parsing
  try {
    payload = JSON.parse(rawBody) as LagoWebhookEnvelope
  } catch (error) {
    logger.error('Failed to parse Lago webhook payload', { error: getErrorMessage(error) })
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    await handleLagoWebhook(payload)
    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error('Failed to process Lago webhook', {
      webhookType: payload.webhook_type,
      error: getErrorMessage(error),
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
})
