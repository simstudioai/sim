import { eq } from 'drizzle-orm'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { client } from './auth-client'
import { createLogger } from './logs/console-logger'
import { isProd } from '@/lib/environment'

const logger = createLogger('Subscription')

/**
 * Check if the user is on the Pro plan
 */
export async function isProPlan(userId: string): Promise<boolean> {
  try {
    // In development, enable Pro features for easier testing
    if (!isProd) {
      return true
    }
    
    const dbSubscriptions = await db.select()
      .from(schema.subscription)
      .where(eq(schema.subscription.referenceId, userId))
    
    // Find active pro subscription
    const activeSubscription = dbSubscriptions.find(
      sub => (sub.status === 'active') && sub.plan === 'pro'
    )
    
    return !!activeSubscription
  } catch (error) {
    logger.error('Error checking pro plan status', { error, userId })
    return false
  }
}

/**
 * Check if a user has exceeded their cost limit based on their subscription plan
 */
export async function hasExceededCostLimit(userId: string): Promise<boolean> {
  try {
    // In development, users never exceed their limit
    if (!isProd) {
      return false
    }
    
    // Get user's subscription
    const { data: subscriptions } = await client.subscription.list({
      query: { referenceId: userId }
    })
    
    // Find active subscription
    const activeSubscription = subscriptions?.find(
      sub => sub.status === 'active'
    )
    
    // Get configured limits from environment variables or subscription
    let costLimit: number
    
    if (activeSubscription && typeof activeSubscription.limits?.cost === 'number') {
      // Use the limit from the subscription
      costLimit = activeSubscription.limits.cost
    } else {
      // Use default free tier limit
      costLimit = process.env.FREE_TIER_COST_LIMIT 
        ? parseFloat(process.env.FREE_TIER_COST_LIMIT) 
        : 5
    }
    
    logger.info('User cost limit from subscription', { userId, costLimit })
    
    // Get user's actual usage from the database
    const statsRecords = await db.select().from(schema.userStats).where(eq(schema.userStats.userId, userId))
    
    if (statsRecords.length === 0) {
      // No usage yet, so they haven't exceeded the limit
      return false
    }
    
    // Get the current cost and compare with the limit
    const currentCost = parseFloat(statsRecords[0].totalCost.toString())
    
    return currentCost >= costLimit
  } catch (error) {
    logger.error('Error checking cost limit', { error, userId })
    return false // Be conservative in case of error
  }
}

/**
 * Check if a user is allowed to share workflows based on their subscription plan
 */
export async function canShareWorkflows(userId: string): Promise<boolean> {
  try {
    // In development, always allow sharing
    if (!isProd) {
      return true
    }
    
    const { data: subscriptions } = await client.subscription.list({
      query: { referenceId: userId }
    })
    
    const activeSubscription = subscriptions?.find(
      sub => sub.status === 'active'
    )
    
    // If no active subscription or subscription is free tier, sharing is not allowed
    if (!activeSubscription || activeSubscription.plan === 'free') {
      return false
    }
    
    // Check if the plan's limits include sharing
    return !!activeSubscription.limits?.sharingEnabled
  } catch (error) {
    logger.error('Error checking sharing permission', { error, userId })
    return false // Be conservative in case of error
  }
} 