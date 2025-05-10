import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import * as schema from '@/db/schema'

const logger = createLogger('TransferSubscriptionAPI')

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn('Unauthorized subscription transfer attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse the request body
    const body = await request.json()
    const { subscriptionId, organizationId } = body

    if (!subscriptionId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing required fields: subscriptionId and organizationId' },
        { status: 400 }
      )
    }

    logger.info('Transferring subscription to organization', {
      userId: session.user.id,
      subscriptionId,
      organizationId,
    })

    // Verify the user has access to both the subscription and organization
    const subscription = await db
      .select()
      .from(schema.subscription)
      .where(eq(schema.subscription.id, subscriptionId))
      .then((rows) => rows[0])

    if (!subscription) {
      logger.warn('Subscription not found', { subscriptionId })
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    // Verify the subscription belongs to the user
    if (subscription.referenceId !== session.user.id) {
      logger.warn('Unauthorized subscription transfer - subscription does not belong to user', {
        userId: session.user.id,
        subscriptionReferenceId: subscription.referenceId,
      })
      return NextResponse.json(
        { error: 'Unauthorized - subscription does not belong to user' },
        { status: 403 }
      )
    }

    // Verify the organization exists
    const organization = await db
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .then((rows) => rows[0])

    if (!organization) {
      logger.warn('Organization not found', { organizationId })
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Verify the user has admin access to the organization (is owner or admin)
    const member = await db
      .select()
      .from(schema.member)
      .where(
        eq(schema.member.userId, session.user.id) &&
          eq(schema.member.organizationId, organizationId)
      )
      .then((rows) => rows[0])

    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      logger.warn('Unauthorized subscription transfer - user is not admin of organization', {
        userId: session.user.id,
        organizationId,
        memberRole: member?.role,
      })
      return NextResponse.json(
        { error: 'Unauthorized - user is not admin of organization' },
        { status: 403 }
      )
    }

    // Update the subscription to point to the organization instead of the user
    await db
      .update(schema.subscription)
      .set({ referenceId: organizationId })
      .where(eq(schema.subscription.id, subscriptionId))

    logger.info('Successfully transferred subscription to organization', {
      subscriptionId,
      organizationId,
      userId: session.user.id,
    })

    return NextResponse.json({
      success: true,
      message: 'Subscription transferred successfully',
    })
  } catch (error) {
    logger.error('Error transferring subscription', { error })
    return NextResponse.json({ error: 'Failed to transfer subscription' }, { status: 500 })
  }
}
