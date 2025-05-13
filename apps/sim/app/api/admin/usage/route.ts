import { NextRequest, NextResponse } from 'next/server'
import { and, count, eq, gte, isNull, not, sum } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import {
  apiKey,
  chat,
  customTools,
  marketplace,
  member,
  organization,
  subscription,
  userStats,
  webhook,
  workflow,
  workflowLogs,
  workflowSchedule,
  workspace,
} from '@/db/schema'
import { isAuthorized } from '../utils'

const logger = createLogger('UsageStats')

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    // Get total API calls across all users
    const apiCallsResult = await db.select({ total: sum(userStats.totalApiCalls) }).from(userStats)

    const totalApiCalls = apiCallsResult[0]?.total || 0

    // Get total tokens used across all users
    const tokensResult = await db.select({ total: sum(userStats.totalTokensUsed) }).from(userStats)

    const totalTokensUsed = tokensResult[0]?.total || 0

    // Get total cost across all users
    const costResult = await db.select({ total: sum(userStats.totalCost) }).from(userStats)

    const totalCost = Number(costResult[0]?.total) || 0

    // Get total webhook triggers from user stats
    const webhookTriggersResult = await db
      .select({ total: sum(userStats.totalWebhookTriggers) })
      .from(userStats)

    const totalWebhookTriggers = webhookTriggersResult[0]?.total || 0

    // Get total manual executions
    const manualExecutionsResult = await db
      .select({ total: sum(userStats.totalManualExecutions) })
      .from(userStats)

    const totalManualExecutions = manualExecutionsResult[0]?.total || 0

    // Get total scheduled executions
    const scheduledExecutionsResult = await db
      .select({ total: sum(userStats.totalScheduledExecutions) })
      .from(userStats)

    const totalScheduledExecutions = scheduledExecutionsResult[0]?.total || 0

    // Get chat executions directly from workflow logs
    const chatExecutionsResult = await db
      .select({ total: sum(userStats.totalChatExecutions) })
      .from(userStats)

    const totalChatExecutions = chatExecutionsResult[0]?.total || 0

    // Get total registered webhooks
    const registeredWebhooksCount = await db
      .select({ count: count() })
      .from(webhook)
      .then((res) => res[0].count)

    // Get total schedules created
    const schedulesCreatedCount = await db
      .select({ count: count() })
      .from(workflowSchedule)
      .then((res) => res[0].count)

    // Get total chat interfaces
    const chatInterfacesCount = await db
      .select({ count: count() })
      .from(chat)
      .then((res) => res[0].count)

    // Get active API keys count
    const apiKeysCount = await db
      .select({ count: count() })
      .from(apiKey)
      .then((res) => res[0].count)

    // Get total marketplace views
    const marketplaceViewsResult = await db
      .select({ total: sum(marketplace.views) })
      .from(marketplace)

    const marketplaceViews = marketplaceViewsResult[0]?.total || 0

    // Get total published workflows in marketplace
    const publishedWorkflowsCount = await db
      .select({ count: count() })
      .from(marketplace)
      .then((res) => res[0].count)

    // Get total workflow runs across all workflows
    const workflowRunsResult = await db.select({ total: sum(workflow.runCount) }).from(workflow)

    const totalWorkflowRuns = workflowRunsResult[0]?.total || 0

    // Get total custom tools count
    const customToolsCount = await db
      .select({ count: count() })
      .from(customTools)
      .then((res) => res[0].count)

    // Get total workspaces count
    const workspacesCount = await db
      .select({ count: count() })
      .from(workspace)
      .then((res) => res[0].count)

    // Get total organizations count
    const organizationsCount = await db
      .select({ count: count() })
      .from(organization)
      .then((res) => res[0].count)

    // Get total members count across all organizations
    const membersCount = await db
      .select({ count: count() })
      .from(member)
      .then((res) => res[0].count)

    // Get recently active users (in the past 7 days)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const recentlyActiveUsersCount = await db
      .select({ count: count() })
      .from(userStats)
      .where(gte(userStats.lastActive, sevenDaysAgo))
      .then((res) => res[0].count)

    // Get execution count by trigger type (for detailed breakdown)
    const executionsByTrigger = await db
      .select({
        trigger: workflowLogs.trigger,
        count: count(),
      })
      .from(workflowLogs)
      .groupBy(workflowLogs.trigger)

    // Format execution data
    const executionData = executionsByTrigger.reduce(
      (acc, { trigger, count }) => {
        if (trigger) {
          acc[trigger] = count
        }
        return acc
      },
      {} as Record<string, number>
    )

    // Get count of each subscription plan
    const subscriptionPlans = await db
      .select({
        plan: subscription.plan,
        count: count(),
      })
      .from(subscription)
      .where(and(eq(subscription.status, 'active'), not(isNull(subscription.status))))
      .groupBy(subscription.plan)

    // Format subscription data
    const subscriptionData = subscriptionPlans.reduce(
      (acc, { plan, count }) => {
        acc[plan] = count
        return acc
      },
      {} as Record<string, number>
    )

    return NextResponse.json({
      success: true,
      stats: {
        totalApiCalls,
        totalTokensUsed,
        totalCost,
        totalWebhookTriggers,
        totalManualExecutions,
        totalScheduledExecutions,
        totalChatExecutions,
        registeredWebhooksCount,
        schedulesCreatedCount,
        chatInterfacesCount,
        apiKeysCount,
        marketplaceViews,
        publishedWorkflowsCount,
        totalWorkflowRuns,
        customToolsCount,
        workspacesCount,
        organizationsCount,
        membersCount,
        recentlyActiveUsersCount,
        executionData,
        subscriptionData,
      },
    })
  } catch (error) {
    logger.error('Error fetching usage stats:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to fetch usage stats',
      },
      { status: 500 }
    )
  }
}
