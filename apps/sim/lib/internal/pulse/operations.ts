import { createLogger } from '@sim/logger'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { submitPulseParse } from '@/lib/internal/pulse/client'
import { PulseOperationError } from '@/lib/internal/pulse/errors'
import type { PulseParseInput } from '@/lib/internal/pulse/input'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('PulseOperations')

export interface PulseOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId?: string
}

export async function executePulseParse(
  input: PulseParseInput,
  context: PulseOperationContext
): Promise<{ success: true; output: unknown }> {
  context.signal?.throwIfAborted()
  if (!context.userId) {
    throw new PulseOperationError(401, { success: false, error: 'Unauthorized' })
  }
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) {
    throw new PulseOperationError(provenance.status, {
      success: false,
      error: provenance.error,
    })
  }

  const resolution = await resolveFileInputToUrl({
    file: input.file,
    filePath: input.filePath,
    userId: context.userId,
    requestId: context.requestId,
    logger,
    modelEgress: true,
  })
  context.signal?.throwIfAborted()
  if (resolution.error) {
    throw new PulseOperationError(resolution.error.status, {
      success: false,
      error: resolution.error.message,
    })
  }
  if (!resolution.fileUrl) {
    throw new PulseOperationError(400, { success: false, error: 'File input is required' })
  }

  const formData = new FormData()
  formData.append('file_url', resolution.fileUrl)
  if (input.pages) formData.append('pages', input.pages)
  if (input.extractFigure !== undefined) {
    formData.append('extract_figure', String(input.extractFigure))
  }
  if (input.figureDescription !== undefined) {
    formData.append('figure_description', String(input.figureDescription))
  }
  if (input.returnHtml !== undefined) formData.append('return_html', String(input.returnHtml))
  if (input.chunking) formData.append('chunking', input.chunking)
  if (input.chunkSize !== undefined) formData.append('chunk_size', String(input.chunkSize))

  const output = await submitPulseParse(input.apiKey, formData, context.signal)
  context.signal?.throwIfAborted()
  return { success: true, output }
}
