import { createLogger } from '@sim/logger'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { submitReductoParse } from '@/lib/internal/reducto/client'
import { ReductoOperationError } from '@/lib/internal/reducto/errors'
import type { ReductoParseInput } from '@/lib/internal/reducto/input'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('ReductoOperations')

export interface ReductoOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId?: string
}

export async function executeReductoParse(
  input: ReductoParseInput,
  context: ReductoOperationContext
): Promise<{ success: true; output: unknown }> {
  context.signal?.throwIfAborted()
  if (!context.userId) {
    throw new ReductoOperationError(401, { success: false, error: 'Unauthorized' })
  }
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) {
    throw new ReductoOperationError(provenance.status, {
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
    throw new ReductoOperationError(resolution.error.status, {
      success: false,
      error: resolution.error.message,
    })
  }
  if (!resolution.fileUrl) {
    throw new ReductoOperationError(400, { success: false, error: 'File input is required' })
  }

  const body: Record<string, unknown> = { input: resolution.fileUrl }
  if (input.pages?.length) {
    let start = input.pages[0]
    let end = input.pages[0]
    for (const page of input.pages) {
      if (page < start) start = page
      if (page > end) end = page
    }
    body.settings = { page_range: { start, end } }
  }
  if (input.tableOutputFormat) {
    body.formatting = { table_output_format: input.tableOutputFormat }
  }

  const output = await submitReductoParse(input.apiKey, body, context.signal)
  context.signal?.throwIfAborted()
  return { success: true, output }
}
