import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { generateWorkflowYaml } from '@/lib/workflows/yaml-generator'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'

const logger = createLogger('GetUserWorkflowAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { workflowId, includeMetadata = false } = body

    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    logger.info('Fetching workflow for YAML generation', { workflowId })

    // Fetch workflow from database
    const [workflowRecord] = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowRecord) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowId} not found` },
        { status: 404 }
      )
    }

    // Try to load from normalized tables first, fallback to JSON blob
    let workflowState: any = null
    const subBlockValues: Record<string, Record<string, any>> = {}

    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    if (normalizedData) {
      workflowState = {
        blocks: normalizedData.blocks,
        edges: normalizedData.edges,
        loops: normalizedData.loops,
        parallels: normalizedData.parallels,
      }

      // Extract subblock values from normalized data
      Object.entries(normalizedData.blocks).forEach(([blockId, block]) => {
        subBlockValues[blockId] = {}
        Object.entries((block as any).subBlocks || {}).forEach(([subBlockId, subBlock]) => {
          if ((subBlock as any).value !== undefined) {
            subBlockValues[blockId][subBlockId] = (subBlock as any).value
          }
        })
      })
    } else if (workflowRecord.state) {
      // Fallback to JSON blob
      workflowState = workflowRecord.state as any
      // For JSON blob, subblock values are embedded in the block state
      Object.entries((workflowState.blocks as any) || {}).forEach(([blockId, block]) => {
        subBlockValues[blockId] = {}
        Object.entries((block as any).subBlocks || {}).forEach(([subBlockId, subBlock]) => {
          if ((subBlock as any).value !== undefined) {
            subBlockValues[blockId][subBlockId] = (subBlock as any).value
          }
        })
      })
    }

    if (!workflowState || !workflowState.blocks) {
      return NextResponse.json(
        { success: false, error: 'Workflow state is empty or invalid' },
        { status: 400 }
      )
    }

    // Generate YAML using server-side function
    const yaml = generateWorkflowYaml(workflowState, subBlockValues)

    if (!yaml || yaml.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Generated YAML is empty' },
        { status: 400 }
      )
    }

    // Prepare response
    const response: any = {
      yaml,
      format: 'yaml',
      blockCount: Object.keys(workflowState.blocks).length,
      edgeCount: (workflowState.edges || []).length,
    }

    // Add metadata if requested
    if (includeMetadata) {
      response.metadata = {
        workflowId: workflowRecord.id,
        name: workflowRecord.name,
        description: workflowRecord.description,
        workspaceId: workflowRecord.workspaceId,
        createdAt: workflowRecord.createdAt,
        updatedAt: workflowRecord.updatedAt,
      }
    }

    logger.info('Successfully generated workflow YAML', {
      workflowId,
      blockCount: response.blockCount,
      yamlLength: yaml.length,
    })

    return NextResponse.json({
      success: true,
      output: response,
    })
  } catch (error) {
    logger.error('Failed to get workflow YAML:', error)
    return NextResponse.json(
      {
        success: false,
        error: `Failed to get workflow YAML: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
