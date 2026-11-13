import type { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import {
  type FallbackModelCandidate,
  fallbackRowNeedsApiKey,
  isWholeEnvVarReference,
  normalizeFallbackModels,
} from '@/lib/workflows/blocks/fallback-models'
import { providerRequiresFamilyCredentials } from '@/blocks/utils'
import { validateModelProvider } from '@/ee/access-control/utils/permission-check'
import { isRetryableBlockError } from '@/executor/execution/block-retry'
import type { BlockRetryAttempt, ExecutionContext } from '@/executor/types'
import {
  type BlockModelCredentialInputs,
  type BlockModelCredentials,
  resolveBlockModelCredentials,
} from '@/executor/utils/model-credentials'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import { getProviderFromModel } from '@/providers/utils'
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

/**
 * Refuses a fallback on another provider that needs a Vertex credential, Bedrock keys, or an
 * Azure endpoint: those fields exist only for the primary's provider family.
 */
function assertFallbackFamilyCredentials(
  candidateProviderId: string,
  primaryProviderId: string
): void {
  if (
    candidateProviderId !== primaryProviderId &&
    providerRequiresFamilyCredentials(candidateProviderId)
  ) {
    throw new Error('Fallback requires credentials from a different provider family')
  }
}

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
function recordModelFallbacks(
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

/**
 * Retry on fail retries the selected model; the fallbacks join only on the try
 * after which the executor promises no other.
 */
export function areFallbacksHeld(retry: BlockRetryAttempt | undefined): boolean {
  return retry !== undefined && !retry.isFinalTry
}

/** What the walk tells each attempt about the candidate it is running. */
interface ModelCandidateAttempt {
  isPrimary: boolean
  hasNext: boolean
  providerId: string
  /** Whether the candidate runs on the primary's provider, and so may reuse its key and family credentials. */
  sameProvider: boolean
  /**
   * The block's saved Vertex or Bedrock credentials, resolved at most once per walk and
   * shared by every candidate on the primary's provider. Absent on any other provider.
   */
  credentials?: () => Promise<BlockModelCredentials>
}

interface ModelCandidateWalk<R> {
  ctx: ExecutionContext
  block: SerializedBlock
  /**
   * The configured primary. `traceName` is what the block log calls it when it fails:
   * a routed Auto primary shows as the Auto identity, never as the pool model.
   */
  primary: { model: string; traceName?: string }
  primaryProviderId: string
  /** Validated fallback rows (`getModelFallbacks`), before the hold and de-duplication. */
  fallbacks: FallbackModelCandidate[]
  retry?: BlockRetryAttempt
  /** The block's saved credential selection, resolved only for candidates on the primary's provider. */
  credentials?: { inputs: BlockModelCredentialInputs; callerLabel: string }
  /**
   * Readies a fallback that passed the provider checks; a throw means it cannot take this
   * request, and it is skipped like an unusable fallback.
   */
  prepare?: (candidate: FallbackModelCandidate, info: ModelCandidateAttempt) => Promise<void>
  /** Builds and sends one candidate's request; a throw is that candidate failing. */
  attempt: (candidate: FallbackModelCandidate, info: ModelCandidateAttempt) => Promise<R>
  /**
   * A fallback passed over without counting as a failed try: its provider is unknown, not
   * permitted, or needs another family's credentials (`unusable`), or `prepare` threw.
   */
  onSkip: (model: string, error: unknown, stage: 'unusable' | 'prepare') => void
  /** A retryable failure with another candidate after it; `position` is the failed candidate's 1-based place. */
  onFallback: (failure: {
    error: unknown
    failedModel: string
    nextModel: string
    position: number
  }) => void
}

/**
 * Runs a block's model request against the primary and then each fallback until one
 * answers. Retries exhaust the primary first; the fallbacks, de-duplicated against the
 * primary, join only on the final try. A fallback that cannot be used is skipped, not
 * counted as a failure. The chain stops at the last candidate, on a stop, or on a
 * non-retryable error, and then rethrows the last candidate's error unchanged.
 *
 * Falling through is deliberately as indiscriminate as block retry
 * (`isRetryableBlockError`): a provider error carries no status, so an overloaded
 * upstream cannot be told from any other failure, and a builder who lists fallbacks
 * wants the block to answer. Only a stop and an explicitly non-retryable failure end
 * the chain early.
 *
 * The models that failed are written to the block log on every exit, cleared as well
 * as set, because block retry reuses one log entry across tries.
 */
export async function walkModelCandidates<R>({
  ctx,
  block,
  primary,
  primaryProviderId,
  fallbacks,
  retry,
  credentials,
  prepare,
  attempt,
  onSkip,
  onFallback,
}: ModelCandidateWalk<R>): Promise<R> {
  const primaryModel = primary.model.toLowerCase()
  const candidates: FallbackModelCandidate[] = [
    primary,
    ...(areFallbacksHeld(retry)
      ? []
      : fallbacks.filter((candidate) => candidate.model.toLowerCase() !== primaryModel)),
  ]
  let savedCredentials: Promise<BlockModelCredentials> | undefined
  const resolveSavedCredentials = credentials
    ? () =>
        (savedCredentials ??= resolveBlockModelCredentials(
          ctx,
          primaryProviderId,
          credentials.inputs,
          credentials.callerLabel
        ))
    : undefined
  const failedModels: string[] = []
  let lastError: unknown

  for (const [index, candidate] of candidates.entries()) {
    const isPrimary = index === 0
    const hasNext = index < candidates.length - 1
    /** A run stopped while a candidate was being skipped must not start another. */
    if (!isPrimary && ctx.abortSignal?.aborted) break

    let providerId = primaryProviderId
    if (!isPrimary) {
      try {
        providerId = getProviderFromModel(candidate.model)
        await validateModelProvider(ctx.userId, ctx.workspaceId, candidate.model, ctx)
        assertFallbackFamilyCredentials(providerId, primaryProviderId)
      } catch (error) {
        onSkip(candidate.model, error, 'unusable')
        continue
      }
    }

    const sameProvider = providerId === primaryProviderId
    const info: ModelCandidateAttempt = {
      isPrimary,
      hasNext,
      providerId,
      sameProvider,
      credentials: sameProvider ? resolveSavedCredentials : undefined,
    }
    if (!isPrimary && prepare) {
      try {
        await prepare(candidate, info)
      } catch (error) {
        onSkip(candidate.model, error, 'prepare')
        continue
      }
    }

    try {
      const result = await attempt(candidate, info)
      recordModelFallbacks(ctx, block, failedModels)
      return result
    } catch (error) {
      lastError = error
      failedModels.push(isPrimary ? (primary.traceName ?? primary.model) : candidate.model)
      /**
       * The abort signal is checked before the error itself because a handler may
       * rewrite a timeout into a plain `Error` without a cause, which the predicate
       * would then treat as replayable.
       */
      if (!hasNext || ctx.abortSignal?.aborted || !isRetryableBlockError(error)) break
      onFallback({
        error,
        failedModel: candidate.model,
        nextModel: candidates[index + 1].model,
        position: index + 1,
      })
    }
  }

  recordModelFallbacks(ctx, block, failedModels.slice(0, -1))
  throw lastError
}
