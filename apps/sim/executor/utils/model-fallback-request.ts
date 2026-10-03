import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import { resolveFallbackTuning } from '@/lib/workflows/blocks/fallback-models'
import { providerRequiresFamilyCredentials } from '@/blocks/utils'
import { validateModelProvider } from '@/ee/access-control/utils/permission-check'
import { isRetryableBlockError } from '@/executor/execution/block-retry'
import type { BlockRetryAttempt, ExecutionContext } from '@/executor/types'
import {
  getModelFallbacks,
  PROVIDER_FAMILY_CREDENTIAL_FIELDS,
  recordModelFallbacks,
  resolveFallbackApiKey,
} from '@/executor/utils/model-fallbacks'
import { executeBlockProviderRequest } from '@/executor/utils/provider-request'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { isAutoModel, SIM_AUTO_MODEL_ID } from '@/providers/models'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('BlockModelFallbacks')

interface ModelFallbackRequestInput {
  ctx: ExecutionContext
  block: SerializedBlock
  providerId: string
  request: ProviderRequest
  configuredModel: string
  fallbackModels: unknown
  /** The original system prompt, before an Auto identity preamble was added. */
  fallbackSystemPrompt: string
  retry?: BlockRetryAttempt
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry | undefined
}

/**
 * Shared non-streaming model execution for Router and Evaluator. Block retries
 * exhaust the primary first; the final try walks the ordered fallback models.
 * Parsing a successful response remains the handler's job, so a routing decision
 * such as NO_MATCH is never silently replaced by another model's decision.
 */
export async function executeModelRequestWithFallbacks({
  ctx,
  block,
  providerId,
  request,
  configuredModel,
  fallbackModels,
  fallbackSystemPrompt,
  retry,
  resolvedSecretTraceRegistry,
}: ModelFallbackRequestInput): Promise<{ result: ProviderResponse; usedFallback: boolean }> {
  const fallbacks = getModelFallbacks(ctx, block, fallbackModels, logger)
  const candidates = [
    { model: request.model },
    ...(retry && !retry.isFinalTry
      ? []
      : fallbacks.filter(
          (candidate) => candidate.model.toLowerCase() !== request.model.toLowerCase()
        )),
  ]
  const failedModels: string[] = []
  let lastError: unknown

  for (const [index, candidate] of candidates.entries()) {
    const isPrimary = index === 0
    if (!isPrimary && ctx.abortSignal?.aborted) break
    let candidateProviderId = providerId
    if (!isPrimary) {
      try {
        candidateProviderId = getProviderFromModel(candidate.model)
        await validateModelProvider(ctx.userId, ctx.workspaceId, candidate.model, ctx)
        if (
          candidateProviderId !== providerId &&
          providerRequiresFamilyCredentials(candidateProviderId)
        ) {
          throw new Error('Fallback requires credentials from a different provider family')
        }
      } catch (error) {
        logger.warn(
          'Fallback model unusable; skipping',
          projectResolvedSecretDiagnosticError(error, ctx.resolvedSecretTraceRegistry, {
            blockId: block.id,
            model: candidate.model,
          })
        )
        continue
      }
    }

    let candidateRequest = request
    if (!isPrimary) {
      const sameProvider = candidateProviderId === providerId
      const { adjustments: _adjustments, ...tuning } = resolveFallbackTuning(
        candidate,
        configuredModel,
        request
      )
      candidateRequest = {
        ...(sameProvider ? request : omit(request, [...PROVIDER_FAMILY_CREDENTIAL_FIELDS])),
        ...tuning,
        temperature: tuning.temperature === undefined ? undefined : Number(tuning.temperature),
        maxTokens: tuning.maxTokens === undefined ? undefined : Number(tuning.maxTokens),
        model: candidate.model,
        apiKey: resolveFallbackApiKey({
          candidate,
          configuredModel,
          sameProvider,
          primaryApiKey: request.apiKey,
          blockId: block.id,
          logger,
        }),
        systemPrompt: fallbackSystemPrompt,
      }
    }

    try {
      const result = await executeBlockProviderRequest({
        ctx,
        providerId: candidateProviderId,
        request: candidateRequest,
        resolvedSecretTraceRegistry,
      })
      recordModelFallbacks(ctx, block, failedModels)
      return { result, usedFallback: !isPrimary }
    } catch (error) {
      lastError = error
      failedModels.push(
        isPrimary && isAutoModel(configuredModel) ? SIM_AUTO_MODEL_ID : candidate.model
      )
      if (
        index === candidates.length - 1 ||
        ctx.abortSignal?.aborted ||
        !isRetryableBlockError(error)
      )
        break
      logger.warn(
        'Model request failed; trying fallback',
        projectResolvedSecretDiagnosticError(error, ctx.resolvedSecretTraceRegistry, {
          blockId: block.id,
          failedModel: candidate.model,
        })
      )
    }
  }

  recordModelFallbacks(ctx, block, failedModels.slice(0, -1))
  throw lastError
}
