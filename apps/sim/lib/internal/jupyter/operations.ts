import { createLogger } from '@sim/logger'
import type { JupyterUploadBody } from '@/lib/api/contracts/storage-transfer'
import type { JupyterProxyBody } from '@/lib/api/contracts/tools/jupyter'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  InvalidJupyterTargetError,
  requestJupyterApi,
  requestJupyterFile,
} from '@/lib/internal/jupyter/client'
import { resolveJupyterUploadFile } from '@/lib/internal/jupyter/file-input'
import {
  assertSafeJupyterProxyPath,
  encodeJupyterPath,
  parseJupyterContentModel,
  UnsafeJupyterPathError,
} from '@/lib/internal/jupyter/protocol'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import type { InternalToolOperationResult } from '@/lib/internal/tool-operations/types'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'

const uploadLogger = createLogger('JupyterUploadAPI')

export interface JupyterOperationContext {
  requestId: string
  signal?: AbortSignal
}

export interface JupyterUploadOperationContext extends JupyterOperationContext {
  userId: string
}

function validationErrorResponse(error: UnsafeJupyterPathError | InvalidJupyterTargetError) {
  return Response.json({ success: false, error: error.message }, { status: 400 })
}

/** Stores files before JSON presentation while preserving structured notebook and directory reads. */
export async function executeJupyterGetContent(
  input: Pick<JupyterProxyBody, 'serverUrl' | 'token' | 'path'>,
  context: JupyterOperationContext
): Promise<InternalToolOperationResult> {
  const { signal } = context
  signal?.throwIfAborted()
  const path = encodeJupyterPath(input.path)
  const auth = { serverUrl: input.serverUrl, token: input.token }
  const metadataResponse = await requestJupyterApi(
    { ...auth, method: 'GET', path: `contents/${path}?content=0` },
    signal
  )
  if (!metadataResponse.ok) return jupyterReadErrorResponse(metadataResponse, signal)
  const metadata = parseJupyterContentModel(
    await readResponseJsonWithLimit(metadataResponse, {
      maxBytes: MAX_JSON_API_RESPONSE_BYTES,
      label: 'Jupyter content metadata',
      signal,
    })
  )
  signal?.throwIfAborted()
  if (!metadata?.type) {
    return Response.json({ error: 'Jupyter returned an invalid content model' }, { status: 502 })
  }

  if (metadata.type === 'file') {
    if (metadata.size !== undefined && metadata.size > MAX_BUFFERED_TRANSFER_BYTES) {
      return Response.json(
        { error: 'Jupyter file exceeds the 100 MB download limit' },
        { status: 413 }
      )
    }
    const response = await requestJupyterFile(input, signal)
    if (!response.ok) return jupyterReadErrorResponse(response, signal)
    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      label: 'Jupyter file download',
      signal,
    })
    signal?.throwIfAborted()
    const name = metadata.name || input.path.split('/').filter(Boolean).at(-1) || 'file'
    const mimeType =
      response.headers.get('content-type')?.split(';')[0]?.trim() ||
      metadata.mimetype ||
      getMimeTypeFromExtension(getFileExtension(name))
    return createInternalToolFileResult({ buffer, name, mimeType }, (file) => ({
      success: true,
      output: { file },
    }))
  }

  const response = await requestJupyterApi(
    { ...auth, method: 'GET', path: `contents/${path}?content=1&type=${metadata.type}` },
    signal
  )
  if (!response.ok) return jupyterReadErrorResponse(response, signal)
  const data = parseJupyterContentModel(
    await readResponseJsonWithLimit(response, {
      maxBytes: MAX_JSON_API_RESPONSE_BYTES,
      label: 'Jupyter structured content',
      signal,
    })
  )
  signal?.throwIfAborted()
  if (data?.type !== metadata.type) {
    return Response.json({ error: 'Jupyter returned an invalid content model' }, { status: 502 })
  }
  const text =
    data.format === 'json' || typeof data.content === 'object'
      ? JSON.stringify(data.content)
      : typeof data.content === 'string'
        ? data.content
        : null
  return Response.json({
    success: true,
    output: {
      name: data.name ?? metadata.name ?? '',
      path: data.path ?? input.path,
      mimetype: data.mimetype ?? null,
      text,
      file: null,
    },
  })
}

async function jupyterReadErrorResponse(
  response: Awaited<ReturnType<typeof requestJupyterApi>>,
  signal?: AbortSignal
): Promise<Response> {
  const errorText = await readResponseTextWithLimit(response, {
    maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
    label: 'Jupyter read error',
    signal,
  })
  return Response.json(
    { error: `Jupyter API error: ${response.status} ${errorText}` },
    { status: response.status }
  )
}

/** Executes the shared Jupyter proxy contract and mirrors the upstream response verbatim. */
export async function executeJupyterProxy(
  input: JupyterProxyBody,
  context: JupyterOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  try {
    assertSafeJupyterProxyPath(input.path)
  } catch (error) {
    if (error instanceof UnsafeJupyterPathError) return validationErrorResponse(error)
    throw error
  }

  let upstream
  try {
    upstream = await requestJupyterApi(input, context.signal)
  } catch (error) {
    if (error instanceof InvalidJupyterTargetError) return validationErrorResponse(error)
    throw error
  }

  const text = await upstream.text()
  context.signal?.throwIfAborted()
  return new Response(text.length > 0 ? text : null, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  })
}

/** Resolves and uploads a file through Jupyter's Contents API. */
export async function executeJupyterUpload(
  input: JupyterUploadBody,
  context: JupyterUploadOperationContext
): Promise<Response> {
  const { requestId, signal } = context
  signal?.throwIfAborted()

  const file = await resolveJupyterUploadFile(input, {
    userId: context.userId,
    requestId,
    logger: uploadLogger,
    signal,
  })
  if (!file.success) return file.response

  if (/[/\\]/.test(file.fileName)) {
    return Response.json(
      { success: false, error: 'File name must not contain path separators' },
      { status: 400 }
    )
  }

  const destinationDirectory = (input.directory ?? '').replace(/\/+$/, '')
  const destinationPath = destinationDirectory
    ? `${destinationDirectory}/${file.fileName}`
    : file.fileName

  let encodedDestinationPath: string
  try {
    encodedDestinationPath = encodeJupyterPath(destinationPath)
  } catch (error) {
    if (error instanceof UnsafeJupyterPathError) return validationErrorResponse(error)
    throw error
  }

  let response
  try {
    response = await requestJupyterApi(
      {
        serverUrl: input.serverUrl,
        token: input.token,
        method: 'PUT',
        path: `contents/${encodedDestinationPath}`,
        body: {
          type: 'file',
          format: 'base64',
          content: file.buffer.toString('base64'),
        },
      },
      signal
    )
  } catch (error) {
    if (error instanceof InvalidJupyterTargetError) return validationErrorResponse(error)
    throw error
  }

  if (!response.ok) {
    const errorText = await response.text()
    signal?.throwIfAborted()
    uploadLogger.error(`[${requestId}] Jupyter API error:`, {
      status: response.status,
      errorText,
    })
    return Response.json(
      { success: false, error: `Jupyter API error: ${response.status} ${errorText}` },
      { status: response.status }
    )
  }

  const uploadedValue: unknown = await response.json()
  signal?.throwIfAborted()
  const uploaded = parseJupyterContentModel(uploadedValue)
  if (!uploaded) {
    uploadLogger.error(`[${requestId}] Jupyter returned an invalid upload response`)
    return Response.json(
      { success: false, error: 'Jupyter returned an invalid upload response' },
      { status: 502 }
    )
  }

  const uploadedName = uploaded.name ?? file.fileName
  const uploadedPath = uploaded.path ?? destinationPath
  const uploadedSize = uploaded.size ?? file.buffer.length
  const lastModified = uploaded.lastModified ?? null

  uploadLogger.info(`[${requestId}] File uploaded to Jupyter: ${uploadedPath}`)
  return Response.json({
    success: true,
    output: {
      name: uploadedName,
      path: uploadedPath,
      size: uploadedSize,
      lastModified,
    },
  })
}
