import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface Block {
  type: string;
  [key: string]: any;
}

interface WorkflowState {
  blocks: Block[];
  [key: string]: any;
}

interface WorkflowData {
  id: string;
  name: string;
  created_at: string;
  state: {
    blocks: Block[];
  };
  is_deployed?: boolean;
  run_count?: number;
  variables?: string[];
}

export async function GET(
  request: Request,
  context: { params: { email: string } }
) {
  try {
    const params = await Promise.resolve(context.params)
    if (!params?.email) {
      return new NextResponse('Email parameter is required', { status: 400 })
    }

    const email = decodeURIComponent(params.email)
    const cookieStore = cookies()
    
    // Create Supabase client with service role key for admin access
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    })

    // Fetch user details
    const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, email, name')
      .eq('email', email)
      .single()

    if (userError || !user) {
      console.error('Error fetching user:', userError)
      return new NextResponse('User not found', { status: 404 })
    }

    // Fetch user stats
    const { data: userStats, error: userStatsError } = await supabase
      .from('user_stats')
      .select('total_cost')
      .eq('user_id', user.id)
      .single()

    if (userStatsError) {
      console.error('Error fetching user stats:', userStatsError)
      // Continue without stats - don't fail the request
    }

    // Fetch user's workflows with their blocks
    const { data: workflows, error: workflowError } = await supabase
      .from('workflow')
      .select(`
        id,
        name,
        created_at,
        state,
        is_deployed,
        run_count,
        variables
      `)
      .eq('user_id', user.id)

    if (workflowError) {
      console.error('Error fetching workflows:', workflowError)
      return new NextResponse('Error fetching workflows', { status: 500 })
    }

    // Debug logs
    console.log('User ID:', user.id)
    console.log('Number of workflows:', workflows?.length)
    console.log('Workflows:', workflows)

    // Get workflow IDs for this user
    const workflowIds = workflows?.map(w => w.id) || []

    // Fetch API usage from workflow logs using workflow IDs
    const { data: apiLogs, error: apiError } = await supabase
      .from('workflow_logs')
      .select('metadata, workflow_id')
      .in('workflow_id', workflowIds)

    if (apiError) {
      console.error('Error fetching API logs:', apiError)
      return new NextResponse('Error fetching API usage', { status: 500 })
    }

    // Process API usage from metadata
    const apiUsage = new Map<string, number>()
    apiLogs?.forEach(log => {
      const metadata = log.metadata as { api_name?: string } | null
      if (metadata?.api_name) {
        apiUsage.set(metadata.api_name, (apiUsage.get(metadata.api_name) || 0) + 1)
      }
    })

    // Convert API usage to sorted array
    const apiUsageArray = Array.from(apiUsage.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    // Process workflows to get block usage
    const blockUsage = new Map<string, number>()
    const workflowsData = (workflows || []) as unknown as WorkflowData[]
    
    workflowsData.forEach((workflow, index) => {
      console.log(`Processing workflow ${index + 1}:`, {
        id: workflow.id,
        name: workflow.name,
        stateType: typeof workflow.state,
      })
      
      try {
        // Ensure state is parsed as JSON if it's a string
        const state = typeof workflow.state === 'string' 
          ? JSON.parse(workflow.state) 
          : workflow.state

        // Get blocks from the state
        const blocks = state?.blocks || {}
        console.log(`Found ${Object.keys(blocks).length} blocks in workflow ${workflow.id}`)

        // Process each block
        Object.values(blocks).forEach((block: any) => {
          // Skip starter blocks as they are not relevant for usage statistics
          if (block && block.type && block.type !== 'starter') {
            const blockType = block.type
            console.log(`Block type:`, blockType)
            blockUsage.set(blockType, (blockUsage.get(blockType) || 0) + 1)
          }
        })
      } catch (error) {
        console.error(`Error processing workflow ${workflow.id}:`, error)
      }
    })

    // Convert block usage to sorted array
    const blockUsageArray = Array.from(blockUsage.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)

    console.log('Final block usage:', blockUsageArray)

    // Format workflows for response
    const formattedWorkflows = workflowsData.map(workflow => {
      try {
        const state = typeof workflow.state === 'string'
          ? JSON.parse(workflow.state)
          : workflow.state
        
        const blocks = state?.blocks || {}
        
        return {
          id: workflow.id,
          name: workflow.name || workflow.id,
          created_at: workflow.created_at,
          is_deployed: workflow.is_deployed || false,
          run_count: workflow.run_count || 0,
          variables: workflow.variables || [],
          blocks: Object.values(blocks)
            .filter((block: any) => block.type !== 'starter')
            .map((block: any) => ({
              type: block.type || 'unknown'
            }))
        }
      } catch (error) {
        console.error(`Error formatting workflow ${workflow.id}:`, error)
        return {
          id: workflow.id,
          name: workflow.name || workflow.id,
          created_at: workflow.created_at,
          is_deployed: workflow.is_deployed || false,
          run_count: workflow.run_count || 0,
          variables: workflow.variables || [],
          blocks: []
        }
      }
    })

    // Calculate statistics
    const totalBlocks = Array.from(blockUsage.values()).reduce((sum, count) => sum + count, 0)
    const avgBlocksPerWorkflow = workflowsData.length ? totalBlocks / workflowsData.length : 0

    const response = {
      firstName: user.name?.split(' ')[0] || email.split('@')[0],
      email: user.email,
      workflows: formattedWorkflows,
      blockUsage: blockUsageArray,
      apiUsage: apiUsageArray,
      totalBlocks,
      avgBlocksPerWorkflow,
      totalCost: userStats?.total_cost || 0
    }

    console.log('Final response:', response)

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in user stats route:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
} 