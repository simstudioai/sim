import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
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

interface SubscriptionMetadata {
  perSeatAllowance?: number
  totalAllowance?: number
  updatedAt?: string
  [key: string]: any
}

export async function POST(req: Request) {
  try {
    // Get current authenticated user
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

    // Query for the subscription
    const subscriptions = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .limit(1)

    if (subscriptions.length === 0) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    const sub = subscriptions[0]

    // Verify this is an enterprise subscription
    if (!checkEnterprisePlan(sub)) {
      return NextResponse.json(
        {
          error: 'Only enterprise subscriptions can be updated through this endpoint',
        },
        { status: 400 }
      )
    }

    // Verify the user has permission to update this subscription
    // Either they own it directly or are a member of the organization
    let hasPermission = sub.referenceId === session.user.id

    if (!hasPermission) {
      // Check if user is member of organization that owns this subscription
      const memberships = await db
        .select()
        .from(member)
        .where(and(eq(member.userId, session.user.id), eq(member.organizationId, sub.referenceId)))
        .limit(1)

      hasPermission = memberships.length > 0
    }

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'You do not have permission to update this subscription' },
        { status: 403 }
      )
    }

    // Update the subscription with new seat count
    // For enterprise subscriptions, we need to recalculate the total allowance if it exists
    const metadata = (sub.metadata || {}) as SubscriptionMetadata

    if (metadata.perSeatAllowance) {
      metadata.totalAllowance = seats * metadata.perSeatAllowance
      metadata.updatedAt = new Date().toISOString()
    }

    await db
      .update(subscription)
      .set({
        seats,
        metadata,
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
        metadata,
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
