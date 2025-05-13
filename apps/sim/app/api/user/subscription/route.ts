import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { subscription } from '@/db/schema'

export async function GET() {
  try {
    // Get current authenticated user
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Query the subscription for this user
    const subscriptions = await db
      .select({
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
      })
      .from(subscription)
      .where(and(eq(subscription.referenceId, session.user.id), eq(subscription.status, 'active')))
      .limit(1)

    const activeSub = subscriptions[0]

    const isPaid =
      activeSub &&
      activeSub.status === 'active' &&
      (activeSub.plan === 'pro' || activeSub.plan === 'team')

    return NextResponse.json({
      isPaid,
      plan: activeSub?.plan || 'free',
      status: activeSub?.status || null,
    })
  } catch (error) {
    console.error('Error fetching subscription:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription data' }, { status: 500 })
  }
}
