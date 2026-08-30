import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import {
  BILLING_ATTRIBUTION_HEADER,
  type BillingAttributionSnapshot,
  requireBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import {
  inspectModelInputProjectionState,
  inspectModelInputProvenanceRequest,
} from '@/lib/execution/model-input-provenance'
import { resolveVertexAccessToken } from '@/lib/internal/llm/credentials'
import { LlmOperationError } from '@/lib/internal/llm/errors'
import type { LlmProviderOperationInput } from '@/lib/internal/llm/input'
import { prepareCopilotEnvironmentContext } from '@/lib/mothership/environment-context'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import {
  assertPermissionsAllowed,
  IntegrationNotAllowedError,
  ModelNotAllowedError,
  ProviderNotAllowedError,
} from '@/ee/access-control/utils/permission-check'
import type { StreamingExecution } from '@/executor/types'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { executeProviderRequest } from '@/providers'
import type { ProviderRequest, ProviderResponse } from '@/providers/types'

const logger = createLogger('LlmOperation')

export type LlmProviderOperationResult = ProviderResponse | ReadableStream | StreamingExecution

export interface LlmProviderOperationContext {
  actorUserId: string
  headers: Headers
  requestId: string
  signal?: AbortSignal
}

function fail(status: number, error: string): never {
  throw new LlmOperationError(status, { error })
}

function authenticatedCaller(context: LlmProviderOperationContext) {
  return {
    success: true,
    userId: context.actorUserId,
    authType: AuthType.INTERNAL_JWT,
  } as const
}

async function authorizeVertexCredential(
  input: LlmProviderOperationInput,
  context: LlmProviderOperationContext
): Promise<void> {
  if (input.provider !== 'vertex' || !input.vertexCredential) return

  const access = await authorizeCredentialUseForAuth(authenticatedCaller(context), {
    credentialId: input.vertexCredential,
    workflowId: input.workflowId || undefined,
    callerUserId: context.actorUserId,
  })
  if (!access.ok) {
    logger.warn(`[${context.requestId}] Vertex credential access denied`, {
      error: access.error,
      credentialId: input.vertexCredential,
    })
    fail(401, access.error || 'Unauthorized')
  }
}

function resolveBillingAttribution(
  input: LlmProviderOperationInput,
  context: LlmProviderOperationContext
): BillingAttributionSnapshot | undefined {
  if (!context.headers.get(BILLING_ATTRIBUTION_HEADER)) return undefined
  if (!input.workspaceId) {
    fail(400, 'workspaceId is required when billing attribution is supplied')
  }
  try {
    return requireBillingAttributionHeader(context.headers, {
      actorUserId: context.actorUserId,
      workspaceId: input.workspaceId,
    })
  } catch (error) {
    fail(400, getErrorMessage(error, 'Invalid billing attribution header'))
  }
}

async function authorizeWorkspace(
  input: LlmProviderOperationInput,
  context: LlmProviderOperationContext
): Promise<void> {
  if (!input.workspaceId) return
  const workspaceAccess = await checkWorkspaceAccess(input.workspaceId, context.actorUserId)
  if (!workspaceAccess.hasAccess) fail(403, 'Forbidden')

  try {
    await assertPermissionsAllowed({
      userId: context.actorUserId,
      workspaceId: input.workspaceId,
      model: input.model,
    })
  } catch (error) {
    if (
      error instanceof ProviderNotAllowedError ||
      error instanceof ModelNotAllowedError ||
      error instanceof IntegrationNotAllowedError
    ) {
      fail(403, error.message)
    }
    throw error
  }
}

async function prepareProviderRequest(
  input: LlmProviderOperationInput,
  context: LlmProviderOperationContext
): Promise<{
  request: ProviderRequest
  runtimeContext: Awaited<ReturnType<typeof prepareCopilotEnvironmentContext>>
}> {
  let apiKey = input.apiKey
  try {
    await authorizeVertexCredential(input, context)
    if (input.provider === 'vertex' && input.vertexCredential) {
      apiKey = await resolveVertexAccessToken(context.requestId, input.vertexCredential)
    }
  } catch (error) {
    if (error instanceof LlmOperationError) throw error
    logger.error(`[${context.requestId}] Failed to resolve Vertex credential`, {
      provider: input.provider,
      model: input.model,
      error: toError(error).message,
      hasVertexCredential: Boolean(input.vertexCredential),
    })
    fail(400, getErrorMessage(error, 'Credential error'))
  }

  const billingAttribution = resolveBillingAttribution(input, context)
  let request: ProviderRequest = {
    model: input.model,
    systemPrompt: input.systemPrompt,
    context: input.context,
    tools: input.tools,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    apiKey,
    azureEndpoint: input.azureEndpoint,
    azureApiVersion: input.azureApiVersion,
    vertexProject: input.vertexProject,
    vertexLocation: input.vertexLocation,
    bedrockAccessKeyId: input.bedrockAccessKeyId,
    bedrockSecretKey: input.bedrockSecretKey,
    bedrockRegion: input.bedrockRegion,
    responseFormat: input.responseFormat,
    workflowId: input.workflowId,
    workspaceId: input.workspaceId,
    userId: context.actorUserId,
    stream: input.stream,
    messages: input.messages,
    environmentVariables: input.environmentVariables,
    workflowVariables: input.workflowVariables,
    blockData: input.blockData,
    blockNameMapping: input.blockNameMapping,
    billingAttribution,
    reasoningEffort: input.reasoningEffort,
    verbosity: input.verbosity,
    abortSignal: context.signal,
  }

  const provenanceInspection = inspectModelInputProvenanceRequest(context.headers, input)
  const projectionState = inspectModelInputProjectionState(context.headers)
  if (
    provenanceInspection.status === 'invalid' ||
    projectionState === 'invalid' ||
    (projectionState === 'projected' && provenanceInspection.status !== 'verified')
  ) {
    fail(400, 'Invalid model input provenance')
  }

  const runtimeContext = await prepareCopilotEnvironmentContext(
    context.actorUserId,
    input.workspaceId
  )
  if (provenanceInspection.status === 'verified') {
    const provenanceReady = await runtimeContext.resolvedSecretTraceRegistry.importProvenance(
      provenanceInspection.value,
      { trusted: true, origin: 'llmTool.inputProvenance' }
    )
    if (!provenanceReady || !runtimeContext.resolvedSecretTraceRegistry.isComplete()) {
      fail(400, 'Model input provenance is unavailable')
    }

    if (projectionState === 'unmarked') {
      const projection = projectResolvedSecretModelContent(
        { systemPrompt: request.systemPrompt, context: request.context },
        runtimeContext.resolvedSecretTraceRegistry
      )
      if (!projection.safe || !isPlainRecord(projection.value)) {
        fail(400, 'Model input provenance is unavailable')
      }
      const projectedSystemPrompt = projection.value.systemPrompt
      const projectedContext = projection.value.context
      if (
        (projectedSystemPrompt !== undefined && typeof projectedSystemPrompt !== 'string') ||
        (projectedContext !== undefined && typeof projectedContext !== 'string')
      ) {
        fail(400, 'Invalid model input provenance')
      }
      request = {
        ...request,
        systemPrompt: projectedSystemPrompt,
        context: projectedContext,
      }
    }
  }

  return { request, runtimeContext }
}

/** Executes one authorized provider request without transport retries. */
export async function executeLlmProviderOperation(
  input: LlmProviderOperationInput,
  context: LlmProviderOperationContext
): Promise<LlmProviderOperationResult> {
  context.signal?.throwIfAborted()
  await authorizeWorkspace(input, context)
  const { request, runtimeContext } = await prepareProviderRequest(input, context)
  context.signal?.throwIfAborted()
  const result = await executeProviderRequest(input.provider, request, runtimeContext)
  context.signal?.throwIfAborted()
  return result
}
