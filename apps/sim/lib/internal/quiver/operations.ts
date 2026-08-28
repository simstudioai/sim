import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { requestQuiverSvg } from '@/lib/internal/quiver/client'
import { QuiverOperationError } from '@/lib/internal/quiver/errors'
import type { QuiverImageToSvgInput, QuiverTextToSvgInput } from '@/lib/internal/quiver/schema'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('QuiverOperations')

export interface QuiverOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId: string
}

interface QuiverFile {
  name: string
  mimeType: 'image/svg+xml'
  data: string
  size: number
}

interface QuiverUsage {
  totalTokens: number
  inputTokens: number
  outputTokens: number
}

export interface QuiverSvgOutput {
  success: true
  output: {
    file: QuiverFile
    files: QuiverFile[]
    svgContent: string
    id: string | null
    usage: QuiverUsage | null
  }
}

type ApiImage = { url: string } | { base64: string }

function fail(message: string, status: number, body?: Record<string, unknown>): never {
  throw new QuiverOperationError(message, status, body)
}

function record(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? value : {}
}

function optionalNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function validateProvenance(input: Record<string, unknown>, context: QuiverOperationContext): void {
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) fail(provenance.error, provenance.status)
}

async function deniedBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  return isRecordLike(body) ? body : { success: false, error: 'File not found' }
}

async function storedFileToBase64(
  input: RawFileInput,
  context: QuiverOperationContext,
  maxBytes: number
): Promise<{ base64: string; size: number } | null> {
  const files = processFilesToUserFiles([input], context.requestId, logger)
  const file = files[0]
  if (!file) return null

  context.signal?.throwIfAborted()
  const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) fail('File not found', denied.status, await deniedBody(denied))
  if (!(await isModelSafeWorkspaceFileKey(file.key))) {
    fail(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE, 400)
  }
  context.signal?.throwIfAborted()
  const buffer = await downloadFileFromStorage(file, context.requestId, logger, { maxBytes })
  context.signal?.throwIfAborted()
  return { base64: buffer.toString('base64'), size: buffer.length }
}

async function resolveReference(
  reference: unknown,
  context: QuiverOperationContext,
  maxBytes: number
): Promise<{ image?: ApiImage; size: number }> {
  if (typeof reference === 'string') {
    try {
      const parsed: unknown = JSON.parse(reference)
      if (parsed && typeof parsed === 'object') {
        const file = await storedFileToBase64(parsed as RawFileInput, context, maxBytes)
        return file ? { image: { base64: file.base64 }, size: file.size } : { size: 0 }
      }
      return { size: 0 }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (error instanceof QuiverOperationError) throw error
      return { image: { url: reference }, size: 0 }
    }
  }
  if (reference && typeof reference === 'object') {
    const file = await storedFileToBase64(reference as RawFileInput, context, maxBytes)
    return file ? { image: { base64: file.base64 }, size: file.size } : { size: 0 }
  }
  return { size: 0 }
}

async function resolveImage(
  image: QuiverImageToSvgInput['image'],
  context: QuiverOperationContext
): Promise<ApiImage> {
  if (typeof image === 'string') {
    try {
      const parsed: unknown = JSON.parse(image)
      if (parsed && typeof parsed === 'object') {
        const file = await storedFileToBase64(
          parsed as RawFileInput,
          context,
          MAX_BUFFERED_TRANSFER_BYTES
        )
        if (!file) fail('Invalid file input', 400)
        return { base64: file.base64 }
      }
      return { url: image }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (error instanceof QuiverOperationError) throw error
      return { url: image }
    }
  }

  const file = await storedFileToBase64(image, context, MAX_BUFFERED_TRANSFER_BYTES)
  if (!file) fail('Invalid file input', 400)
  return { base64: file.base64 }
}

function projectResult(
  result: unknown,
  fileName: (index: number, total: number) => string,
  firstOnly = false
): QuiverSvgOutput {
  const root = record(result)
  const data = root.data
  if (!Array.isArray(data) || data.length === 0) {
    fail('No SVG data returned from Quiver API', 500)
  }

  const projectedData = firstOnly ? data.slice(0, 1) : data
  const files = projectedData.map((value, index) => {
    const svg = record(value).svg
    if (typeof svg !== 'string') fail('No SVG data returned from Quiver API', 500)
    const buffer = Buffer.from(svg, 'utf8')
    return {
      name: fileName(index, projectedData.length),
      mimeType: 'image/svg+xml' as const,
      data: buffer.toString('base64'),
      size: buffer.length,
    }
  })
  const usage = isRecordLike(root.usage)
    ? {
        totalTokens: optionalNumber(root.usage.total_tokens),
        inputTokens: optionalNumber(root.usage.input_tokens),
        outputTokens: optionalNumber(root.usage.output_tokens),
      }
    : null

  return {
    success: true,
    output: {
      file: files[0],
      files,
      svgContent: record(data[0]).svg as string,
      id: typeof root.id === 'string' ? root.id : null,
      usage,
    },
  }
}

export async function executeQuiverTextToSvg(
  input: QuiverTextToSvgInput,
  context: QuiverOperationContext
): Promise<QuiverSvgOutput> {
  context.signal?.throwIfAborted()
  validateProvenance(input, context)
  const references: ApiImage[] = []
  let referenceBudget = MAX_BUFFERED_TRANSFER_BYTES
  if (input.references) {
    const rawReferences = Array.isArray(input.references) ? input.references : [input.references]
    for (const reference of rawReferences) {
      const resolved = await resolveReference(reference, context, referenceBudget)
      referenceBudget -= resolved.size
      if (resolved.image) references.push(resolved.image)
    }
  }

  const body: Record<string, unknown> = { model: input.model, prompt: input.prompt }
  if (input.instructions) body.instructions = input.instructions
  if (references.length > 0) body.references = references.slice(0, 4)
  if (input.n != null) body.n = input.n
  if (input.temperature != null) body.temperature = input.temperature
  if (input.top_p != null) body.top_p = input.top_p
  if (input.max_output_tokens != null) body.max_output_tokens = input.max_output_tokens
  if (input.presence_penalty != null) body.presence_penalty = input.presence_penalty

  const result = await requestQuiverSvg('generations', input.apiKey, body, context.signal)
  context.signal?.throwIfAborted()
  return projectResult(result, (index, total) =>
    total > 1 ? `generated-${index + 1}.svg` : 'generated.svg'
  )
}

export async function executeQuiverImageToSvg(
  input: QuiverImageToSvgInput,
  context: QuiverOperationContext
): Promise<QuiverSvgOutput> {
  context.signal?.throwIfAborted()
  validateProvenance(input, context)
  const image = await resolveImage(input.image, context)
  const body: Record<string, unknown> = { model: input.model, image }
  if (input.temperature != null) body.temperature = input.temperature
  if (input.top_p != null) body.top_p = input.top_p
  if (input.max_output_tokens != null) body.max_output_tokens = input.max_output_tokens
  if (input.presence_penalty != null) body.presence_penalty = input.presence_penalty
  if (input.auto_crop != null) body.auto_crop = input.auto_crop
  if (input.target_size != null) body.target_size = input.target_size

  const result = await requestQuiverSvg('vectorizations', input.apiKey, body, context.signal)
  context.signal?.throwIfAborted()
  return projectResult(result, () => 'vectorized.svg', true)
}
