import { NextResponse } from 'next/server'
import { db } from '@/db'
import { workflow, workflowLogs, user, userStats } from '@/db/schema'
import { eq } from 'drizzle-orm'

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

export async function GET(
  request: Request,
  { params }: { params: { email: string } }
) {
  try {
    // Ensure params is properly awaited
    const emailParam = params.email
    if (!emailParam) {
      return NextResponse.json(
        { error: 'Email parameter is required' },
        { status: 400 }
      )
    }
    
    const email = decodeURIComponent(emailParam)

    // Get user by email
    const userData = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1)

    if (!userData || userData.length === 0) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    const userId = userData[0].id

    // Get user's workflows
    const workflows = await db
      .select()
      .from(workflow)
      .where(eq(workflow.userId, userId))

    // Get user's stats
    const stats = await db
      .select()
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    // Calculate workflow statistics
    const workflowCount = workflows.length
    const blockCount = workflows.reduce((acc, w) => {
      const blocks = getBlocksFromState(w.state)
      return acc + blocks.length
    }, 0)

    // Calculate block usage
    const blockUsage = workflows.reduce((acc: Record<string, number>, w) => {
      const blocks = getBlocksFromState(w.state)
      blocks.forEach(block => {
        if (block && block.type) {
          const type = block.type
          if (!acc[type]) acc[type] = 0
          acc[type]++
        }
      })
      return acc
    }, {})

    // Get execution stats from userStats or use defaults
    const executionStats = stats[0] ? {
      manual: stats[0].totalManualExecutions,
      webhook: stats[0].totalWebhookTriggers,
      scheduled: stats[0].totalScheduledExecutions,
      api: stats[0].totalApiCalls
    } : {
      manual: 0,
      webhook: 0,
      scheduled: 0,
      api: 0
    }

    return NextResponse.json({
      firstName: userData[0].name,
      email: userData[0].email,
      workflowCount,
      blockCount,
      workflows: workflows.map(w => ({
        id: w.id,
        name: w.name,
        created_at: w.createdAt.toISOString(),
        blocks: getBlocksFromState(w.state)
      })),
      blockUsage: Object.entries(blockUsage)
        .sort(([, a], [, b]) => b - a)
        .map(([type, count]) => ({
          type,
          count
        })),
      totalBlocks: blockCount,
      avgBlocksPerWorkflow: workflowCount > 0 ? blockCount / workflowCount : 0,
      totalCost: Number(stats[0]?.totalCost || 0),
      executionStats
    })
  } catch (error) {
    console.error('Error fetching user stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user stats' },
      { status: 500 }
    )
  }
} 