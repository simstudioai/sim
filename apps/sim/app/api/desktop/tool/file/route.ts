import { BROWSER_FILE_TRANSFER_MAX_BYTES } from '@sim/browser-protocol'
import { type NextRequest, NextResponse } from 'next/server'
import {
  readBrowserUploadFileContract,
  saveBrowserDownloadContract,
} from '@/lib/api/contracts/desktop-browser-files'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalBinaryRoute,
  InternalUnauthenticatedError,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { withRequestId } from '@/lib/api/server/routes/request-id'
import {
  readBrowserUploadFile,
  saveBrowserDownload,
} from '@/lib/browser-agent/application/browser-file-transfer'
import { PayloadSizeLimitError, readStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { workspaceFileVfsPath } from '@/lib/uploads/contexts/workspace'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { encodeFilenameForHeader } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

/**
 * POST /api/desktop/tool/file
 *
 * The desktop main process fetches one file a claimed `browser_upload_file` call attaches to a
 * page. The call's persisted arguments name the file; the request only picks which of them.
 */
export const POST = defineInternalBinaryRoute({
  contract: readBrowserUploadFileContract,
  auth: internalSessionAuth,
  operation: readBrowserUploadFile.operation,
  rateLimit: internalRateLimits.none({
    reason: 'One read per file of a claimed, single-use browser tool call',
  }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ body }) => ({ toolCallId: body.toolCallId, index: body.index }),
  useCase: readBrowserUploadFile,
  present: ({ file, content }) => ({
    body: new Uint8Array(content.buffer as ArrayBuffer, content.byteOffset, content.byteLength),
    contentType: 'application/octet-stream',
    contentDisposition: `attachment; ${encodeFilenameForHeader(file.name)}`,
    contentLength: content.byteLength,
  }),
})

/**
 * PUT /api/desktop/tool/file?toolCallId=…&name=…
 *
 * Raw `withRouteHandler`: the body is the download's bytes, so it is admitted by declared length
 * and read under a byte ceiling only after the session is authenticated, then handed to the
 * application use case that binds it to its claimed `browser_save_download` call.
 */
export const PUT = withRouteHandler(async (request: NextRequest) => {
  let principal
  try {
    principal = await internalSessionAuth.authenticate()
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError) {
      return NextResponse.json(withRequestId({ error: error.message }), { status: 401 })
    }
    throw error
  }
  const declaredLength = Number(request.headers.get('content-length'))
  if (!Number.isFinite(declaredLength) || declaredLength > BROWSER_FILE_TRANSFER_MAX_BYTES) {
    return NextResponse.json(withRequestId({ error: 'Download is too large to save' }), {
      status: 413,
    })
  }
  const parsed = await parseRequest(saveBrowserDownloadContract, request, {})
  if (!parsed.success) return parsed.response

  let content: Buffer
  try {
    content = await readStreamToBufferWithLimit(request.body, {
      maxBytes: BROWSER_FILE_TRANSFER_MAX_BYTES,
      label: 'Browser download',
      signal: request.signal,
    })
  } catch (error) {
    if (error instanceof PayloadSizeLimitError) {
      return NextResponse.json(withRequestId({ error: 'Download is too large to save' }), {
        status: 413,
      })
    }
    throw error
  }

  try {
    const { file } = await saveBrowserDownload.execute({
      principal,
      input: { toolCallId: parsed.data.query.toolCallId, name: parsed.data.query.name, content },
      request,
    })
    return NextResponse.json({ path: workspaceFileVfsPath(file), name: file.name, size: file.size })
  } catch (error) {
    const response = internalFileErrorPolicies.concealContentAuthorization.project(error)
    if (!response) throw error
    return NextResponse.json(withRequestId(response.body), {
      status: response.status,
      headers: response.headers,
    })
  }
})
