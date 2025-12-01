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
 * Import a workflow from database by ID into a target workspace
 * Superuser only
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Check authentication
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

    // Parse request body
    const body = await request.json()
    const validation = ImportWorkflowSchema.safeParse(body)

    if (!validation.success) {
      logger.warn(`[${requestId}] Invalid request body:`, validation.error)
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
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    let workflowState: any
    let sourceLabel = 'current state'

    // If deployment version is specified, load from deployment
    if (deploymentVersion !== undefined) {
      logger.info(`[${requestId}] Loading deployment version ${deploymentVersion} for workflow ${workflowId}`)
      
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
        logger.warn(`[${requestId}] Deployment version ${deploymentVersion} not found for workflow ${workflowId}`)
        return NextResponse.json({ error: `Deployment version ${deploymentVersion} not found` }, { status: 404 })
      }

      // Deployed state already has the structure we need
      const deployedState = deployedVersion.state as any
      
      // Ensure deployed state has the right structure
      if (!deployedState.blocks || typeof deployedState.blocks !== 'object') {
        logger.error(`[${requestId}] Deployment version ${deploymentVersion} has invalid blocks structure`)
        return NextResponse.json({ error: 'Deployment has invalid state structure' }, { status: 500 })
      }
      
      workflowState = {
        blocks: deployedState.blocks || {},
        edges: Array.isArray(deployedState.edges) ? deployedState.edges : [],
        loops: deployedState.loops || {},
        parallels: deployedState.parallels || {},
        metadata: {
          name: workflowData.name,
          description: workflowData.description ?? undefined,
          color: workflowData.color ?? undefined,
          exportedAt: new Date().toISOString(),
          deploymentVersion,
        },
        variables: Array.isArray(deployedState.variables) ? deployedState.variables : [],
      }
      
      logger.info(`[${requestId}] Loaded deployment state`, {
        blockCount: Object.keys(workflowState.blocks).length,
        edgeCount: workflowState.edges.length,
        variableCount: workflowState.variables.length,
      })
      sourceLabel = `deployment v${deploymentVersion}`
    } else {
      // Load current workflow from normalized tables
      const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

      if (!normalizedData) {
        logger.warn(`[${requestId}] Workflow ${workflowId} has no normalized data`)
        return NextResponse.json({ error: 'Workflow has no data' }, { status: 404 })
      }

      // Convert variables to array format
      let workflowVariables: any[] = []
      if (workflowData.variables && typeof workflowData.variables === 'object') {
        workflowVariables = Object.values(workflowData.variables).map((v: any) => ({
          id: v.id,
          name: v.name,
          type: v.type,
          value: v.value,
        }))
      }

      // Prepare export state
      workflowState = {
        blocks: normalizedData.blocks || {},
        edges: Array.isArray(normalizedData.edges) ? normalizedData.edges : [],
        loops: normalizedData.loops || {},
        parallels: normalizedData.parallels || {},
        metadata: {
          name: workflowData.name,
          description: workflowData.description ?? undefined,
          color: workflowData.color ?? undefined,
          exportedAt: new Date().toISOString(),
        },
        variables: workflowVariables,
      }
      
      logger.info(`[${requestId}] Loaded current state`, {
        blockCount: Object.keys(workflowState.blocks).length,
        edgeCount: workflowState.edges.length,
        variableCount: workflowVariables.length,
      })
    }

    // Sanitize for export
    const exportState = sanitizeForExport(workflowState)

    logger.info(`[${requestId}] Successfully exported workflow ${workflowId} (${sourceLabel}) for import`, {
      workflowName: workflowData.name,
      targetWorkspaceId,
      deploymentVersion: deploymentVersion ?? null,
      superUserId: session.user.id,
    })

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
      { error: 'Failed to import workflow', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

