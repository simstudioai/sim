import { NextRequest, NextResponse } from 'next/server'
import { isProPlan, isTeamPlan } from '@/lib/subscription'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('UserSubscriptionAPI')

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const session = await getSession()
    
    if (!session?.user?.id) {
      logger.warn('Unauthorized subscription access attempt')
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Check if the user is on the Pro plan
    const isPro = await isProPlan(session.user.id)
    
    // Check if the user is on the Team plan
    const isTeam = await isTeamPlan(session.user.id)
    
    return NextResponse.json({ isPro, isTeam })
  } catch (error) {
    logger.error('Error checking subscription status:', error)
    return NextResponse.json(
      { error: 'Failed to check subscription status' },
      { status: 500 }
    )
  }
} 