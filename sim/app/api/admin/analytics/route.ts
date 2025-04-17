import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const timeRange = searchParams.get('timeRange') as '7d' | '30d'
  if (!timeRange || !['7d', '30d'].includes(timeRange)) {
    return NextResponse.json({ error: 'Invalid timeRange parameter' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Calculate date range
  const now = new Date()
  const startDate = new Date(now)
  startDate.setDate(now.getDate() - (timeRange === '7d' ? 7 : 30))

  try {
    // Fetch workflows created in the time range
    const { data: workflows, error: workflowsError } = await supabase
      .from('workflows')
      .select('id, created_at, blocks')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true })

    if (workflowsError) throw workflowsError

    // Fetch workflow logs in the time range
    const { data: logs, error: logsError } = await supabase
      .from('workflow_logs')
      .select('id, created_at, workflow_id')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true })

    if (logsError) throw logsError

    // Calculate daily trends
    const dailyData: Record<string, { workflows: number; executions: number }> = {}
    const blockUsage: Record<string, number> = {}
    let totalBlocks = 0

    // Initialize dates
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      dailyData[dateStr] = { workflows: 0, executions: 0 }
    }

    // Process workflows
    workflows?.forEach((workflow) => {
      const date = new Date(workflow.created_at).toISOString().split('T')[0]
      if (dailyData[date]) {
        dailyData[date].workflows++
      }

      // Count block usage
      const blocks = workflow.blocks as { type: string }[] || []
      blocks.forEach((block) => {
        blockUsage[block.type] = (blockUsage[block.type] || 0) + 1
        totalBlocks++
      })
    })

    // Process logs
    logs?.forEach((log) => {
      const date = new Date(log.created_at).toISOString().split('T')[0]
      if (dailyData[date]) {
        dailyData[date].executions++
      }
    })

    // Format data for response
    const dates = Object.keys(dailyData).sort()
    const workflowTrends = {
      dates,
      workflows: dates.map(date => dailyData[date].workflows),
      executions: dates.map(date => dailyData[date].executions)
    }

    // Sort block usage by count
    const sortedBlocks = Object.entries(blockUsage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10) // Top 10 blocks

    const blockUsageData = {
      blocks: sortedBlocks.map(([type]) => type),
      count: sortedBlocks.map(([, count]) => count)
    }

    return NextResponse.json({
      overview: {
        totalWorkflows: workflows?.length || 0,
        activeWorkflows: new Set(logs?.map(log => log.workflow_id))?.size || 0,
        totalExecutions: logs?.length || 0,
        avgBlocksPerWorkflow: workflows?.length ? totalBlocks / workflows.length : 0
      },
      workflowTrends,
      blockUsage: blockUsageData
    })

  } catch (error) {
    console.error('Error fetching analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics data' },
      { status: 500 }
    )
  }
} 