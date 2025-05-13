import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/db'
import { subscription, user } from '@/db/schema'
import { isAuthorized } from '../utils'

// Define proper result type for subscriptions
interface SubscriptionRecord {
  id: string
  userId: string
  plan: string
  status: string | null
  seats: number | null
  periodStart: Date | null
  periodEnd: Date | null
  cancelAtPeriodEnd: boolean | null
}

export async function GET(req: NextRequest) {
  try {
    // Admin authentication check
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameters
    const url = new URL(req.url)
    const userIds = url.searchParams.get('userIds')?.split(',')
    const plan = url.searchParams.get('plan')
    const status = url.searchParams.get('status')
    const includeIncomplete = url.searchParams.get('includeIncomplete') === 'true'
    const statsOnly = url.searchParams.get('stats') === 'true'

    // If requesting stats only, return aggregated stats
    if (statsOnly) {
      const statsQuery = db
        .select({
          plan: subscription.plan,
          status: subscription.status,
          seats: sql`SUM(${subscription.seats})`,
          count: sql`COUNT(*)`,
        })
        .from(subscription)
        .groupBy(subscription.plan, subscription.status)

      const statsResults = await statsQuery

      // Calculate stats for enterprise plans
      const enterpriseStats = statsResults.filter(
        (s) => s.plan === 'enterprise' && s.status === 'active'
      )

      // Sum up the stats
      const activePlans = enterpriseStats.reduce((sum, stat) => sum + Number(stat.count || 0), 0)
      const totalSeats = enterpriseStats.reduce((sum, stat) => sum + Number(stat.seats || 0), 0)

      // Also calculate stats for team and pro plans
      const teamStats = statsResults.filter((s) => s.plan === 'team' && s.status === 'active')
      const teamActivePlans = teamStats.reduce((sum, stat) => sum + Number(stat.count || 0), 0)
      const teamTotalSeats = teamStats.reduce((sum, stat) => sum + Number(stat.seats || 0), 0)

      const proStats = statsResults.filter((s) => s.plan === 'pro' && s.status === 'active')
      const proActivePlans = proStats.reduce((sum, stat) => sum + Number(stat.count || 0), 0)

      return NextResponse.json({
        success: true,
        stats: {
          enterprise: {
            activePlans,
            totalSeats,
          },
          team: {
            activePlans: teamActivePlans,
            totalSeats: teamTotalSeats,
          },
          pro: {
            activePlans: proActivePlans,
          },
          all: {
            activePlans: activePlans + teamActivePlans + proActivePlans,
            totalSeats: totalSeats + teamTotalSeats,
          },
        },
      })
    }

    // If userIds are provided, fetch subscriptions by userIds (replaces batch endpoint)
    if (userIds && userIds.length > 0) {
      // Use the query builder instead of raw SQL for better type safety
      const subscriptions = await db
        .select({
          id: subscription.id,
          userId: subscription.referenceId,
          plan: subscription.plan,
          status: subscription.status,
          seats: subscription.seats,
          periodStart: subscription.periodStart,
          periodEnd: subscription.periodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        })
        .from(subscription)
        .where(sql`${subscription.referenceId} IN (${sql.join(userIds, sql`, `)})`)

      // Organize by user ID for easy lookup (same format as batch endpoint)
      const subscriptionsByUserId: Record<string, any> = {}

      for (const sub of subscriptions) {
        subscriptionsByUserId[sub.userId] = {
          id: sub.id,
          plan: sub.plan,
          status: sub.status,
          seats: sub.seats,
          periodStart: sub.periodStart,
          periodEnd: sub.periodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      }

      return NextResponse.json({
        success: true,
        data: subscriptionsByUserId,
      })
    }

    // Otherwise, get all subscriptions, with optional filters
    // Build conditions array
    const conditions = []

    // By default, exclude "free" plans - they're users without subscriptions
    if (plan) {
      conditions.push(eq(subscription.plan, plan))
    } else {
      // If no specific plan is requested, exclude free plans
      conditions.push(ne(subscription.plan, 'free'))
    }

    if (status) {
      conditions.push(eq(subscription.status, status))
    }

    // By default, exclude incomplete subscriptions (those without a status)
    // unless explicitly asked to include them
    if (!includeIncomplete) {
      // Only include subscriptions with a status that isn't 'incomplete'
      conditions.push(
        sql`(${subscription.status} IS NOT NULL AND ${subscription.status} != 'incomplete')`
      )
    }

    // First, fetch all matching subscriptions
    const query = db
      .select({
        id: subscription.id,
        plan: subscription.plan,
        referenceId: subscription.referenceId,
        status: subscription.status,
        seats: subscription.seats,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        stripeCustomerId: subscription.stripeCustomerId,
      })
      .from(subscription)

    // Apply where clause if conditions exist
    const subscriptions =
      conditions.length > 0 ? await query.where(and(...conditions)) : await query

    // Now fetch user information for the subscription reference IDs
    const subUserIds = subscriptions.map((sub) => sub.referenceId)
    const subStripeIds = subscriptions
      .filter((sub) => sub.stripeCustomerId)
      .map((sub) => sub.stripeCustomerId as string)

    // Get user data from both IDs
    let users: any[] = []
    if (subUserIds.length > 0) {
      // Get users that match reference IDs
      const usersByRefId = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          stripeCustomerId: user.stripeCustomerId,
        })
        .from(user)
        .where(sql`${user.id} IN (${sql.join(subUserIds, sql`, `)})`)

      users = [...usersByRefId]
    }

    if (subStripeIds.length > 0) {
      // Get users that match Stripe customer IDs
      const usersByStripe = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          stripeCustomerId: user.stripeCustomerId,
        })
        .from(user)
        .where(sql`${user.stripeCustomerId} IN (${sql.join(subStripeIds, sql`, `)})`)

      users = [...users, ...usersByStripe]
    }

    // Create maps for quick lookup
    const usersByRefId = new Map(users.map((u) => [u.id, u]))
    const usersByStripeId = new Map(
      users.filter((u) => u.stripeCustomerId).map((u) => [u.stripeCustomerId, u])
    )

    // Enrich subscription data with user information
    const enrichedSubscriptions = subscriptions.map((sub) => {
      // First try to find user by referenceId
      let userData = usersByRefId.get(sub.referenceId)

      // If not found and we have a stripeCustomerId, try that
      if (!userData && sub.stripeCustomerId) {
        userData = usersByStripeId.get(sub.stripeCustomerId)
      }

      return {
        ...sub,
        userName: userData?.name || null,
        userEmail: userData?.email || null,
      }
    })

    return NextResponse.json({
      success: true,
      data: enrichedSubscriptions,
    })
  } catch (error) {
    console.error('Error fetching subscription data:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'An unknown error occurred',
      },
      { status: 500 }
    )
  }
}

// Create or update enterprise subscription
export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }

    const {
      referenceId,
      seats = 100, // Default to generous seat count
      perSeatAllowance = 200, // Default per-seat allowance
      totalAllowance = seats * perSeatAllowance, // Calculate if not provided
      plan = 'enterprise', // Default to enterprise plan
      notes = '',
    } = await req.json()

    if (!referenceId) {
      return NextResponse.json(
        {
          success: false,
          message: 'Reference ID is required',
        },
        { status: 400 }
      )
    }

    // For enterprise subscriptions, set the period end to far in the future
    // Enterprise subscriptions don't expire unless canceled manually
    const periodStart = new Date()
    const periodEnd = new Date()
    periodEnd.setFullYear(periodEnd.getFullYear() + 100) // Set to 100 years in the future

    // Check if subscription already exists
    const existing = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, referenceId), eq(subscription.plan, plan)))
      .limit(1)

    // Store allowance data in the new metadata field
    const metadata = {
      perSeatAllowance,
      totalAllowance,
      updatedAt: new Date().toISOString(),
    }

    if (existing.length > 0) {
      // Update existing subscription
      await db
        .update(subscription)
        .set({
          seats,
          periodEnd,
          status: 'active',
          metadata,
        })
        .where(eq(subscription.id, existing[0].id))

      // Log the update for debugging
      console.log(
        `Enterprise subscription updated with per-seat allowance: $${perSeatAllowance}, total: $${totalAllowance}`
      )

      return NextResponse.json({
        success: true,
        message: 'Subscription updated',
        data: {
          subscriptionId: existing[0].id,
          perSeatAllowance,
          totalAllowance,
        },
      })
    }

    // Create new subscription
    const newSubscriptionId = uuidv4()
    await db.insert(subscription).values({
      id: newSubscriptionId,
      plan,
      referenceId,
      status: 'active',
      seats,
      periodStart,
      periodEnd,
      metadata,
    })

    // Log the creation for debugging
    console.log(
      `Enterprise subscription created with per-seat allowance: $${perSeatAllowance}, total: $${totalAllowance}`
    )

    return NextResponse.json({
      success: true,
      message: 'Subscription created',
      data: {
        subscriptionId: newSubscriptionId,
        perSeatAllowance,
        totalAllowance,
      },
    })
  } catch (error) {
    console.error('Error managing subscription:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'An unknown error occurred',
      },
      { status: 500 }
    )
  }
}
