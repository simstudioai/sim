import { createLogger } from '@sim/logger'
import type { JupyterUploadBody } from '@/lib/api/contracts/storage-transfer'
import type { JupyterProxyBody } from '@/lib/api/contracts/tools/jupyter'
import { InvalidJupyterTargetError, requestJupyterApi } from '@/lib/internal/jupyter/client'
import { resolveJupyterUploadFile } from '@/lib/internal/jupyter/file-input'
import {
  assertSafeJupyterProxyPath,
  encodeJupyterPath,
  parseJupyterContentModel,
  UnsafeJupyterPathError,
} from '@/lib/internal/jupyter/protocol'

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
