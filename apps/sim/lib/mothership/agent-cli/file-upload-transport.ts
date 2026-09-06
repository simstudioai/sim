import { createLogger } from '@sim/logger'
import { NextRequest } from 'next/server'
import {
  v2CompleteFileUploadContract,
  v2CreateFileUploadContract,
} from '@/lib/api/contracts/v2/files'
import {
  authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'
import { V2_PARSE_DEFAULTS } from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  completeWorkspaceFileUploadOperation,
  createWorkspaceFileUploadOperation,
} from '@/lib/uploads/upload-session/application'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'

const logger = createLogger('MothershipFileUploads')

/** Keep the public CLI protocol; private source evidence enters only the authorized application call. */
export function createFileUploadTransport(context: {
  endpoint: string
  workspaceId: string
  userId: string
  fallback: typeof fetch
  uploadProvenance: () => WorkspaceFileSecretProvenance
}): typeof fetch {
  const base = new URL(context.endpoint)
  const createPath = `${base.pathname.replace(/\/$/, '')}${v2CreateFileUploadContract.path}`
  const created = new Set<string>()
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const completing = url.pathname.startsWith(`${createPath}/`)
      ? /^([^/]+)\/complete$/.exec(url.pathname.slice(createPath.length + 1))
      : null
    if (
      url.origin !== base.origin ||
      method !== 'POST' ||
      (url.pathname !== createPath && !completing)
    ) {
      return context.fallback(input, init)
    }
    const request = new NextRequest(new Request(input, init))
    try {
      request.signal.throwIfAborted()
      const { principal } = await authenticateV2ApiKey(request.headers.get('x-api-key'))
      request.signal.throwIfAborted()
      if (principal.kind !== 'personal_api_key' || principal.userId !== context.userId) {
        throw new V2ApiKeyUnauthenticatedError()
      }
      if (!completing) {
        const parsed = await parseRequest(
          v2CreateFileUploadContract,
          request,
          {},
          V2_PARSE_DEFAULTS
        )
        if (!parsed.success) return parsed.response
        const body = parsed.data.body
        if (body.workspaceId !== context.workspaceId) throw new V2ApiKeyUnauthenticatedError()
        request.signal.throwIfAborted()
        const session = await createWorkspaceFileUploadOperation.execute({
          principal,
          input: { ...body, folderPath: body.folderPath ?? ROOT_FOLDER_PATH },
          request,
          secretProvenance: 'pending',
        })
        created.add(session.id)
        return Response.json({
          data: {
            session: await toV2FileUpload(session, null),
            uploadToken: session.uploadToken,
            transfer: session.transfer,
          },
        })
      }
      const params = { uploadId: decodeURIComponent(completing[1] ?? '') }
      const parsed = await parseRequest(
        v2CompleteFileUploadContract,
        request,
        { params },
        V2_PARSE_DEFAULTS
      )
      if (!parsed.success) return parsed.response
      if (!created.has(parsed.data.params.uploadId)) {
        throw new Error('Upload completion is not bound to this workbench invocation')
      }
      request.signal.throwIfAborted()
      const result = await completeWorkspaceFileUploadOperation.execute({
        principal,
        input: {
          uploadId: parsed.data.params.uploadId,
          workspaceId: parsed.data.query.workspaceId,
          uploadToken: parsed.data.headers['upload-token'],
        },
        request,
        secretProvenance: context.uploadProvenance(),
      })
      return Response.json({ data: await toV2FileUpload(result.session, result.value) })
    } catch (error) {
      request.signal.throwIfAborted()
      if (error instanceof V2ApiKeyUnauthenticatedError) {
        return Response.json(
          { error: { code: 'UNAUTHORIZED', message: error.message } },
          { status: 401 }
        )
      }
      const response = (
        completing ? v2FileErrorPolicies.concealUploadAuthorization : v2FileErrorPolicies.default
      ).render(error)
      if (response) return response
      logger.error('File upload control failed', { error })
      return Response.json(
        { error: { message: 'File upload control could not be completed.' } },
        { status: 500 }
      )
    }
  }
}
