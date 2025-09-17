import { db } from '@sim/db'
import { member, organization, subscription } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SubscriptionTransferAPI')

const transferSubscriptionSchema = z.object({
  organizationId: z.string().min(1),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const subscriptionId = (await params).id
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn('Unauthorized subscription transfer attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body
    try {
      body = await request.json()
    } catch (_parseError) {
      return NextResponse.json(
        {
          error: 'Invalid JSON in request body',
        },
        { status: 400 }
      )
    }

    const validationResult = transferSubscriptionSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request parameters',
          details: validationResult.error.format(),
        },
        { status: 400 }
      )
    }

    const { organizationId } = validationResult.data
    logger.info('Processing subscription transfer', { subscriptionId, organizationId })

    const sub = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .then((rows) => rows[0])

    if (!sub) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    if (sub.referenceId !== session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - subscription does not belong to user' },
        { status: 403 }
      )
    }

    const org = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .then((rows) => rows[0])

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const mem = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
      .then((rows) => rows[0])

    const isPersonalTransfer = sub.referenceId === session.user.id

    if (!isPersonalTransfer && (!mem || (mem.role !== 'owner' && mem.role !== 'admin'))) {
      return NextResponse.json(
        { error: 'Unauthorized - user is not admin of organization' },
        { status: 403 }
      )
    }

    await db
      .update(subscription)
      .set({ referenceId: organizationId })
      .where(eq(subscription.id, subscriptionId))

    logger.info('Subscription transfer completed', {
      subscriptionId,
      organizationId,
      userId: session.user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Subscription transferred successfully',
    })
  } catch (error) {
    logger.error('Error transferring subscription', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to transfer subscription' }, { status: 500 })
  }
}
