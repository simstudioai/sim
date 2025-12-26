import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getCreditBalance } from '@/lib/billing/credits/balance'
import { purchaseCredits } from '@/lib/billing/credits/purchase'

const logger = createLogger('CreditsAPI')

const PurchaseSchema = z.object({
  amount: z.number().min(10).max(1000),
  requestId: z.string().uuid(),
})

export async function GET() {
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
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = PurchaseSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid amount. Must be between $10 and $1000' },
        { status: 400 }
      )
    }

    const result = await purchaseCredits({
      userId: session.user.id,
      amountDollars: validation.data.amount,
      requestId: validation.data.requestId,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to purchase credits', { error, userId: session.user.id })
    return NextResponse.json({ error: 'Failed to purchase credits' }, { status: 500 })
  }
}
