import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import type { FirecrawlParseInput } from '@/lib/internal/firecrawl/schema'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { hasFirecrawlParseModelInput } from '@/tools/firecrawl/model-input'

const logger = createLogger('FirecrawlParse')

export interface FirecrawlOperationContext {
  headers: Headers
  userId: string
  requestId: string
  signal?: AbortSignal
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

export async function executeFirecrawlParse(
  input: FirecrawlParseInput,
  context: FirecrawlOperationContext
): Promise<Response> {
  try {
    context.signal?.throwIfAborted()
    const hasModelInput = hasFirecrawlParseModelInput({
      file: input.file,
      formats: Array.isArray(input.options?.formats) ? input.options.formats : undefined,
      parsers: Array.isArray(input.options?.parsers) ? input.options.parsers : undefined,
    })
    if (hasModelInput) {
      const provenance = validateOpaqueModelInputProvenance({
        headers: context.headers,
        payload: input,
        isInternalRequest: true,
      })
      if (!provenance.success) return failureResponse(provenance.error, provenance.status)
    }

    const userFile = processFilesToUserFiles([input.file], context.requestId, logger)[0]
    if (!userFile) return failureResponse('File input is required', 400)

    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) return denied
    if (hasModelInput && !(await isModelSafeWorkspaceFileKey(userFile.key))) {
      return failureResponse(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE, 400)
    }

    const { buffer, contentType } = await downloadServableFileFromStorage(
      userFile,
      context.requestId,
      logger,
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES, signal: context.signal }
    )
    const formData = new FormData()
    formData.append(
      'file',
      new Blob([new Uint8Array(buffer)], {
        type: contentType || userFile.type || 'application/octet-stream',
      }),
      userFile.name
    )
    if (input.options && Object.keys(input.options).length > 0) {
      formData.append('options', JSON.stringify(input.options))
    }

    const response = await fetch('https://api.firecrawl.dev/v2/parse', {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: formData,
      signal: context.signal,
    })
    if (!response.ok) {
      const errorText = await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Firecrawl error response',
        signal: context.signal,
      })
      return failureResponse(
        `Firecrawl API error: ${errorText || response.statusText}`,
        response.status
      )
    }

    const data = await readResponseJsonWithLimit<Record<string, unknown>>(response, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      label: 'Firecrawl parse response',
      signal: context.signal,
    })
    const nested = data.data
    const document = nested && typeof nested === 'object' ? nested : data
    return Response.json({
      success: true,
      output:
        data.creditsUsed != null
          ? { ...(document as Record<string, unknown>), creditsUsed: data.creditsUsed }
          : document,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    logger.error(`[${context.requestId}] Firecrawl parse failed`, {
      error: getErrorMessage(error),
    })
    return failureResponse(
      getErrorMessage(error, 'Internal server error'),
      isPayloadSizeLimitError(error) ? 413 : 500
    )
  }
}
