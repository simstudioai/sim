import { createLogger } from '@sim/logger'
import { NextRequest } from 'next/server'
import {
  v2BulkDownloadFilesContract,
  v2DownloadFileContract,
  v2ListFileFoldersContract,
  v2ReadFileTextContract,
} from '@/lib/api/contracts/v2/files'
import {
  authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'
import { V2_PARSE_DEFAULTS } from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import {
  importWorkspaceFileSnapshotProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { presentWorkspaceFileText } from '@/lib/workspace-files/api/text-presenter'
import { downloadWorkspaceFileStream } from '@/lib/workspace-files/application/download-workspace-file'
import { readWorkspaceFileText } from '@/lib/workspace-files/application/read-workspace-file-text'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('MothershipFileReads')

/** Private file-read metadata stays in the authenticated host; the CLI consumes its usual wire shape. */
export function createFileReadTransport(context: {
  endpoint: string
  userId: string
  registry?: ResolvedSecretTraceRegistry
}): typeof fetch {
  const base = new URL(context.endpoint)
  const basePath = base.pathname.replace(/\/$/, '')
  const prefix = `${basePath}${v2DownloadFileContract.path.split('[fileId]')[0]}`
  const collectionPaths = new Set([
    `${basePath}${v2ListFileFoldersContract.path}`,
    `${basePath}${v2BulkDownloadFilesContract.path}`,
  ])
  const observe = async (workspaceId: string, provenance?: WorkspaceFileSecretProvenance) => {
    const imported =
      provenance &&
      (await importWorkspaceFileSnapshotProvenance({
        workspaceId,
        provenance,
        registry: context.registry,
        actorUserId: context.userId,
      }))
    if (!imported) context.registry?.markIncomplete('workspace-file-provenance-unknown')
  }

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (
      method !== 'GET' ||
      url.origin !== base.origin ||
      !url.pathname.startsWith(prefix) ||
      collectionPaths.has(url.pathname)
    ) {
      return fetch(input, init)
    }
    const match = /^([^/]+)(\/text)?$/.exec(url.pathname.slice(prefix.length))
    if (!match) return fetch(input, init)
    const request = new NextRequest(new Request(input, init))
    let stream: ReadableStream<Uint8Array> | undefined
    try {
      request.signal.throwIfAborted()
      const { principal } = await authenticateV2ApiKey(request.headers.get('x-api-key'))
      request.signal.throwIfAborted()
      if (principal.kind !== 'personal_api_key' || principal.userId !== context.userId) {
        throw new V2ApiKeyUnauthenticatedError()
      }
      if (!context.registry) {
        return Response.json(
          { error: { message: 'File read provenance is unavailable. Retry the read.' } },
          { status: 503 }
        )
      }
      const params = { fileId: decodeURIComponent(match[1] ?? '') }
      if (match[2]) {
        const parsed = await parseRequest(
          v2ReadFileTextContract,
          request,
          { params },
          V2_PARSE_DEFAULTS
        )
        if (!parsed.success) return parsed.response
        request.signal.throwIfAborted()
        const result = await readWorkspaceFileText.execute({
          principal,
          input: {
            workspaceId: parsed.data.query.workspaceId,
            reference: parsed.data.params.fileId,
            maxBytes: parsed.data.query.maxBytes,
            includeSecretProvenance: true,
          },
        })
        await observe(result.file.workspaceId, result.secretProvenance)
        request.signal.throwIfAborted()
        return Response.json(presentWorkspaceFileText(result))
      }
      const parsed = await parseRequest(
        v2DownloadFileContract,
        request,
        { params },
        V2_PARSE_DEFAULTS
      )
      if (!parsed.success) return parsed.response
      request.signal.throwIfAborted()
      const result = await downloadWorkspaceFileStream.execute({
        principal,
        input: {
          fileId: parsed.data.params.fileId,
          assertedWorkspaceId: parsed.data.query.workspaceId,
          includeSecretProvenance: true,
        },
      })
      stream = result.stream
      await observe(result.file.workspaceId, result.secretProvenance)
      request.signal.throwIfAborted()
      return new Response(stream.pipeThrough(new TransformStream(), { signal: request.signal }), {
        headers: {
          'content-type': result.contentType,
          'content-length': String(result.contentLength),
        },
      })
    } catch (error) {
      await stream?.cancel().catch(() => {})
      request.signal.throwIfAborted()
      if (error instanceof V2ApiKeyUnauthenticatedError) {
        return Response.json(
          { error: { code: 'UNAUTHORIZED', message: error.message } },
          { status: 401 }
        )
      }
      const response = v2FileErrorPolicies.concealResourceAuthorization.render(error)
      if (response) return response
      logger.error('File read failed', { error })
      return Response.json(
        { error: { message: 'The file could not be read. Retry the read.' } },
        { status: 500 }
      )
    }
  }
}
