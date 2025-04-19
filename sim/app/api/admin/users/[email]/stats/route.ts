import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { user, workflow, workflowLogs, userStats } from '@/db/schema'
import { User, Workflow, WorkflowState, UserStats } from './types'

// Create a logger for this module
const logger = createLogger('UserStatsAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ email: string }> }
) {
  const { email } = await params
  try {
    // Get the user by email
    const users = await db
      .select()
      .from(user)
      .where(eq(user.email, email))

    if (!users || users.length === 0) {
      return Response.json(
        { error: "User not found" },
        { status: 404 }
      )
    }

    const foundUser = users[0] as User

    // Get all workflows for this user
    const workflowsResult = await db
      .select()
      .from(workflow)
      .where(eq(workflow.userId, foundUser.id))
      
    // Cast to our Workflow interface
    const workflows = workflowsResult.map(w => ({
      ...w,
      state: w.state as WorkflowState
    })) as Workflow[]

    // Calculate statistics
    const workflowCount = workflows.length
    const blockCount = workflows.reduce((total, workflow) => {
      return total + (workflow.state?.blocks?.length || 0)
    }, 0)

    // Get execution statistics from logs
    const logs = await db
      .select()
      .from(workflowLogs)
      .where(
        eq(workflowLogs.level, "execution")
      )

    const userLogs = logs.filter(log => {
      const workflowId = log.workflowId
      return workflows.some(workflow => workflow.id === workflowId)
    })

    const executionCount = userLogs.length
    
    // Filter successful executions
    const successfulExecutions = userLogs.filter(log => {
      try {
        const metadata = log.metadata as any
        return metadata?.status === "success"
      } catch (e) {
        return false
      }
    }).length
    
    const successRate = executionCount > 0 
      ? (successfulExecutions / executionCount) * 100 
      : 0

    // Get user stats to retrieve total cost
    const userStatsResult = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, foundUser.id))

    const totalCost = userStatsResult.length > 0 
      ? parseFloat(userStatsResult[0].totalCost as string) || 0 
      : 0

    // Prepare response data
    const responseData: UserStats = {
      user: {
        id: foundUser.id,
        name: foundUser.name,
        email: foundUser.email,
        createdAt: foundUser.createdAt
      },
      workflows: workflows.map(workflow => ({
        id: workflow.id,
        name: workflow.name,
        blockCount: workflow.state?.blocks?.length || 0,
        createdAt: workflow.createdAt
      })),
      stats: {
        workflowCount,
        blockCount,
        executionCount,
        successfulExecutions,
        successRate,
        totalCost
      }
    }

    return Response.json(responseData)
  } catch (error) {
    logger.error("Error fetching user stats", error)
    return Response.json(
      { error: "Failed to fetch user statistics" },
      { status: 500 }
    )
  }
} 