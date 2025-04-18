import { NextResponse } from 'next/server'
import { db } from '@/db'
import { workflow, workflowLogs, user, userStats, session } from '@/db/schema'
import { desc, eq, sql } from 'drizzle-orm'

interface DashboardData {
  overview: {
    totalWorkflows: number
    activeWorkflows: number
    totalExecutions: number
    avgBlocksPerWorkflow: number
  }
  userDemographics: {
    totalUsers: number
    inactiveUsers: number
    inactivePercentage: number
    usersWithNoWorkflows: number
    usersWithNoRuns: number
    averageWorkflowsPerUser: number
    modifiedAndRan: number
    modifiedAndRanPercentage: number
    modifiedNoRun: number
    modifiedNoRunPercentage: number
    createdMultiple: number
    createdMultiplePercentage: number
    baseStateOnly: number
    baseStateOnlyPercentage: number
    totalSessions: number
    averageSessionsPerUser: number
    returningUsers: number
    returningUsersPercentage: number
    topReturningUsers: Array<{
      name: string
      email: string
      sessionCount: number
      lastSeen: string
    }>
  }
  topUsers: Array<{
    email: string
    name: string
    workflowCount: number
    blockCount: number
    executionStats: {
      manual: number
      webhook: number
      scheduled: number
      api: number
    }
    workflows: Array<{
      id: string
      name: string
      created_at: string
      blocks: { type: string }[]
    }>
    blockUsage: Array<{ type: string; count: number }>
    totalBlocks: number
    avgBlocksPerWorkflow: number
    totalCost: number
  }>
  topBlocks: Array<{
    type: string
    count: number
  }>
  recentActivity: Array<{
    workflow_id: string
    created_at: string
    status: string
  }>
  workflows: Array<{
    id: string
    name: string
    ownerName: string
    blockCount: number
    runCount: number
    isDeployed: boolean
    state: any
  }>
  blockLatencies: Array<{
    type: string
    avgLatency: number
    p50Latency: number
    p75Latency: number
    p99Latency: number
    p100Latency: number
    samples: number
  }>
}

interface LogMetadata {
  blockType?: string
  [key: string]: any
}

interface WorkflowLog {
  id: string
  workflowId: string
  executionId: string | null
  level: string
  message: string
  duration: string | null
  trigger: string | null
  createdAt: Date
  metadata: LogMetadata | null
}

function getBlocksFromState(state: any): { type: string }[] {
  if (!state) return []
  
  // Handle array format
  if (Array.isArray(state.blocks)) {
    return state.blocks
  }
  
  // Handle object format
  if (typeof state.blocks === 'object') {
    return Object.values(state.blocks)
  }
  
  return []
}

function parseLatency(duration: string | null): number {
  if (!duration) return 0
  // Remove 'ms' suffix and convert to number
  return parseFloat(duration.replace('ms', ''))
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((percentile / 100) * sorted.length) - 1
  return sorted[index]
}

function isBaseState(state: any): boolean {
  if (!state || !state.blocks) return false
  
  // Check if there's only one block
  const blocks = Object.values(state.blocks)
  if (blocks.length !== 1) return false
  
  // Check if the only block is a starter block
  const block = blocks[0] as any
  return block.type === 'starter'
}

function isModifiedWorkflow(state: any): boolean {
  return !isBaseState(state)
}

export async function GET() {
  try {
    // Fetch all workflows with their users
    const workflows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        isDeployed: workflow.isDeployed,
        state: workflow.state,
        userId: workflow.userId,
        runCount: workflow.runCount,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      })
      .from(workflow)
      .leftJoin(user, eq(workflow.userId, user.id))

    // Fetch recent workflow logs
    const recentLogs = await db
      .select({
        id: workflowLogs.id,
        workflowId: workflowLogs.workflowId,
        executionId: workflowLogs.executionId,
        level: workflowLogs.level,
        message: workflowLogs.message,
        duration: workflowLogs.duration,
        trigger: workflowLogs.trigger,
        createdAt: workflowLogs.createdAt,
        metadata: workflowLogs.metadata,
      })
      .from(workflowLogs)
      .orderBy(desc(workflowLogs.createdAt)) as WorkflowLog[]

    // Group logs by executionId to get final status
    const executionStatuses = new Map<string, { status: string, createdAt: Date, workflowId: string }>()
    
    recentLogs.forEach(log => {
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

    // Fetch user stats
    let userStatsData: any[] = []
    try {
      userStatsData = await db
        .select()
        .from(userStats)
      console.log('Successfully fetched user stats:', userStatsData.length, 'records')
    } catch (error) {
      console.error('Failed to fetch user stats:', error)
      // Continue with empty userStatsData
    }

    // Calculate statistics
    const totalWorkflows = workflows.length
    const activeWorkflows = workflows.filter(w => w.isDeployed).length
    const totalExecutions = workflows.reduce((acc, w) => acc + (w.runCount || 0), 0)

    // Calculate blocks per workflow
    const avgBlocksPerWorkflow = workflows.reduce((acc, workflow) => {
      const blocks = getBlocksFromState(workflow.state)
      return acc + blocks.length
    }, 0) / totalWorkflows || 0

    // Calculate top users by workflow count
    const userWorkflows = workflows.reduce((acc: Record<string, { 
      workflowCount: number
      blockCount: number
      user: typeof workflows[0]['user']
    }>, workflow) => {
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

    // Calculate block latency statistics
    const blockLatencyMap = new Map<string, number[]>()
    
    // Collect all latencies for each block type
    recentLogs.forEach(log => {
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

    // Fetch all users
    const allUsers = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)

    // Calculate user demographics
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

    // Group workflows by user
    const userWorkflowMap = workflows.reduce((acc, w) => {
      if (!acc.has(w.userId)) {
        acc.set(w.userId, [])
      }
      acc.get(w.userId)?.push(w)
      return acc
    }, new Map<string, typeof workflows>())

    // Calculate engagement metrics
    const userEngagement = new Map<string, {
      hasModifiedWorkflow: boolean
      hasRun: boolean
      hasMultipleWorkflows: boolean
    }>()

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
      console.warn(`User categorization error: ${totalCategorizedUsers} categorized vs ${totalUsers} total users`)
    }

    // Fetch session data
    const sessions = await db
      .select({
        id: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
        user: {
          name: user.name,
          email: user.email
        }
      })
      .from(session)
      .leftJoin(user, eq(session.userId, user.id))
      .orderBy(desc(session.createdAt))

    // Calculate session statistics
    const totalSessions = sessions.length

    // Group sessions by user
    const userSessions = sessions.reduce((acc, session) => {
      if (!acc.has(session.userId)) {
        acc.set(session.userId, [])
      }
      acc.get(session.userId)?.push(session)
      return acc
    }, new Map<string, typeof sessions>())

    // Calculate average sessions per user
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

    const userDemographics = {
      totalUsers,
      inactiveUsers,
      inactivePercentage: (inactiveUsers / totalUsers) * 100,
      usersWithNoWorkflows,
      usersWithNoRuns,
      averageWorkflowsPerUser: totalWorkflows / totalUsers,
      modifiedAndRan,
      modifiedAndRanPercentage: (modifiedAndRan / totalUsers) * 100,
      modifiedNoRun,
      modifiedNoRunPercentage: (modifiedNoRun / totalUsers) * 100,
      createdMultiple,
      createdMultiplePercentage: (createdMultiple / totalUsers) * 100,
      baseStateOnly,
      baseStateOnlyPercentage: (baseStateOnly / totalUsers) * 100,
      totalSessions,
      averageSessionsPerUser,
      returningUsers: returningUsersCount,
      returningUsersPercentage,
      topReturningUsers
    }

    // Format response
    const response: DashboardData = {
      overview: {
        totalWorkflows,
        activeWorkflows,
        totalExecutions,
        avgBlocksPerWorkflow
      },
      userDemographics,
      topUsers: Object.entries(userWorkflows)
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
            workflows: userWorkflowsData.map(w => ({
              id: w.id,
              name: w.name,
              created_at: new Date().toISOString(),
              blocks: getBlocksFromState(w.state)
            })),
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
        .slice(0, 5),
      topBlocks: Object.entries(blockStats)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15),
      recentActivity: Array.from(executionStatuses.values())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(({ status, createdAt, workflowId }) => ({
          workflow_id: workflowId,
          created_at: createdAt.toISOString(),
          status
        })),
      workflows: workflows.map(w => ({
        id: w.id,
        name: w.name,
        ownerName: w.user?.name || 'Unknown',
        blockCount: getBlocksFromState(w.state).length,
        runCount: w.runCount,
        isDeployed: w.isDeployed,
        state: w.state
      })),
      blockLatencies
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Dashboard data fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}