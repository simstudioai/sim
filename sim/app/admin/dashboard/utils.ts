import { getBlocksFromState } from '../analytics/utils/workflow-utils'
import { UserEngagement, UserStats, WorkflowLog, WorkflowWithUser, UserWorkflowStats, Session } from './types'
import { redirect } from 'next/navigation'

/**
 * Check if the user is authenticated in the admin dashboard
 * This function can be used in server components to check authentication status
 * @returns boolean indicating if the user is authenticated
 */
export function isAdminAuthenticated(): boolean {
  // This is a server-side check that can be used in server components
  // For client components, the PasswordAuth component already handles this
  return true // In a real implementation, this would check a server-side session
}

/**
 * Get the admin session and redirect if not authenticated
 * This function should be used in server components to handle authentication
 * @param callbackUrl - The URL to redirect to after login
 * @returns The session object if authenticated
 */
export async function getAdminSession(callbackUrl: string = '/admin/dashboard') {
  // In a real implementation, this would fetch the session from a server-side auth provider
  // For now, we'll use a placeholder implementation
  const isAuthenticated = isAdminAuthenticated()
  
  if (!isAuthenticated) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }
  
  // Return a placeholder session object
  return {
    user: {
      email: 'admin@example.com',
      name: 'Admin User'
    }
  }
}

/**
 * Fetch workflow logs with proper error handling
 * @param workflowId - The ID of the workflow to fetch logs for
 * @returns The logs data or throws an error with a descriptive message
 */
export async function fetchWorkflowLogs(workflowId: string) {
  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/log`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      // Handle specific HTTP status codes
      if (response.status === 404) {
        throw new Error(`No logs found for workflow ID: ${workflowId}`)
      }
      
      // Try to get error details from the response
      let errorMessage = 'Failed to fetch logs'
      try {
        const errorData = await response.json()
        if (errorData.error) {
          errorMessage = errorData.error
        } else {
          errorMessage = `Failed to fetch logs: ${response.status} ${response.statusText}`
        }
      } catch (e) {
        // If we can't parse the error JSON, use the status text
        errorMessage = `Failed to fetch logs: ${response.status} ${response.statusText}`
      }
      throw new Error(errorMessage)
    }

    const data = await response.json()
    return data.logs || []
  } catch (err) {
    console.error('Error fetching workflow logs:', err)
    throw err instanceof Error ? err : new Error('Failed to fetch logs')
  }
}

/**
 * Parse latency duration string to number
 */
export function parseLatency(duration: string | null): number {
  if (!duration) return 0
  // Remove 'ms' suffix and convert to number
  return parseFloat(duration.replace('ms', ''))
}

/**
 * Calculate percentile value from an array of numbers
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)
  return sorted[index]
}

/**
 * Check if a workflow state is in base state (only starter block)
 */
export function isBaseState(state: any): boolean {
  if (!state || !state.blocks) return false
  
  // Check if there's only one block
  const blocks = Object.values(state.blocks)
  if (blocks.length !== 1) return false
  
  // Check if the only block is a starter block
  const block = blocks[0] as any
  return block.type === 'starter'
}

/**
 * Check if a workflow has been modified from base state
 */
export function isModifiedWorkflow(state: any): boolean {
  return !isBaseState(state)
}

/**
 * Process execution statuses from logs
 */
export function processExecutionStatuses(logs: WorkflowLog[]) {
  const executionStatuses = new Map<string, { status: string, createdAt: Date, workflowId: string }>()
  
  logs.forEach(log => {
    if (!log.executionId) return
    
    // Only update if this is a newer log for this execution
    const existing = executionStatuses.get(log.executionId)
    if (!existing || existing.createdAt < log.createdAt) {
      const successMessages = [
        'API workflow executed successfully',
        'Webhook workflow executed successfully',
        'Scheduled workflow executed successfully',
        'Manual workflow executed successfully',
        'Workflow executed successfully',
        'completed successfully',
        'execution succeeded'
      ]

      const status = log.level === 'info' && successMessages.some(msg => log.message.includes(msg))
        ? 'success'
        : 'error'
      
      executionStatuses.set(log.executionId, {
        status,
        createdAt: log.createdAt,
        workflowId: log.workflowId
      })
    }
  })
  
  return executionStatuses
}

/**
 * Calculate workflow statistics
 */
export function calculateWorkflowStats(workflows: WorkflowWithUser[], userStatsData: UserStats[]) {
  const totalWorkflows = workflows.length
  const activeWorkflows = workflows.filter(w => w.isDeployed).length
  
  // Calculate total executions from userStats instead of workflow runCount
  const totalExecutions = userStatsData.reduce((acc, stats) => {
    return acc + 
      (stats.totalManualExecutions || 0) +
      (stats.totalWebhookTriggers || 0) +
      (stats.totalScheduledExecutions || 0) +
      (stats.totalApiCalls || 0)
  }, 0)

  // Calculate blocks per workflow
  const avgBlocksPerWorkflow = workflows.reduce((acc, workflow) => {
    const blocks = getBlocksFromState(workflow.state)
    return acc + blocks.length
  }, 0) / totalWorkflows || 0
  
  return {
    totalWorkflows,
    activeWorkflows,
    totalExecutions,
    avgBlocksPerWorkflow
  }
}

/**
 * Calculate user workflow statistics
 */
export function calculateUserWorkflowStats(workflows: WorkflowWithUser[]) {
  // Calculate top users by workflow count
  const userWorkflows = workflows.reduce((acc: Record<string, UserWorkflowStats>, workflow) => {
    const userId = workflow.userId
    if (!acc[userId]) {
      acc[userId] = { 
        workflowCount: 0, 
        blockCount: 0,
        user: workflow.user
      }
    }
    acc[userId].workflowCount++
    const blocks = getBlocksFromState(workflow.state)
    acc[userId].blockCount += blocks.length
    return acc
  }, {})
  
  return userWorkflows
}

/**
 * Calculate block usage statistics
 */
export function calculateBlockUsageStats(workflows: WorkflowWithUser[]) {
  // Calculate block usage statistics
  const blockStats = workflows.reduce((acc: Record<string, number>, workflow) => {
    const blocks = getBlocksFromState(workflow.state)
    blocks.forEach(block => {
      if (block && block.type) {
        const type = block.type
        if (!acc[type]) acc[type] = 0
        acc[type]++
      }
    })
    return acc
  }, {})
  
  return blockStats
}

/**
 * Calculate block latency statistics
 */
export function calculateBlockLatencyStats(logs: WorkflowLog[]) {
  // Calculate block latency statistics
  const blockLatencyMap = new Map<string, number[]>()
  
  // Collect all latencies for each block type
  logs.forEach(log => {
    // Skip workflow completion messages
    if (log.message.includes('workflow executed successfully') || 
        log.message.includes('execution succeeded') ||
        log.message.includes('completed successfully')) {
      return
    }

    // Extract block type from message
    const blockMatch = log.message.match(/Block .+? \((.+?)\):/)
    if (!blockMatch) return
    
    const blockType = blockMatch[1].toLowerCase()
    if (blockType === 'unknown' || !log.duration) return
    
    // Initialize array if not exists
    if (!blockLatencyMap.has(blockType)) {
      blockLatencyMap.set(blockType, [])
    }
    
    // Add latency for this block type
    const latency = parseLatency(log.duration)
    if (latency > 0) {
      blockLatencyMap.get(blockType)?.push(latency)
    }
  })

  // Calculate statistics for each block type
  const blockLatencies = Array.from(blockLatencyMap.entries()).map(([type, latencies]) => ({
    type,
    avgLatency: latencies.length > 0 
      ? latencies.reduce((sum, val) => sum + val, 0) / latencies.length 
      : 0,
    p50Latency: calculatePercentile(latencies, 50),
    p75Latency: calculatePercentile(latencies, 75),
    p99Latency: calculatePercentile(latencies, 99),
    p100Latency: calculatePercentile(latencies, 100),
    samples: latencies.length
  }))
  
  return blockLatencies
}

/**
 * Calculate user demographics
 */
export function calculateUserDemographics(
  allUsers: any[], 
  workflows: WorkflowWithUser[], 
  userWorkflowMap: Map<string, WorkflowWithUser[]>,
  userStatsData: UserStats[]
) {
  const totalUsers = allUsers.length
  
  // Users with no workflows
  const usersWithWorkflows = new Set(workflows.map(w => w.userId))
  const usersWithNoWorkflows = allUsers.filter(u => !usersWithWorkflows.has(u.id)).length

  // Users with workflows but no runs
  const usersWithNoRuns = workflows.reduce((acc, w) => {
    if (!acc.has(w.userId) && (!w.runCount || w.runCount === 0)) {
      acc.add(w.userId)
    }
    return acc
  }, new Set()).size

  // Users who have workflows in base state (only starter block) and no runs
  const inactiveUsers = workflows.reduce((acc, w) => {
    if (isBaseState(w.state) && (!w.runCount || w.runCount === 0)) {
      acc.add(w.userId)
    }
    return acc
  }, new Set()).size

  // Calculate engagement metrics
  const userEngagement = new Map<string, UserEngagement>()

  userWorkflowMap.forEach((userWorkflows, userId) => {
    const firstWorkflow = userWorkflows[0]
    const hasModifiedWorkflow = firstWorkflow && isModifiedWorkflow(firstWorkflow.state)
    const hasRun = firstWorkflow && firstWorkflow.runCount > 0
    const hasMultipleWorkflows = userWorkflows.length > 1

    userEngagement.set(userId, {
      hasModifiedWorkflow,
      hasRun,
      hasMultipleWorkflows
    })
  })

  // Calculate user categories - each user should fall into exactly one category
  const userCategories = new Map<string, string>()

  // Categorize each user based on their highest level of engagement
  Array.from(userWorkflowMap.entries()).forEach(([userId, userWorkflows]) => {
    const engagement = userEngagement.get(userId)
    if (!engagement) return

    if (userWorkflows.length > 1) {
      // Users with multiple workflows go into "Created Multiple" category
      userCategories.set(userId, 'created_multiple')
    } else if (engagement.hasModifiedWorkflow && engagement.hasRun) {
      // Users who modified and ran their single workflow
      userCategories.set(userId, 'modified_and_ran')
    } else if (engagement.hasModifiedWorkflow) {
      // Users who modified but haven't run their workflow
      userCategories.set(userId, 'modified_no_run')
    } else {
      // Users with just the starter workflow in base state
      userCategories.set(userId, 'base_state')
    }
  })

  // Count users in each category
  const modifiedAndRan = Array.from(userCategories.values())
    .filter(category => category === 'modified_and_ran').length

  const modifiedNoRun = Array.from(userCategories.values())
    .filter(category => category === 'modified_no_run').length

  const createdMultiple = Array.from(userCategories.values())
    .filter(category => category === 'created_multiple').length

  const baseStateOnly = Array.from(userCategories.values())
    .filter(category => category === 'base_state').length

  // Verify that all users are categorized exactly once
  const totalCategorizedUsers = 
    modifiedAndRan + 
    modifiedNoRun + 
    createdMultiple + 
    baseStateOnly

  if (totalCategorizedUsers !== totalUsers) {
    console.error(`User categorization error: ${totalCategorizedUsers} categorized vs ${totalUsers} total users`)
    
    // Find uncategorized users
    const categorizedUserIds = new Set<string>()
    userCategories.forEach((category, userId) => {
      categorizedUserIds.add(userId)
    })
    
    const uncategorizedUserIds = Array.from(userWorkflowMap.keys())
      .filter(userId => !categorizedUserIds.has(userId))
    
    if (uncategorizedUserIds.length > 0) {
      console.error(`Uncategorized users: ${uncategorizedUserIds.join(', ')}`)
    }
    
    // Return an error response with details about the inconsistency
    return {
      error: 'Data inconsistency detected in user categorization',
      details: {
        totalUsers,
        totalCategorizedUsers,
        uncategorizedCount: uncategorizedUserIds.length,
        uncategorizedUsers: uncategorizedUserIds
      }
    }
  }

  return {
    totalUsers,
    inactiveUsers,
    inactivePercentage: (inactiveUsers / totalUsers) * 100,
    usersWithNoWorkflows,
    usersWithNoRuns,
    averageWorkflowsPerUser: workflows.length / totalUsers,
    modifiedAndRan,
    modifiedAndRanPercentage: (modifiedAndRan / totalUsers) * 100,
    modifiedNoRun,
    modifiedNoRunPercentage: (modifiedNoRun / totalUsers) * 100,
    createdMultiple,
    createdMultiplePercentage: (createdMultiple / totalUsers) * 100,
    baseStateOnly,
    baseStateOnlyPercentage: (baseStateOnly / totalUsers) * 100,
    userCategories
  }
}

/**
 * Process session data
 */
export function processSessionData(sessions: Session[], allUsers: any[], userStatsData: UserStats[]) {
  // Calculate session statistics
  const totalSessions = sessions.length

  // Group sessions by user
  const userSessions = sessions.reduce((acc, session) => {
    if (!acc.has(session.userId)) {
      acc.set(session.userId, [])
    }
    acc.get(session.userId)?.push(session)
    return acc
  }, new Map<string, Session[]>())

  // Calculate average sessions per user
  const totalUsers = allUsers.length
  const averageSessionsPerUser = totalSessions / totalUsers

  // Calculate returning users (users with multiple sessions)
  const returningUsersCount = Array.from(userSessions.values())
    .filter(userSessions => userSessions.length > 1).length
  const returningUsersPercentage = (returningUsersCount / totalUsers) * 100

  // Get top 10 returning users
  const topReturningUsers = Array.from(userSessions.entries())
    .map(([userId, sessions]) => {
      const userStat = userStatsData.find(s => s.userId === userId)
      return {
        name: sessions[0].user?.name ?? 'Unknown User',
        email: sessions[0].user?.email ?? 'unknown@email.com',
        sessionCount: sessions.length,
        lastSeen: userStat?.last_active?.toISOString() ?? sessions[0].createdAt.toISOString() // Prefer last_active, fallback to session time
      }
    })
    .filter(user => user.sessionCount > 1)
    .sort((a, b) => b.sessionCount - a.sessionCount)
    .slice(0, 10)

  return {
    totalSessions,
    averageSessionsPerUser,
    returningUsers: returningUsersCount,
    returningUsersPercentage,
    topReturningUsers
  }
}

/**
 * Format top users data
 */
export function formatTopUsersData(
  userWorkflows: Record<string, UserWorkflowStats>, 
  workflows: WorkflowWithUser[], 
  userStatsData: UserStats[]
) {
  return Object.entries(userWorkflows)
    .map(([userId, stats]) => {
      const userWorkflowsData = workflows.filter(w => w.userId === userId)
      const userBlockUsage = userWorkflowsData.reduce((acc: Record<string, number>, workflow) => {
        const blocks = getBlocksFromState(workflow.state)
        blocks.forEach(block => {
          if (block && block.type) {
            const type = block.type
            if (!acc[type]) acc[type] = 0
            acc[type]++
          }
        })
        return acc
      }, {})

      const userStats = userStatsData.find(s => s.userId === userId)

      return {
        email: stats.user?.email || 'Unknown',
        name: stats.user?.name || 'Unknown',
        workflowCount: stats.workflowCount,
        blockCount: stats.blockCount,
        executionStats: {
          manual: userStats?.totalManualExecutions || 0,
          webhook: userStats?.totalWebhookTriggers || 0,
          scheduled: userStats?.totalScheduledExecutions || 0,
          api: userStats?.totalApiCalls || 0
        },
        workflows: userWorkflowsData.map(w => {
          const blocksList = getBlocksFromState(w.state);
          return {
            id: w.id,
            name: w.name,
            created_at: new Date().toISOString(),
            // Provide both formats for better compatibility
            blockTypes: blocksList.map(block => block.type),
            blocks: blocksList,
            blockCount: blocksList.length
          };
        }),
        blockUsage: Object.entries(userBlockUsage).map(([type, count]) => ({
          type,
          count
        })),
        totalBlocks: stats.blockCount,
        avgBlocksPerWorkflow: stats.blockCount / stats.workflowCount,
        totalCost: Number(userStats?.totalCost || 0)
      }
    })
    .sort((a, b) => b.workflowCount - a.workflowCount)
    .slice(0, 5)
}

/**
 * Format workflows data
 */
export function formatWorkflowsData(workflows: WorkflowWithUser[]) {
  return workflows.map(w => ({
    id: w.id,
    name: w.name,
    ownerName: w.user?.name || 'Unknown',
    blockCount: getBlocksFromState(w.state).length,
    runCount: w.runCount,
    isDeployed: w.isDeployed,
  }))
} 