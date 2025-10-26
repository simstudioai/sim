import { apiKey, db, workflow, workflowDeploymentVersion } from '@sim/db'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowActivateDeploymentAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const versionNum = Number(version)
    if (!Number.isFinite(versionNum)) {
      return createErrorResponse('Invalid version', 400)
    }

    let providedApiKey: string | null = null
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed.apiKey === 'string' && parsed.apiKey.trim().length > 0) {
        providedApiKey = parsed.apiKey.trim()
      }
    } catch (_err) {}

    let pinnedApiKeyId: string | null = null
    if (providedApiKey) {
      const currentUserId = session?.user?.id
      if (currentUserId) {
        const [personalKey] = await db
          .select({ id: apiKey.id })
          .from(apiKey)
          .where(
            and(
              eq(apiKey.id, providedApiKey),
              eq(apiKey.userId, currentUserId),
              eq(apiKey.type, 'personal')
            )
          )
          .limit(1)

        if (personalKey) {
          pinnedApiKeyId = personalKey.id
        } else if (workflowData!.workspaceId) {
          const [workspaceKey] = await db
            .select({ id: apiKey.id })
            .from(apiKey)
            .where(
              and(
                eq(apiKey.id, providedApiKey),
                eq(apiKey.workspaceId, workflowData!.workspaceId),
                eq(apiKey.type, 'workspace')
              )
            )
            .limit(1)

          if (workspaceKey) {
            pinnedApiKeyId = workspaceKey.id
          }
        }
      }
    }

    const now = new Date()

    await db.transaction(async (tx) => {
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )

      const updated = await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: true })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.version, versionNum)
          )
        )
        .returning({ id: workflowDeploymentVersion.id })

      if (updated.length === 0) {
        throw new Error('Deployment version not found')
      }

      const updateData: Record<string, unknown> = {
        isDeployed: true,
        deployedAt: now,
      }

      if (pinnedApiKeyId) {
        updateData.pinnedApiKeyId = pinnedApiKeyId
      }

      await tx.update(workflow).set(updateData).where(eq(workflow.id, id))
    })

    return createSuccessResponse({ success: true, deployedAt: now })
  } catch (error: any) {
    logger.error(`[${requestId}] Error activating deployment for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to activate deployment', 500)
  }
}
