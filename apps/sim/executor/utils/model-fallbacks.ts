import type { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import {
  type FallbackModelCandidate,
  fallbackRowNeedsApiKey,
  isWholeEnvVarReference,
  normalizeFallbackModels,
} from '@/lib/workflows/blocks/fallback-models'
import type { ExecutionContext } from '@/executor/types'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import type { SerializedBlock } from '@/serializer/types'

type Logger = ReturnType<typeof createLogger>

/** Credentials scoped to one provider family, never forwarded across providers. */
export const PROVIDER_FAMILY_CREDENTIAL_FIELDS = [
  'azureEndpoint',
  'azureApiVersion',
  'vertexProject',
  'vertexLocation',
  'bedrockAccessKeyId',
  'bedrockSecretKey',
  'bedrockRegion',
] as const

/** Validates stored key references before admitting their resolved values to a provider. */
export function getModelFallbacks(
  ctx: ExecutionContext,
  block: SerializedBlock,
  rows: unknown,
  logger: Logger
): FallbackModelCandidate[] {
  if (!Array.isArray(rows)) return []
  const storedRows: unknown = block.config?.params?.fallbackModels
  return normalizeFallbackModels(
    rows.map((row, index) => {
      if (!isPlainRecord(row) || row.apiKey === undefined) return row
      const stored = Array.isArray(storedRows) ? storedRows[index] : undefined
      if (isPlainRecord(stored) && isWholeEnvVarReference(stored.apiKey)) return row
      const projection = projectResolvedSecretDiagnosticContent(
        { blockId: block.id, model: row.model, row: index + 1 },
        ctx.resolvedSecretTraceRegistry
      )
      logger.warn(
        'Fallback row key ignored; only an environment variable reference is accepted',
        projection.safe && isPlainRecord(projection.value)
          ? projection.value
          : { blockId: block.id, row: index + 1 }
      )
      return { ...row, apiKey: undefined }
    })
  )
}

/** A hidden or unresolved row key cannot override the primary, BYOK, or platform key. */
export function resolveFallbackApiKey({
  candidate,
  configuredModel,
  sameProvider,
  primaryApiKey,
  blockId,
  logger,
}: {
  candidate: FallbackModelCandidate
  configuredModel: string
  sameProvider: boolean
  primaryApiKey: string | undefined
  blockId: string
  logger: Logger
}): string | undefined {
  let rowKey = fallbackRowNeedsApiKey(candidate.model, configuredModel)
    ? candidate.apiKey
    : undefined
  if (rowKey && isWholeEnvVarReference(rowKey)) {
    logger.warn('Fallback key variable is not set for this run', {
      blockId,
      model: candidate.model,
      variable: rowKey,
    })
    rowKey = undefined
  }
  return rowKey ?? (sameProvider ? primaryApiKey : undefined)
}

/** Records failed candidates on the current attempt's log, projecting secret-derived model names. */
export function recordModelFallbacks(
  ctx: ExecutionContext,
  block: SerializedBlock,
  failedModels: string[]
): void {
  const logs = ctx.blockLogs ?? []
  for (let index = logs.length - 1; index >= 0; index--) {
    const entry = logs[index]
    if (entry.blockId !== block.id || entry.endedAt !== '') continue
    if (failedModels.length === 0) {
      entry.modelFallbacks = undefined
      return
    }
    const registry = ctx.errorResolvedSecretTraceRegistry ?? ctx.resolvedSecretTraceRegistry
    const projection = projectResolvedSecretDiagnosticContent({ models: failedModels }, registry)
    const models =
      projection.safe && isPlainRecord(projection.value) ? projection.value.models : undefined
    entry.modelFallbacks =
      Array.isArray(models) && models.every((model) => typeof model === 'string')
        ? [...models]
        : undefined
    return
  }
}
