/**
 * Export workflow as standalone Python/FastAPI service.
 *
 * This endpoint generates a ZIP file containing a self-contained Python service
 * that can execute the workflow independently of Sim Studio.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { createLogger } from '@sim/logger'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'

import { validateWorkflowForExport } from './validate'
import { preTranspileWorkflow } from './transpile'
import { generateServiceZip, getServiceName, type WorkflowVariable } from './generate-zip'

const logger = createLogger('ExportService')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workflowId } = await params

    // Authenticate - support both session and API key
    const session = await getSession()
    let userId: string | null = session?.user?.id || null

    if (!userId) {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        const authResult = await authenticateApiKeyFromHeader(apiKeyHeader)
        if (authResult.success && authResult.userId) {
          userId = authResult.userId
          if (authResult.keyId) {
            await updateApiKeyLastUsed(authResult.keyId).catch((error) => {
              logger.warn('Failed to update API key last used timestamp:', { error })
            })
          }
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get workflow
    const [workflowRow] = await db
      .select()
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)

    if (!workflowRow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const workspaceId = workflowRow.workspaceId

    // Build headers for internal API calls - pass through auth
    const internalHeaders: Record<string, string> = {}
    const cookie = request.headers.get('cookie')
    const apiKey = request.headers.get('x-api-key')
    if (cookie) internalHeaders['cookie'] = cookie
    if (apiKey) internalHeaders['x-api-key'] = apiKey

    // Get workflow state
    const stateResponse = await fetch(
      `${request.nextUrl.origin}/api/workflows/${workflowId}`,
      { headers: internalHeaders }
    )

    if (!stateResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch workflow state' }, { status: 500 })
    }

    const { data: workflowData } = await stateResponse.json()

    // Validate workflow for export compatibility
    const validationResult = validateWorkflowForExport(workflowData.state)
    if (!validationResult.valid) {
      return NextResponse.json(
        {
          error: 'Workflow contains unsupported features for export',
          unsupportedBlocks: validationResult.unsupportedBlocks,
          unsupportedProviders: validationResult.unsupportedProviders,
          message: validationResult.message,
        },
        { status: 400 }
      )
    }

    // Get workflow variables
    const variablesResponse = await fetch(
      `${request.nextUrl.origin}/api/workflows/${workflowId}/variables`,
      { headers: internalHeaders }
    )

    let workflowVariables: WorkflowVariable[] = []
    if (variablesResponse.ok) {
      const varsData = (await variablesResponse.json()) as {
        data?: Record<string, WorkflowVariable>
      }
      workflowVariables = Object.values(varsData?.data ?? {}).map((v) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        value: v.value,
      }))
    }

    // Get decrypted environment variables
    const decryptedEnv = await getEffectiveDecryptedEnv(userId, workspaceId ?? undefined)

    // Build workflow.json - pre-transpile JavaScript to Python at export time
    const sanitizedState = sanitizeForExport({
      ...workflowData.state,
      metadata: {
        name: workflowRow.name,
        description: workflowRow.description,
        exportedAt: new Date().toISOString(),
      },
      variables: workflowVariables,
    })
    const workflowState = preTranspileWorkflow(sanitizedState as unknown as Record<string, unknown>)

    // Generate ZIP
    const zipBuffer = await generateServiceZip({
      workflowName: workflowRow.name,
      workflowState,
      decryptedEnv,
      workflowVariables,
    })

    const serviceName = getServiceName(workflowRow.name)

    logger.info('Exported workflow as service', {
      workflowId,
      serviceName,
      envVarsCount: Object.keys(decryptedEnv).length,
    })

    return new NextResponse(zipBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${serviceName}-service.zip"`,
      },
    })
  } catch (error) {
    logger.error('Failed to export service:', error)
    return NextResponse.json({ error: 'Failed to export service' }, { status: 500 })
  }
}
