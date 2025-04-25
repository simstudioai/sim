import { isProPlan } from './subscription'
import { createLogger } from './logs/console-logger'
import { db } from '@/db'
import { eq } from 'drizzle-orm'
import { userStats } from '@/db/schema'
import { client } from './auth-client'
import { isProd } from '@/lib/environment'

const logger = createLogger('UsageMonitor')

// Percentage threshold for showing warning
const WARNING_THRESHOLD = 80

interface UsageData {
  percentUsed: number
  isWarning: boolean
  isExceeded: boolean
  currentUsage: number
  limit: number
}

/**
 * Checks a user's cost usage against their subscription plan limit
 * and returns usage information including whether they're approaching the limit
 */
export async function checkUsageStatus(userId: string): Promise<UsageData> {
  try {
    // In development, always return permissive limits
    if (!isProd) {
      // Get actual usage from the database for display purposes
      const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))
      const currentUsage = statsRecords.length > 0 
        ? parseFloat(statsRecords[0].totalCost.toString())
        : 0
      
      // In development, set a very high limit to avoid restrictions
      const devLimit = 1000
      
      return {
        percentUsed: Math.min(Math.round((currentUsage / devLimit) * 100), 100),
        isWarning: false,
        isExceeded: false,
        currentUsage,
        limit: devLimit
      }
    }
    
    // Production environment - check real subscription limits
    
    // Get user's subscription details
    const isPro = await isProPlan(userId)
    
    // Get the subscription limits
    const { data: subscriptions } = await client.subscription.list({
      query: { referenceId: userId }
    })
    
    // Find active subscription
    const activeSubscription = subscriptions?.find(
      sub => sub.status === 'active' || sub.status === 'trialing'
    )
    
    // Get configured limits from environment variables or subscription
    let limit: number
    
    if (activeSubscription && typeof activeSubscription.limits?.cost === 'number') {
      // Use the limit from the subscription if available
      limit = activeSubscription.limits.cost
    } else {
      // Fallback to environment variables
      const freeLimit = process.env.FREE_TIER_COST_LIMIT 
        ? parseFloat(process.env.FREE_TIER_COST_LIMIT) 
        : 5
      
      const proLimit = process.env.PRO_TIER_COST_LIMIT 
        ? parseFloat(process.env.PRO_TIER_COST_LIMIT) 
        : 50
      
      // Set the appropriate limit based on subscription
      limit = isPro ? proLimit : freeLimit
    }
    
    // Get actual usage from the database
    const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))
    
    // If no stats record exists, create a default one
    if (statsRecords.length === 0) {
      return {
        percentUsed: 0,
        isWarning: false,
        isExceeded: false,
        currentUsage: 0,
        limit
      }
    }
    
    // Get the current cost from the user stats
    const currentUsage = parseFloat(statsRecords[0].totalCost.toString())
    
    // Calculate percentage used
    const percentUsed = Math.min(Math.round((currentUsage / limit) * 100), 100)
    
    // Check if usage exceeds threshold or limit
    const isWarning = percentUsed >= WARNING_THRESHOLD && percentUsed < 100
    const isExceeded = currentUsage >= limit
    
    return {
      percentUsed,
      isWarning,
      isExceeded,
      currentUsage,
      limit
    }
  } catch (error) {
    logger.error('Error checking usage status', { error, userId })
    
    // Return default values in case of error
    return {
      percentUsed: 0,
      isWarning: false,
      isExceeded: false,
      currentUsage: 0,
      limit: 0
    }
  }
}

/**
 * Displays a notification to the user when they're approaching their usage limit
 * Can be called on app startup or before executing actions that might incur costs
 */
export async function checkAndNotifyUsage(userId: string): Promise<void> {
  try {
    // Skip usage notifications in development
    if (!isProd) {
      return
    }
    
    const usageData = await checkUsageStatus(userId)
    
    if (usageData.isExceeded) {
      // User has exceeded their limit
      logger.warn('User has exceeded usage limits', { 
        userId,
        usage: usageData.currentUsage,
        limit: usageData.limit
      })
      
      // Dispatch event to show a UI notification
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('usage-exceeded', { 
          detail: { usageData } 
        }))
      }
    } else if (usageData.isWarning) {
      // User is approaching their limit
      logger.info('User approaching usage limits', { 
        userId,
        usage: usageData.currentUsage,
        limit: usageData.limit,
        percent: usageData.percentUsed
      })
      
      // Dispatch event to show a UI notification
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('usage-warning', { 
          detail: { usageData } 
        }))
        
        // Optionally open the subscription tab in settings
        window.dispatchEvent(new CustomEvent('open-settings', { 
          detail: { tab: 'subscription' } 
        }))
      }
    }
  } catch (error) {
    logger.error('Error in usage notification system', { error, userId })
  }
}

// Add this function to check usage limits on the server-side for API routes
/**
 * Server-side function to check if a user has exceeded their usage limits
 * For use in API routes, webhooks, and scheduled executions
 * 
 * @param userId The ID of the user to check
 * @returns An object containing the exceeded status and usage details
 */
export async function checkServerSideUsageLimits(userId: string): Promise<{
  isExceeded: boolean;
  currentUsage: number;
  limit: number;
  message?: string;
}> {
  try {
    // In development, always allow execution
    if (!isProd) {
      return {
        isExceeded: false,
        currentUsage: 0,
        limit: 1000,
      }
    }
    
    logger.info('Server-side checking usage limits for user', { userId })
    
    // Get the user's subscription
    const { data: subscriptions } = await client.subscription.list({
      query: { referenceId: userId }
    })
    
    // Find active subscription
    const activeSubscription = subscriptions?.find(
      sub => sub.status === 'active' || sub.status === 'trialing'
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
    
    logger.info('Server-side user cost limit from subscription', { userId, costLimit })
    
    // Get user's actual usage from the database
    const statsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))
    
    if (statsRecords.length === 0) {
      // No usage yet, so they haven't exceeded the limit
      return {
        isExceeded: false,
        currentUsage: 0,
        limit: costLimit
      }
    }
    
    // Get the current cost and compare with the limit
    const currentUsage = parseFloat(statsRecords[0].totalCost.toString())
    const isExceeded = currentUsage >= costLimit
    
    return {
      isExceeded,
      currentUsage,
      limit: costLimit,
      message: isExceeded 
        ? `Usage limit exceeded: ${currentUsage.toFixed(2)}$ used of ${costLimit}$ limit. Please upgrade your plan to continue.`
        : undefined
    }
  } catch (error) {
    logger.error('Error in server-side usage limit check', { error, userId })
    
    // Be conservative in case of error - allow execution but log the issue
    return {
      isExceeded: false,
      currentUsage: 0,
      limit: 0,
      message: `Error checking usage limits: ${error instanceof Error ? error.message : String(error)}`
    }
  }
} 