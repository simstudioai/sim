import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkEnterprisePlan } from '@/lib/subscription/utils'
import { db } from '@/db'
import { member, subscription } from '@/db/schema'

const logger = createLogger('SubscriptionSeatsUpdateAPI')

const updateSeatsSchema = z.object({
  seats: z.number().int().min(1),
})

const subscriptionMetadataSchema = z
  .object({
    perSeatAllowance: z.number().positive().optional(),
    totalAllowance: z.number().positive().optional(),
    updatedAt: z.string().optional(),
  })
  .catchall(z.any())

interface SubscriptionMetadata {
  perSeatAllowance?: number
  totalAllowance?: number
  updatedAt?: string
  [key: string]: any
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const subscriptionId = (await params).id
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn('Unauthorized seats update attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body
    try {
      body = await request.json()
    } catch (parseError) {
      return NextResponse.json(
        {
          error: 'Invalid JSON in request body',
        },
        { status: 400 }
      )
    }

    const validationResult = updateSeatsSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request parameters',
          details: validationResult.error.format(),
        },
        { status: 400 }
      )
    }

    const { seats } = validationResult.data

    const sub = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .then((rows) => rows[0])

    if (!sub) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    if (!checkEnterprisePlan(sub)) {
      return NextResponse.json(
        { error: 'Only enterprise subscriptions can be updated through this endpoint' },
        { status: 400 }
      )
    }

    const isPersonalSubscription = sub.referenceId === session.user.id

    let hasAccess = isPersonalSubscription

    if (!isPersonalSubscription) {
      const mem = await db
        .select()
        .from(member)
        .where(and(eq(member.userId, session.user.id), eq(member.organizationId, sub.referenceId)))
        .then((rows) => rows[0])

      hasAccess = mem && (mem.role === 'owner' || mem.role === 'admin')
    }

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Unauthorized - you do not have permission to modify this subscription' },
        { status: 403 }
      )
    }

    let validatedMetadata: SubscriptionMetadata
    try {
      validatedMetadata = subscriptionMetadataSchema.parse(sub.metadata || {})
    } catch (error) {
      logger.error('Invalid subscription metadata format', {
        error,
        subscriptionId,
        metadata: sub.metadata,
      })
      return NextResponse.json(
        { error: 'Subscription metadata has invalid format' },
        { status: 400 }
      )
    }

    if (validatedMetadata.perSeatAllowance && validatedMetadata.perSeatAllowance > 0) {
      validatedMetadata.totalAllowance = seats * validatedMetadata.perSeatAllowance
      validatedMetadata.updatedAt = new Date().toISOString()
    }

    await db
      .update(subscription)
      .set({
        seats,
        metadata: validatedMetadata,
      })
      .where(eq(subscription.id, subscriptionId))

    logger.info('Subscription seats updated', {
      subscriptionId,
      oldSeats: sub.seats,
      newSeats: seats,
      userId: session.user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Subscription seats updated successfully',
      seats,
      metadata: validatedMetadata,
    })
  } catch (error) {
    logger.error('Error updating subscription seats', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to update subscription seats' }, { status: 500 })
  }
}
