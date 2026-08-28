import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import { jupyterUploadContract } from '@/lib/api/contracts/storage-transfer'
import { jupyterProxyContract } from '@/lib/api/contracts/tools/jupyter'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { executeJupyterProxy, executeJupyterUpload } from '@/lib/internal/jupyter/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const proxyLogger = createLogger('JupyterProxyAPI')
const uploadLogger = createLogger('JupyterUploadAPI')

export const JUPYTER_PROXY_TOOL_IDS = [
  'jupyter_copy_content',
  'jupyter_create_file',
  'jupyter_create_session',
  'jupyter_delete_content',
  'jupyter_delete_session',
  'jupyter_get_content',
  'jupyter_interrupt_kernel',
  'jupyter_list_contents',
  'jupyter_list_kernels',
  'jupyter_list_kernelspecs',
  'jupyter_list_sessions',
  'jupyter_rename_content',
  'jupyter_restart_kernel',
  'jupyter_start_kernel',
  'jupyter_stop_kernel',
] as const

const JUPYTER_PROXY_TOOL_ID_SET = new Set<string>(JUPYTER_PROXY_TOOL_IDS)

function parseJupyterBody<C extends AnyApiRouteContract>(contract: C, input: unknown) {
  return parseInternalToolInput(contract, input, {
    maxInputBytes: DEFAULT_MAX_JSON_BODY_BYTES,
  })
}

function unexpectedErrorResponse(
  scope: 'proxy' | 'upload',
  requestId: string,
  error: unknown,
  signal?: AbortSignal
): Response {
  signal?.throwIfAborted()
  const logger = scope === 'proxy' ? proxyLogger : uploadLogger
  logger.error(`[${requestId}] Unexpected error:`, error)
  return Response.json(
    { success: false, error: getErrorMessage(error, 'Unknown error') },
    { status: 500 }
  )
}

/** Executes every Jupyter tool without routing through the application's HTTP listener. */
export const executeJupyterTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  context,
  requestId,
  signal,
}) => {
  signal?.throwIfAborted()

  if (JUPYTER_PROXY_TOOL_ID_SET.has(toolId)) {
    const parsed = parseJupyterBody(jupyterProxyContract, input)
    if (!parsed.success) return parsed.response
    try {
      const response = await executeJupyterProxy(parsed.data, { requestId, signal })
      signal?.throwIfAborted()
      return response
    } catch (error) {
      return unexpectedErrorResponse('proxy', requestId, error, signal)
    }
  }

  if (toolId === 'jupyter_upload_file') {
    if (!context.userId) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const parsed = parseJupyterBody(jupyterUploadContract, input)
    if (!parsed.success) return parsed.response
    try {
      const response = await executeJupyterUpload(parsed.data, {
        userId: context.userId,
        requestId,
        signal,
      })
      signal?.throwIfAborted()
      return response
    } catch (error) {
      return unexpectedErrorResponse('upload', requestId, error, signal)
    }
  }

  return Response.json({ error: `Unsupported Jupyter tool: ${toolId}` }, { status: 500 })
}
