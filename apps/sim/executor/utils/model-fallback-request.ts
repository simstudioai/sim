import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import { resolveFallbackTuning } from '@/lib/workflows/blocks/fallback-models'
import type { BlockRetryAttempt, ExecutionContext } from '@/executor/types'
import type { BlockModelCredentialInputs } from '@/executor/utils/model-credentials'
import {
  getModelFallbacks,
  PROVIDER_FAMILY_CREDENTIAL_FIELDS,
  resolveFallbackApiKey,
  walkModelCandidates,
} from '@/executor/utils/model-fallbacks'
import { executeBlockProviderRequest } from '@/executor/utils/provider-request'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { isAutoModel, SIM_AUTO_MODEL_ID } from '@/providers/models'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'
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
  /**
   * The block's saved Vertex or Bedrock credential selection, resolved once per call inside the
   * first attempt on the primary's provider and shared by the fallbacks on that provider.
   */
  credentials?: { inputs: BlockModelCredentialInputs; callerLabel: string }
}

/**
 * Shared non-streaming model execution for Router and Evaluator over
 * `walkModelCandidates`. Saved credentials resolve inside the attempt, so one that
 * cannot be resolved fails that attempt and the fallbacks still run; they never
 * reach another provider.
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
  credentials,
}: ModelFallbackRequestInput): Promise<{ result: ProviderResponse; usedFallback: boolean }> {
  return walkModelCandidates({
    ctx,
    block,
    primary: {
      model: request.model,
      ...(isAutoModel(configuredModel) ? { traceName: SIM_AUTO_MODEL_ID } : {}),
    },
    primaryProviderId: providerId,
    fallbacks: getModelFallbacks(ctx, block, fallbackModels, logger),
    retry,
    credentials,
    attempt: async (
      candidate,
      { isPrimary, providerId: candidateProviderId, sameProvider, credentials: savedCredentials }
    ) => {
      let candidateRequest = request
      if (!isPrimary) {
        const { adjustments: _adjustments, ...tuning } = resolveFallbackTuning(
          candidate,
          configuredModel,
          request
        )
        candidateRequest = {
          ...(sameProvider
            ? request
            : omit(request, [...PROVIDER_FAMILY_CREDENTIAL_FIELDS, 'bedrockSession'])),
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
      if (savedCredentials) {
        candidateRequest = { ...candidateRequest, ...(await savedCredentials()) }
      }
      const result = await executeBlockProviderRequest({
        ctx,
        providerId: candidateProviderId,
        request: candidateRequest,
        resolvedSecretTraceRegistry,
      })
      return { result, usedFallback: !isPrimary }
    },
    onSkip: (model, error) =>
      logger.warn(
        'Fallback model unusable; skipping',
        projectResolvedSecretDiagnosticError(error, ctx.resolvedSecretTraceRegistry, {
          blockId: block.id,
          model,
        })
      ),
    onFallback: ({ error, failedModel }) =>
      logger.warn(
        'Model request failed; trying fallback',
        projectResolvedSecretDiagnosticError(error, ctx.resolvedSecretTraceRegistry, {
          blockId: block.id,
          failedModel,
        })
      ),
  })
}
