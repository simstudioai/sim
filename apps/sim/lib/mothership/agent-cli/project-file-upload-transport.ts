import { createLogger } from '@sim/logger'
import { NextRequest } from 'next/server'
import {
  v2CompleteProjectFileUploadContract,
  v2CreateProjectFileUploadContract,
} from '@/lib/api/contracts/v2/project-file-uploads'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import {
  V2_PARSE_DEFAULTS,
  v2InvalidBodyResponse,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import { requireTrustedCopilotResourceExecutionContext } from '@/lib/mothership/auth/application-delegation'
import { toV2ProjectFileUpload } from '@/lib/projects/files/api/upload-presenter'
import {
  completeProjectFileUploadSession,
  createProjectFileUploadSession,
} from '@/lib/projects/files/application'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'

const logger = createLogger('ProjectFileUploadTransport')
const UPLOADS_ROUTE = '/api/v2/projects/{projectId}/files/uploads'

/** Private control seals a streamed receipt only after the workbench observer has consumed its actual bytes. */
export function createProjectFileUploadTransport(options: {
  endpoint: string
  projectId: string
  context: AgentCliExecutionContext
  fallback: typeof fetch
  uploadProvenance?: () => WorkspaceFileSecretProvenance
}): typeof fetch {
  const { context, projectId, fallback, uploadProvenance } = options
  const origin = new URL(options.endpoint).origin
  const created = new Set<string>()
  return async (input, init) => {
    const originalRequest = new Request(input, init)
    const url = new URL(originalRequest.url)
    let route: ReturnType<typeof matchV2Route>
    try {
      route = matchV2Route(url.pathname)
    } catch {
      return v2Error('BAD_REQUEST', 'CLI target is unavailable')
    }
    if (url.origin !== origin || !route || route.params.projectId !== projectId) {
      return v2Error('BAD_REQUEST', 'CLI target is unavailable')
    }
    const creating = originalRequest.method === 'POST' && route.pattern === UPLOADS_ROUTE
    const completing =
      originalRequest.method === 'POST' && route.pattern === `${UPLOADS_ROUTE}/{uploadId}/complete`
    if (!creating && !completing) return fallback(originalRequest)
    const request = new NextRequest(originalRequest)
    try {
      requireTrustedCopilotResourceExecutionContext(context)
    } catch {
      return v2Error('FORBIDDEN', 'Project file authority is unavailable')
    }
    try {
      context.signal?.throwIfAborted()
      request.signal.throwIfAborted()
      if (creating) {
        const parsed = await parseRequest(
          v2CreateProjectFileUploadContract,
          request,
          { params: route.params },
          { ...V2_PARSE_DEFAULTS, invalidJsonResponse: () => v2InvalidBodyResponse(request) }
        )
        if (!parsed.success) return parsed.response
        const { body } = parsed.data
        const session = await executeCopilotProjectFileUseCase(
          context,
          createProjectFileUploadSession,
          {
            projectId,
            fileName: body.name,
            contentType: body.contentType,
            fileSize: body.size,
            folderId: body.folderId,
            folderPath: body.folderPath,
            localOrigin: origin,
            secretProvenance: 'pending',
          },
          { projectId }
        )
        created.add(session.id)
        return v2Data(
          {
            session: toV2ProjectFileUpload(session, null),
            uploadToken: session.uploadToken,
            transfer: session.transfer,
          },
          { status: 201 }
        )
      }
      const parsed = await parseRequest(
        v2CompleteProjectFileUploadContract,
        request,
        { params: route.params },
        V2_PARSE_DEFAULTS
      )
      if (!parsed.success) return parsed.response
      if (!created.has(parsed.data.params.uploadId)) {
        return v2Error('FORBIDDEN', 'Upload completion is not bound to this invocation')
      }
      let secretProvenance: WorkspaceFileSecretProvenance | undefined
      try {
        secretProvenance = uploadProvenance?.()
      } catch {
        context.signal?.throwIfAborted()
        request.signal.throwIfAborted()
      }
      if (!secretProvenance) {
        return v2Error('SERVICE_UNAVAILABLE', 'Workbench upload source has not finished streaming')
      }
      const result = await executeCopilotProjectFileUseCase(
        context,
        completeProjectFileUploadSession,
        {
          projectId,
          uploadId: parsed.data.params.uploadId,
          uploadToken: parsed.data.headers['upload-token'],
          secretProvenance,
        },
        { projectId }
      )
      return v2Data(toV2ProjectFileUpload(result.session, result.value.file))
    } catch (error) {
      context.signal?.throwIfAborted()
      request.signal.throwIfAborted()
      const response = v2OrchestrationErrorPolicy.render(error)
      if (response) return response
      logger.error('Project upload control failed', { error })
      return v2Error('INTERNAL_ERROR', 'Project upload control could not be completed')
    }
  }
}
