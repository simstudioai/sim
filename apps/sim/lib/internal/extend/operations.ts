import { createLogger } from '@sim/logger'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { submitExtendParse } from '@/lib/internal/extend/client'
import { ExtendOperationError } from '@/lib/internal/extend/errors'
import type { ExtendParseInput } from '@/lib/internal/extend/input'
import { resolveFileInputToUrl } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('ExtendOperations')

export interface ExtendOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId?: string
}

export async function executeExtendParse(
  input: ExtendParseInput,
  context: ExtendOperationContext
): Promise<{ success: true; output: Record<string, unknown> }> {
  context.signal?.throwIfAborted()
  if (!context.userId) {
    throw new ExtendOperationError(401, { success: false, error: 'Unauthorized' })
  }
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) {
    throw new ExtendOperationError(provenance.status, {
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
    throw new ExtendOperationError(resolution.error.status, {
      success: false,
      error: resolution.error.message,
    })
  }
  if (!resolution.fileUrl) {
    throw new ExtendOperationError(400, { success: false, error: 'File input is required' })
  }

  const body: Record<string, unknown> = { file: { fileUrl: resolution.fileUrl } }
  const config: Record<string, unknown> = {}
  if (input.outputFormat) config.target = input.outputFormat
  if (input.chunking) config.chunkingStrategy = { type: input.chunking }
  if (input.engine) config.engine = input.engine
  if (Object.keys(config).length) body.config = config

  const data = await submitExtendParse(input.apiKey, body, context.signal)
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: {
      id: data.id ?? null,
      status: data.status ?? 'PROCESSED',
      chunks: data.chunks ?? [],
      blocks: data.blocks ?? [],
      pageCount: data.pageCount ?? data.page_count ?? null,
      creditsUsed: data.creditsUsed ?? data.credits_used ?? null,
    },
  }
}
