import { createLogger } from '@sim/logger'
import { NextRequest } from 'next/server'
import { v2DownloadFileContract, v2ReadFileTextContract } from '@/lib/api/contracts/v2/files'
import type { MatchedRoute } from '@/lib/api/server/routes/in-process-transport'
import { V2_PARSE_DEFAULTS } from '@/lib/api/server/routes/v2-json-route'
import { tryMatchV2Route, v2RoutePattern } from '@/lib/api/server/routes/v2-route-pattern'
import { parseRequest } from '@/lib/api/server/validation'
import { observeContentDelivery } from '@/lib/core/application'
import {
  type CopilotChatDelegationContext,
  createCopilotChatPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { presentWorkspaceFileText } from '@/lib/workspace-files/api/text-presenter'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { downloadWorkspaceFileStream } from '@/lib/workspace-files/application/download-workspace-file'
import { readWorkspaceFileText } from '@/lib/workspace-files/application/read-workspace-file-text'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('MothershipFileReads')

const DOWNLOAD_PATTERN = v2RoutePattern(v2DownloadFileContract)
const TEXT_PATTERN = v2RoutePattern(v2ReadFileTextContract)

/**
 * Answers the two single-file reads Chat needs beyond their public routes — a chat upload by its
 * `uploads/` reference and plain source decoded as text — by calling their use cases directly.
 * Every other request, file collections included, goes to the route the generated table names.
 *
 * Classification is not decided here: the gate the caller installed decides each file. A direct
 * download alone takes the single-file exception (D7): an unknown file is delivered with the whole
 * invocation withheld, and the workbench copy keeps the unknown classification.
 */
export function createFileReadTransport(context: {
  endpoint: string
  transport: typeof fetch
  invocation: CopilotChatDelegationContext & { workspaceId: string }
  registry?: ResolvedSecretTraceRegistry
  tracksWorkbenchDownloads?: boolean
}): typeof fetch {
  const base = new URL(context.endpoint)
  const basePath = base.pathname.replace(/\/$/, '')

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    /** A malformed percent encoding names no file; the route answers it. */
    const route: MatchedRoute | null =
      method === 'GET' && url.origin === base.origin && url.pathname.startsWith(`${basePath}/`)
        ? tryMatchV2Route(url.pathname.slice(basePath.length))
        : null
    if (!route || (route.pattern !== DOWNLOAD_PATTERN && route.pattern !== TEXT_PATTERN)) {
      return context.transport(input, init)
    }
    const request = new NextRequest(new Request(input, init))
    let stream: ReadableStream<Uint8Array> | undefined
    try {
      request.signal.throwIfAborted()
      const principal = createCopilotChatPrincipal(
        context.invocation,
        WORKSPACE_FILES_DELEGATION_AUDIENCE
      )
      const params = { fileId: route.params.fileId ?? '' }
      if (route.pattern === TEXT_PATTERN) {
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
            ...(context.invocation.chatId !== undefined
              ? { chatId: context.invocation.chatId }
              : {}),
            maxBytes: parsed.data.query.maxBytes,
            offset: parsed.data.query.offset,
            limit: parsed.data.query.limit,
            allowPlainText: true,
          },
        })
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
      const result = await observeContentDelivery(
        createRegistryContentGate({
          registry: context.registry,
          workspaceId: parsed.data.query.workspaceId,
          actorUserId: context.invocation.userId,
          unknown: 'taint',
          destination: context.tracksWorkbenchDownloads ? 'workbench' : 'model',
        }),
        () =>
          downloadWorkspaceFileStream.execute({
            principal,
            input: {
              fileId: parsed.data.params.fileId,
              assertedWorkspaceId: parsed.data.query.workspaceId,
            },
          })
      )
      stream = result.stream
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
