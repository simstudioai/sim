import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { db } from '@/db'
import { workflowLogs } from '@/db/schema'
import { desc } from 'drizzle-orm'

interface Workflow {
  id: string
  name: string
  is_deployed: boolean
  created_at: string
  state: {
    blocks?: Record<string, { type: string; [key: string]: any }> | Array<{ type: string; [key: string]: any }>
  }
  user_id: string
  run_count: number
}

interface WorkflowLog {
  id: string
  workflow_id: string
  created_at: string
  level: string
  message: string
  metadata: any
}

interface User {
  id: string
  email: string
  name?: string
}

interface DashboardData {
  overview: {
    totalWorkflows: number
    activeWorkflows: number
    totalExecutions: number
    avgBlocksPerWorkflow: number
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
    total_cost: number
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
  }>
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

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Fetch all workflows
    const { data: workflows, error: workflowsError } = await supabase
      .from('workflow')
      .select('*') as { data: Workflow[] | null; error: any }

    if (workflowsError) {
      console.error('Workflow fetch error:', workflowsError)
      throw workflowsError
    }
    if (!workflows) throw new Error('No workflows found')

    // Log first workflow for debugging
    console.log('First workflow state structure:', JSON.stringify(workflows[0]?.state, null, 2))

    // Fetch recent workflow logs
    const recentLogs = await db
      .select()
      .from(workflowLogs)
      .orderBy(desc(workflowLogs.createdAt))
      .limit(50)

    console.log('Recent logs:', recentLogs)

    // Get user details for all workflows
    const userIds = [...new Set(workflows.map(w => w.user_id))]
    const { data: users, error: usersError } = await supabase
      .from('user')
      .select('id, email, name')
      .in('id', userIds) as { data: User[] | null; error: any }

    if (usersError) {
      console.error('Users fetch error:', usersError)
      throw usersError
    }
    if (!users) throw new Error('No users found')

    // Map user IDs to user details
    const userMap = users.reduce((acc: Record<string, User>, user: User) => {
      acc[user.id] = user
      return acc
    }, {})

    // Calculate statistics
    const totalWorkflows = workflows.length
    const activeWorkflows = workflows.filter((w: Workflow) => w.is_deployed).length
    const totalExecutions = recentLogs.length

    // Calculate blocks per workflow
    const avgBlocksPerWorkflow = workflows.reduce((acc: number, workflow: Workflow) => {
      const blocks = getBlocksFromState(workflow.state)
      return acc + blocks.length
    }, 0) / totalWorkflows || 0

    // Calculate top users by workflow count
    const userWorkflows = workflows.reduce((acc: Record<string, { workflowCount: number; blockCount: number }>, workflow: Workflow) => {
      const userId = workflow.user_id
      if (!acc[userId]) {
        acc[userId] = { workflowCount: 0, blockCount: 0 }
      }
      acc[userId].workflowCount++
      const blocks = getBlocksFromState(workflow.state)
      acc[userId].blockCount += blocks.length
      return acc
    }, {})

    // Calculate block usage statistics
    const blockStats = workflows.reduce((acc: Record<string, number>, workflow: Workflow) => {
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

    // Fetch all workflow logs to calculate execution statistics
    const { data: allLogs, error: logsError } = await supabase
      .from('workflow_logs')
      .select('*')

    if (logsError) {
      console.error('Logs fetch error:', logsError)
      throw logsError
    }

    // Calculate user execution statistics
    const userExecutionStats = allLogs?.reduce((acc: Record<string, { manual: number; webhook: number; scheduled: number; api: number }>, log) => {
      const workflow = workflows.find(w => w.id === log.workflow_id)
      if (!workflow) return acc

      const userId = workflow.user_id
      if (!acc[userId]) {
        acc[userId] = { manual: 0, webhook: 0, scheduled: 0, api: 0 }
      }

      switch (log.trigger) {
        case 'manual':
          acc[userId].manual++
          break
        case 'webhook':
          acc[userId].webhook++
          break
        case 'scheduled':
          acc[userId].scheduled++
          break
        case 'api':
          acc[userId].api++
          break
      }

      return acc
    }, {})

    // Format response
    const response: DashboardData = {
      overview: {
        totalWorkflows,
        activeWorkflows,
        totalExecutions,
        avgBlocksPerWorkflow
      },
      topUsers: Object.entries(userWorkflows)
        .map(([userId, stats]) => {
          const userWorkflowsData = workflows.filter(w => w.user_id === userId);
          const userBlockUsage = userWorkflowsData.reduce((acc: Record<string, number>, workflow: Workflow) => {
            const blocks = getBlocksFromState(workflow.state);
            blocks.forEach(block => {
              if (block && block.type) {
                const type = block.type;
                if (!acc[type]) acc[type] = 0;
                acc[type]++;
              }
            });
            return acc;
          }, {});

          // Calculate total cost for the user
          const userLogs = allLogs?.filter(log => {
            const workflow = workflows.find(w => w.id === log.workflow_id);
            return workflow && workflow.user_id === userId;
          }) || [];

          const total_cost = userLogs.reduce((acc, log) => {
            return acc + (log.metadata?.cost?.total || 0);
          }, 0);

          return {
            email: userMap[userId]?.email || userId,
            name: userMap[userId]?.name || userMap[userId]?.email.split('@')[0] || 'Unknown',
            ...stats,
            workflows: userWorkflowsData.map(w => ({
              id: w.id,
              name: w.name,
              created_at: w.created_at,
              blocks: getBlocksFromState(w.state)
            })),
            blockUsage: Object.entries(userBlockUsage).map(([type, count]) => ({ type, count })),
            totalBlocks: stats.blockCount,
            avgBlocksPerWorkflow: stats.blockCount / stats.workflowCount || 0,
            total_cost,
            executionStats: userExecutionStats?.[userId] || {
              manual: 0,
              webhook: 0,
              scheduled: 0,
              api: 0
            }
          };
        })
        .sort((a, b) => b.workflowCount - a.workflowCount)
        .slice(0, 10),
      topBlocks: Object.entries(blockStats)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      recentActivity: recentLogs
        .map(log => ({
          workflow_id: log.workflowId,
          created_at: log.createdAt.toISOString(),
          status: log.level === 'error' ? 'error' : 'success'
        }))
        .slice(0, 10),
      workflows: workflows.map(workflow => ({
        id: workflow.id,
        name: workflow.name,
        ownerName: userMap[workflow.user_id]?.name || userMap[workflow.user_id]?.email.split('@')[0] || 'Unknown',
        blockCount: getBlocksFromState(workflow.state).length,
        runCount: workflow.run_count || 0,
        isDeployed: workflow.is_deployed
      }))
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching dashboard data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}