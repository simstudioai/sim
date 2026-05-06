import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { purchaseCreditsContract } from '@/lib/api/contracts/subscription'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getCreditBalance } from '@/lib/billing/credits/balance'
import { purchaseCredits } from '@/lib/billing/credits/purchase'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CreditsAPI')

export const GET = withRouteHandler(async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { balance, entityType, entityId } = await getCreditBalance(session.user.id)
    return NextResponse.json({
      success: true,
      data: { balance, entityType, entityId },
    })
  } catch (error) {
    logger.error('Failed to get credit balance', { error, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to get credit balance' }, { status: 500 })
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(
      purchaseCreditsContract,
      request,
      {},
      {
        validationErrorResponse: () =>
          NextResponse.json(
            { error: 'Invalid amount. Must be between $10 and $1000' },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const result = await purchaseCredits({
      userId: session.user.id,
      amountDollars: parsed.data.body.amount,
      requestId: parsed.data.body.requestId,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    recordAudit({
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.CREDIT_PURCHASED,
      resourceType: AuditResourceType.BILLING,
      resourceId: parsed.data.body.requestId,
      description: `Purchased $${parsed.data.body.amount} in credits`,
      metadata: {
        amountDollars: parsed.data.body.amount,
        requestId: parsed.data.body.requestId,
      },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to purchase credits', { error, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to purchase credits' }, { status: 500 })
  }
})
