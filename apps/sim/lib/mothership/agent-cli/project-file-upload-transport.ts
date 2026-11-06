import { createLogger } from '@sim/logger'
import { NextRequest } from 'next/server'
import {
  v2CompleteProjectFileUploadContract,
  v2CreateProjectFileUploadContract,
} from '@/lib/api/contracts/v2/project-file-uploads'
import { V2_PARSE_DEFAULTS, v2InvalidBodyResponse } from '@/lib/api/server/routes/v2-json-route'
import { isV2ContractRoute } from '@/lib/api/server/routes/v2-route-pattern'
import { parseRequest } from '@/lib/api/server/validation'
import {
  matchProjectCliRoute,
  renderProjectCliFailure,
  throwIfCancelled,
} from '@/lib/mothership/agent-cli/project-file-transport'
import {
  type ProjectFileProvenanceOptions,
  requireCleanProjectFileMetadata,
} from '@/lib/mothership/agent-cli/project-file-write-provenance'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import { requireTrustedCopilotResourceExecutionContext } from '@/lib/mothership/auth/application-delegation'
import { toV2ProjectFileUpload } from '@/lib/projects/files/api/upload-presenter'
import {
  completeProjectFileUploadSession,
  createProjectFileUploadSession,
} from '@/lib/projects/files/application'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { v2Data, v2Error } from '@/app/api/v2/lib/response'

const logger = createLogger('ProjectFileUploadTransport')

/** Private control seals a streamed receipt only after the workbench observer has consumed its actual bytes. */
export function createProjectFileUploadTransport(
  options: ProjectFileProvenanceOptions & {
    endpoint: string
    projectId: string
    fallback: typeof fetch
    uploadProvenance?: () => WorkspaceFileSecretProvenance | Promise<WorkspaceFileSecretProvenance>
    uploadBinding?: {
      record(uploadId: string): Promise<void>
      contains(uploadId: string): Promise<boolean>
    }
  }
): typeof fetch {
  const { context, projectId, fallback, uploadProvenance } = options
  const origin = new URL(options.endpoint).origin
  const created = new Set<string>()
  return async (input, init) => {
    const originalRequest = new Request(input, init)
    const route = matchProjectCliRoute(originalRequest, origin, projectId)
    if (route instanceof Response) return route
    const creating = isV2ContractRoute(
      originalRequest.method,
      route,
      v2CreateProjectFileUploadContract
    )
    const completing = isV2ContractRoute(
      originalRequest.method,
      route,
      v2CompleteProjectFileUploadContract
    )
    if (!creating && !completing) return fallback(originalRequest)
    const request = new NextRequest(originalRequest)
    try {
      requireTrustedCopilotResourceExecutionContext(context)
    } catch {
      return v2Error('FORBIDDEN', 'Project file authority is unavailable')
    }
    try {
      throwIfCancelled(context.signal, request.signal)
      if (creating) {
        const parsed = await parseRequest(
          v2CreateProjectFileUploadContract,
          request,
          { params: route.params },
          { ...V2_PARSE_DEFAULTS, invalidJsonResponse: () => v2InvalidBodyResponse(request) }
        )
        if (!parsed.success) return parsed.response
        const { body } = parsed.data
        await requireCleanProjectFileMetadata(body, options)
        throwIfCancelled(context.signal, request.signal)
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
        await options.uploadBinding?.record(session.id)
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
      const bound = options.uploadBinding
        ? await options.uploadBinding.contains(parsed.data.params.uploadId)
        : created.has(parsed.data.params.uploadId)
      if (!bound) {
        return v2Error('FORBIDDEN', 'Upload completion is not bound to this invocation')
      }
      let secretProvenance: WorkspaceFileSecretProvenance | undefined
      try {
        secretProvenance = await uploadProvenance?.()
      } catch {
        throwIfCancelled(context.signal, request.signal)
      }
      if (!secretProvenance) {
        return v2Error('SERVICE_UNAVAILABLE', 'Workbench upload source has not finished streaming')
      }
      throwIfCancelled(context.signal, request.signal)
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
      return renderProjectCliFailure(error, [context.signal, request.signal], logger, {
        log: 'Project upload control failed',
        message: 'Project upload control could not be completed',
      })
    }
  }
}
