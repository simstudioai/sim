import { db } from '@sim/db'
import {
  appPreviewSession,
  appProject,
  appRelease,
  workflow,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import {
  parseExecutionFileKey,
  resolveSafeContentType,
  verifyAppsFileCapability,
} from '@/lib/apps/file-capability'
import { requireAppsHopFromRequest } from '@/lib/apps/hop-proof'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { downloadExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-manager'
import { createErrorResponse } from '@/app/api/workflows/utils'
import type { UserFile } from '@/executor/types'

const logger = createLogger('AppsGatewayFiles')

const MAX_FILE_BYTES = 25 * 1024 * 1024

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const hop = await requireAppsHopFromRequest(request)
    if (!hop.ok) {
      return createErrorResponse(hop.message, hop.status)
    }

    const { token: rawToken } = await context.params
    const token = decodeURIComponent(rawToken || '')
    const verified = verifyAppsFileCapability(token)
    if (!verified.ok) {
      return createErrorResponse('File capability invalid or expired', 403, 'FILE_CAPABILITY_INVALID')
    }

    const claims = verified.claims
    const keyParts = parseExecutionFileKey(claims.fileKey)
    if (
      !keyParts ||
      keyParts.workspaceId !== claims.workspaceId ||
      keyParts.workflowId !== claims.workflowId ||
      keyParts.executionId !== claims.executionId
    ) {
      return createErrorResponse('File capability ownership mismatch', 403, 'FILE_OWNERSHIP_MISMATCH')
    }

    const [wf] = await db
      .select({
        id: workflow.id,
        workspaceId: workflow.workspaceId,
        archivedAt: workflow.archivedAt,
      })
      .from(workflow)
      .where(eq(workflow.id, claims.workflowId))
      .limit(1)

    if (!wf || wf.archivedAt || wf.workspaceId !== claims.workspaceId) {
      return createErrorResponse('File is not available', 404)
    }

    const [ws] = await db
      .select({ id: workspace.id, archivedAt: workspace.archivedAt })
      .from(workspace)
      .where(eq(workspace.id, claims.workspaceId))
      .limit(1)

    if (!ws || ws.archivedAt) {
      return createErrorResponse('File is not available', 404)
    }

    if (claims.releaseId) {
      const [release] = await db
        .select({
          id: appRelease.id,
          projectId: appRelease.projectId,
          state: appRelease.state,
          revokedAt: appRelease.revokedAt,
        })
        .from(appRelease)
        .where(eq(appRelease.id, claims.releaseId))
        .limit(1)

      if (!release || release.state !== 'published' || release.revokedAt) {
        return createErrorResponse('File is not available', 404)
      }

      const [project] = await db
        .select({
          id: appProject.id,
          workspaceId: appProject.workspaceId,
          publishedReleaseId: appProject.publishedReleaseId,
          archivedAt: appProject.archivedAt,
        })
        .from(appProject)
        .where(and(eq(appProject.id, release.projectId), isNull(appProject.archivedAt)))
        .limit(1)

      if (
        !project ||
        project.workspaceId !== claims.workspaceId ||
        project.publishedReleaseId !== claims.releaseId ||
        (claims.projectId && claims.projectId !== project.id)
      ) {
        return createErrorResponse('File is not available', 404)
      }
    } else if (claims.previewSessionId) {
      const [preview] = await db
        .select({
          id: appPreviewSession.id,
          projectId: appPreviewSession.projectId,
          expiresAt: appPreviewSession.expiresAt,
          stoppedAt: appPreviewSession.stoppedAt,
        })
        .from(appPreviewSession)
        .where(eq(appPreviewSession.id, claims.previewSessionId))
        .limit(1)

      if (!preview || preview.stoppedAt || preview.expiresAt.getTime() < Date.now()) {
        return createErrorResponse('File is not available', 404)
      }

      const [project] = await db
        .select({
          id: appProject.id,
          workspaceId: appProject.workspaceId,
          archivedAt: appProject.archivedAt,
        })
        .from(appProject)
        .where(and(eq(appProject.id, preview.projectId), isNull(appProject.archivedAt)))
        .limit(1)

      if (
        !project ||
        project.workspaceId !== claims.workspaceId ||
        (claims.projectId && claims.projectId !== project.id)
      ) {
        return createErrorResponse('File is not available', 404)
      }
    } else {
      // Require an active Apps context (published release or preview session).
      return createErrorResponse('File is not available', 404)
    }

    try {
      const userFile = {
        id: `cap_${claims.executionId}`,
        name: claims.name,
        url: '',
        size: claims.size,
        type: claims.mimeType,
        key: claims.fileKey,
        context: 'execution',
      } satisfies UserFile

      const buffer = await downloadExecutionFile(userFile, { maxBytes: MAX_FILE_BYTES })
      const contentType = resolveSafeContentType(claims.mimeType, buffer)
      if (!contentType) {
        return createErrorResponse('File content type mismatch', 415, 'CONTENT_TYPE_MISMATCH')
      }

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'content-type': contentType,
          'content-length': String(buffer.length),
          'cache-control': 'private, max-age=60',
          'x-content-type-options': 'nosniff',
          'content-disposition': `inline; filename="${claims.name.replace(/"/g, '')}"`,
        },
      })
    } catch (error) {
      logger.warn('Failed to stream Apps execution file', { error, fileKey: claims.fileKey })
      return createErrorResponse('File is not available', 404)
    }
  }
)
