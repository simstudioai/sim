import { NextResponse } from 'next/server'
import { and, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkEnterprisePlan } from '@/lib/subscription/utils'
import { db } from '@/db'
import { member, subscription } from '@/db/schema'

const logger = createLogger('UpdateSubscriptionSeatsAPI')

const updateSeatsSchema = z.object({
  subscriptionId: z.string().uuid(),
  seats: z.number().int().positive(),
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

export async function POST(req: Request) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const rawBody = await req.json()
    const validationResult = updateSeatsSchema.safeParse(rawBody)

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request parameters',
          details: validationResult.error.format(),
        },
        { status: 400 }
      )
    }

    const { subscriptionId, seats } = validationResult.data

    const subscriptions = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .limit(1)

    if (subscriptions.length === 0) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    const sub = subscriptions[0]

    if (!checkEnterprisePlan(sub)) {
      return NextResponse.json(
        {
          error: 'Only enterprise subscriptions can be updated through this endpoint',
        },
        { status: 400 }
      )
    }

    let hasPermission = sub.referenceId === session.user.id

    if (!hasPermission) {
      const memberships = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(member.organizationId, sub.referenceId),
            or(eq(member.role, 'owner'), eq(member.role, 'admin'))
          )
        )
        .limit(1)

      hasPermission = memberships.length > 0

      if (!hasPermission) {
        logger.warn('Unauthorized subscription update attempt', {
          userId: session.user.id,
          subscriptionId,
          referenceId: sub.referenceId,
        })

        return NextResponse.json(
          { error: 'You must be an admin or owner to update subscription settings' },
          { status: 403 }
        )
      }
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

    logger.info('Updated subscription seats', {
      subscriptionId,
      previousSeats: sub.seats,
      newSeats: seats,
      userId: session.user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Subscription seats updated',
      data: {
        subscriptionId,
        seats,
        plan: sub.plan,
        metadata: validatedMetadata,
      },
    })
  } catch (error) {
    logger.error('Error updating subscription seats:', error)
    return NextResponse.json(
      {
        error: 'Failed to update subscription seats',
      },
      { status: 500 }
    )
  }
}
