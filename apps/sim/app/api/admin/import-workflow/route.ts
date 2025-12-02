import { db } from '@sim/db'
import { user, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { sanitizeForExport } from '@/lib/workflows/json-sanitizer'

const logger = createLogger('AdminImportWorkflowAPI')

const ImportWorkflowSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  targetWorkspaceId: z.string().min(1, 'Target workspace ID is required'),
  deploymentVersion: z.number().int().positive().optional(),
})

/**
 * POST /api/admin/import-workflow
 * Export a workflow from database by ID (superuser only)
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized import attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is superuser
    const currentUser = await db
      .select({ isSuperUser: user.isSuperUser })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    if (!currentUser[0]?.isSuperUser) {
      logger.warn(`[${requestId}] Non-superuser attempted workflow import: ${session.user.id}`)
      return NextResponse.json({ error: 'Forbidden - Superuser access required' }, { status: 403 })
    }

    const body = await request.json()
    const validation = ImportWorkflowSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { workflowId, targetWorkspaceId, deploymentVersion } = validation.data

    // Fetch workflow metadata
    const [workflowData] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowData) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    let workflowState: any
    let sourceLabel = 'current state'

    if (deploymentVersion !== undefined) {
      // Load from deployment version
      const [deployedVersion] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, workflowId),
            eq(workflowDeploymentVersion.version, deploymentVersion)
          )
        )
        .limit(1)

      if (!deployedVersion?.state) {
        return NextResponse.json({ error: `Deployment version ${deploymentVersion} not found` }, { status: 404 })
      }

      const deployedState = deployedVersion.state as any
      workflowState = {
        blocks: deployedState.blocks || {},
        edges: Array.isArray(deployedState.edges) ? deployedState.edges : [],
        loops: deployedState.loops || {},
        parallels: deployedState.parallels || {},
        metadata: {
          name: workflowData.name,
          description: workflowData.description ?? undefined,
          color: workflowData.color ?? undefined,
        },
        variables: Array.isArray(deployedState.variables) ? deployedState.variables : [],
      }
      sourceLabel = `deployment v${deploymentVersion}`
    } else {
      // Load current state from normalized tables
      const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

      if (!normalizedData) {
        return NextResponse.json({ error: 'Workflow has no data' }, { status: 404 })
      }

      let workflowVariables: any[] = []
      if (workflowData.variables && typeof workflowData.variables === 'object') {
        workflowVariables = Object.values(workflowData.variables).map((v: any) => ({
          id: v.id,
          name: v.name,
          type: v.type,
          value: v.value,
        }))
      }

      workflowState = {
        blocks: normalizedData.blocks || {},
        edges: Array.isArray(normalizedData.edges) ? normalizedData.edges : [],
        loops: normalizedData.loops || {},
        parallels: normalizedData.parallels || {},
        metadata: {
          name: workflowData.name,
          description: workflowData.description ?? undefined,
          color: workflowData.color ?? undefined,
        },
        variables: workflowVariables,
      }
    }

    const exportState = sanitizeForExport(workflowState)

    logger.info(`[${requestId}] Exported workflow ${workflowId} (${sourceLabel})`)

    return NextResponse.json({
      success: true,
      workflow: exportState,
      metadata: {
        originalId: workflowId,
        originalName: workflowData.name,
        originalDescription: workflowData.description,
        targetWorkspaceId,
        deploymentVersion: deploymentVersion ?? null,
        source: sourceLabel,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error importing workflow:`, error)
    return NextResponse.json(
      { error: 'Failed to import workflow' },
      { status: 500 }
    )
  }
}

