import { NextResponse } from 'next/server'
import { db } from '@/db'
import { workflow, workflowLogs, user, userStats, session } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'

import { 
  DashboardData, 
  WorkflowLog, 
  WorkflowWithUser, 
  UserStats as UserStatsType,
  Session as SessionType
} from '@/app/admin/dashboard/types'
import {
  parseLatency,
  calculatePercentile,
  isBaseState,
  isModifiedWorkflow,
  processExecutionStatuses,
  calculateWorkflowStats,
  calculateUserWorkflowStats,
  calculateBlockUsageStats,
  calculateBlockLatencyStats,
  calculateUserDemographics,
  processSessionData,
  formatTopUsersData,
  formatWorkflowsData
} from '@/app/admin/dashboard/utils'
import { getBlocksFromState } from '@/app/admin/analytics/utils/workflow-utils'

// Helper function to fetch workflows with their users
async function fetchWorkflowsWithUsers(): Promise<WorkflowWithUser[]> {
  return await db
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
    .leftJoin(user, eq(workflow.userId, user.id)) as WorkflowWithUser[]
}

// Helper function to fetch recent workflow logs
async function fetchRecentWorkflowLogs(): Promise<WorkflowLog[]> {
  return await db
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
}

// Helper function to fetch user stats
async function fetchUserStats(): Promise<UserStatsType[]> {
  try {
    const userStatsData = await db
      .select()
      .from(userStats)
    console.log('Successfully fetched user stats:', userStatsData.length, 'records')
    return userStatsData.map(stat => ({
      ...stat,
      last_active: stat.lastActive, // Map lastActive to last_active
      totalCost: parseFloat(stat.totalCost) // Convert string to number
    })) as UserStatsType[]
  } catch (error) {
    console.error('Failed to fetch user stats:', error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.stack) {
      console.error('Error stack:', error.stack)
    }
    throw new Error('Failed to fetch user statistics')
  }
}

// Helper function to fetch all users
async function fetchAllUsers() {
  return await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
    })
    .from(user)
}

// Helper function to fetch and process session data
async function fetchAndProcessSessionData(userStatsData: UserStatsType[], allUsers: any[]) {
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
    .orderBy(desc(session.createdAt)) as SessionType[]

  return processSessionData(sessions, allUsers, userStatsData)
}

export async function GET() {
  try {
    // Fetch all required data
    const workflows = await fetchWorkflowsWithUsers()
    const logs = await fetchRecentWorkflowLogs()
    const userStatsData = await fetchUserStats()
    const allUsers = await fetchAllUsers()

    // Group workflows by user
    const userWorkflowMap = new Map<string, WorkflowWithUser[]>()
    workflows.forEach(workflow => {
      if (!userWorkflowMap.has(workflow.userId)) {
        userWorkflowMap.set(workflow.userId, [])
      }
      userWorkflowMap.get(workflow.userId)?.push(workflow)
    })

    // Calculate workflow statistics
    const overview = calculateWorkflowStats(workflows, userStatsData)

    // Calculate user workflow statistics
    const userWorkflows = calculateUserWorkflowStats(workflows)

    // Calculate block usage statistics
    const blockStats = calculateBlockUsageStats(workflows)
    const topBlocks = Object.entries(blockStats)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Calculate block latency statistics
    const blockLatencies = calculateBlockLatencyStats(logs)

    // Process execution statuses
    const executionStatuses = processExecutionStatuses(logs)

    // Format recent activity
    const recentActivity = Array.from(executionStatuses.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map(status => ({
        workflow_id: status.workflowId,
        created_at: status.createdAt.toISOString(),
        status: status.status
      }))

    // Calculate user demographics
    const userDemographics = calculateUserDemographics(
      allUsers,
      workflows,
      userWorkflowMap,
      userStatsData
    )

    // Check for errors in user demographics
    if ('error' in userDemographics) {
      console.error('Error in user demographics:', userDemographics)
      return NextResponse.json(
        { error: 'Failed to calculate user demographics' },
        { status: 500 }
      )
    }

    // Process session data
    const sessionData = await fetchAndProcessSessionData(userStatsData, allUsers)

    // Format top users data
    const topUsers = formatTopUsersData(userWorkflows, workflows, userStatsData)

    // Format workflows data
    const formattedWorkflows = formatWorkflowsData(workflows)

    // Combine all data into the dashboard response
    const dashboardData: DashboardData = {
      overview,
      userDemographics: {
        ...userDemographics,
        ...sessionData
      },
      topUsers,
      topBlocks,
      recentActivity,
      workflows: formattedWorkflows,
      blockLatencies
    }

    return NextResponse.json(dashboardData)
  } catch (error) {
    console.error('Error fetching dashboard data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}