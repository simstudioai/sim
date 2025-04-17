import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    // Ensure we await the params
    const { id } = await Promise.resolve(context.params)

    // First get the workflow details
    const { data: workflow, error: workflowError } = await supabase
      .from('workflow')
      .select('name')
      .eq('id', id)
      .single()

    if (workflowError) {
      throw workflowError
    }

    // Then get the logs
    const { data: logs, error: logsError } = await supabase
      .from('workflow_logs')
      .select(`
        id,
        workflow_id,
        execution_id,
        level,
        message,
        duration,
        trigger,
        created_at,
        metadata
      `)
      .eq('workflow_id', id)
      .order('created_at', { ascending: false })

    if (logsError) {
      throw logsError
    }

    // Transform logs to include workflow name and success status
    const transformedLogs = (logs || []).map(log => ({
      ...log,
      workflowName: workflow?.name || 'Unknown Workflow',
      success: log.duration !== 'NA' && log.level !== 'error'
    }))

    return NextResponse.json({ logs: transformedLogs })
  } catch (error) {
    console.error('Error fetching workflow logs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workflow logs' },
      { status: 500 }
    )
  }
} 