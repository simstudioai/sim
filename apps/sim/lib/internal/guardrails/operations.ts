import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  requireBillingAttributionHeader,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { prepareCopilotEnvironmentContext } from '@/lib/copilot/environment-context'
import { inspectModelInputProvenanceRequest } from '@/lib/execution/model-input-provenance'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'
import { validateHallucination } from '@/lib/guardrails/validate_hallucination'
import { validateJson } from '@/lib/guardrails/validate_json'
import { validatePII } from '@/lib/guardrails/validate_pii'
import { validateRegex } from '@/lib/guardrails/validate_regex'
import { GuardrailsOperationError } from '@/lib/internal/guardrails/errors'
import type { GuardrailsValidationInput } from '@/lib/internal/guardrails/input'
import {
  assertPermissionsAllowed,
  ModelNotAllowedError,
  ProviderNotAllowedError,
} from '@/ee/access-control/utils/permission-check'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { isAbortError } from '@/providers/streaming-tool-loop-shared'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('GuardrailsOperation')

interface GuardrailsValidationResult {
  passed: boolean
  error?: string
  score?: number
  reasoning?: string
  detectedEntities?: unknown[]
  maskedText?: string
  cost?: number
}

export interface GuardrailsOperationOutput {
  success: true
  output: {
    passed: boolean
    validationType: string
    input?: unknown
    error?: string
    score?: number
    reasoning?: string
    detectedEntities?: unknown[]
    maskedText?: string
  }
}

export interface GuardrailsOperationContext {
  actorUserId: string
  headers: Headers
  requestId: string
  signal?: AbortSignal
}

function fail(status: number, error: string): never {
  throw new GuardrailsOperationError(status, { error })
}

function failedVerdict(
  validationType: string,
  input: unknown,
  error: string
): GuardrailsOperationOutput {
  return {
    success: true,
    output: {
      passed: false,
      validationType,
      input,
      error,
    },
  }
}

function authenticatedCaller(context: GuardrailsOperationContext) {
  return {
    success: true,
    userId: context.actorUserId,
    authType: AuthType.INTERNAL_JWT,
  } as const
}

async function authorizeVertexCredential(
  input: GuardrailsValidationInput,
  context: GuardrailsOperationContext
): Promise<void> {
  if (!input.vertexCredential || !input.model || getProviderFromModel(input.model) !== 'vertex') {
    return
  }
  const access = await authorizeCredentialUseForAuth(authenticatedCaller(context), {
    credentialId: input.vertexCredential,
    workflowId: input.workflowId,
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

async function prepareHallucinationContext(
  input: GuardrailsValidationInput,
  inputString: string,
  context: GuardrailsOperationContext
): Promise<{
  workspaceId: string
  billingAttribution: BillingAttributionSnapshot
  resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry
}> {
  if (!input.workflowId || typeof input.workflowId !== 'string') {
    throw new Error('Workflow context missing')
  }

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: input.workflowId,
    userId: context.actorUserId,
    action: 'read',
  })
  if (!authorization.allowed || !authorization.workflow?.workspaceId) {
    throw new Error(authorization.message || 'Workflow not found or access denied.')
  }

  const workspaceId = authorization.workflow.workspaceId
  const resolvedSecretTraceRegistry = (
    await prepareCopilotEnvironmentContext(context.actorUserId, workspaceId)
  ).resolvedSecretTraceRegistry

  let billingAttribution: BillingAttributionSnapshot
  try {
    billingAttribution = requireBillingAttributionHeader(context.headers, {
      actorUserId: context.actorUserId,
      workspaceId,
    })
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to establish billing attribution`, { error })
    fail(400, 'Invalid billing attribution')
  }

  if (!input.model) throw new Error('Model missing')
  try {
    await assertPermissionsAllowed({
      userId: context.actorUserId,
      workspaceId,
      model: input.model,
    })
  } catch (error) {
    if (error instanceof ProviderNotAllowedError || error instanceof ModelNotAllowedError) {
      throw error
    }
    throw error
  }

  const usage = await checkAttributedUsageLimits(billingAttribution)
  if (usage.isExceeded) {
    fail(402, usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.')
  }

  await authorizeVertexCredential(input, context)

  const provenanceInspection = inspectModelInputProvenanceRequest(context.headers, input)
  if (provenanceInspection.status === 'invalid') {
    fail(400, 'Invalid model input provenance')
  }
  const provenanceReady =
    provenanceInspection.status === 'verified'
      ? (
          await resolvedSecretTraceRegistry.importProvenanceForValueAtInputPath(
            provenanceInspection.value,
            inputString,
            ['input'],
            { trusted: true, origin: 'guardrailsTool.inputProvenance' }
          )
        ).success
      : true
  if (!provenanceReady || !resolvedSecretTraceRegistry.isComplete()) {
    fail(400, 'Model input provenance is unavailable')
  }

  return { workspaceId, billingAttribution, resolvedSecretTraceRegistry }
}

function convertInputToString(input: unknown): string {
  if (typeof input === 'string') return input
  if (input === null || input === undefined) return ''
  if (typeof input === 'object') return JSON.stringify(input)
  return String(input)
}

async function executeValidation(
  input: GuardrailsValidationInput,
  inputString: string,
  context: GuardrailsOperationContext,
  hallucinationContext?: Awaited<ReturnType<typeof prepareHallucinationContext>>
): Promise<GuardrailsValidationResult> {
  if (input.validationType === 'json') return validateJson(inputString)
  if (input.validationType === 'regex') {
    return input.regex
      ? validateRegex(inputString, input.regex)
      : { passed: false, error: 'Regex pattern is required' }
  }
  if (input.validationType === 'hallucination') {
    if (!input.knowledgeBaseId) {
      return { passed: false, error: 'Knowledge base ID is required for hallucination check' }
    }
    if (!input.model) {
      return { passed: false, error: 'Model is required for hallucination validation' }
    }
    if (!hallucinationContext) {
      throw new Error('Hallucination authorization context is unavailable')
    }
    return validateHallucination({
      userInput: inputString,
      knowledgeBaseId: input.knowledgeBaseId,
      threshold: input.threshold != null ? Number.parseFloat(input.threshold) : 3,
      topK: input.topK ? Number.parseInt(input.topK) : 10,
      model: input.model,
      apiKey: input.apiKey,
      providerCredentials: {
        azureEndpoint: input.azureEndpoint,
        azureApiVersion: input.azureApiVersion,
        vertexProject: input.vertexProject,
        vertexLocation: input.vertexLocation,
        vertexCredential: input.vertexCredential,
        bedrockAccessKeyId: input.bedrockAccessKeyId,
        bedrockSecretKey: input.bedrockSecretKey,
        bedrockRegion: input.bedrockRegion,
      },
      workflowId: input.workflowId,
      workspaceId: hallucinationContext.workspaceId,
      actorUserId: context.actorUserId,
      billingAttribution: hallucinationContext.billingAttribution,
      requestId: context.requestId,
      resolvedSecretTraceRegistry: hallucinationContext.resolvedSecretTraceRegistry,
      abortSignal: context.signal,
    })
  }
  if (input.validationType === 'pii') {
    return validatePII({
      text: inputString,
      entityTypes: input.piiEntityTypes || [],
      mode: input.piiMode === 'mask' ? 'mask' : 'block',
      language: input.piiLanguage || 'en',
      customPatterns: input.piiCustomPatterns as CustomPiiPattern[] | undefined,
      requestId: context.requestId,
      abortSignal: context.signal,
    })
  }
  return { passed: false, error: 'Unknown validation type' }
}

async function recordHallucinationUsage(
  input: GuardrailsValidationInput,
  result: GuardrailsValidationResult,
  context: GuardrailsOperationContext,
  hallucinationContext: Awaited<ReturnType<typeof prepareHallucinationContext>> | undefined
): Promise<void> {
  if (!hallucinationContext || typeof result.cost !== 'number' || result.cost <= 0) return

  const { recordUsage } = await import('@/lib/billing/core/usage-log')
  try {
    await recordUsage({
      userId: context.actorUserId,
      workspaceId: hallucinationContext.workspaceId,
      ...toBillingContext(hallucinationContext.billingAttribution),
      entries: [
        {
          category: 'model',
          source: 'workflow',
          description: `guardrail-hallucination:${input.model ?? 'unknown'}`,
          cost: result.cost,
          sourceReference: `guardrail:${input.workflowId ?? 'unknown'}:${context.requestId}`,
        },
      ],
    })
    await checkAndBillPayerOverageThreshold(hallucinationContext.billingAttribution.billingEntity)
  } catch (error) {
    logger.error(`[${context.requestId}] Failed to record guardrail usage`, { error })
  }
}

/** Executes one guardrail verdict without retrying provider or guardrail work. */
export async function executeGuardrailsValidation(
  input: GuardrailsValidationInput,
  context: GuardrailsOperationContext
): Promise<GuardrailsOperationOutput> {
  context.signal?.throwIfAborted()
  const validationType = input.validationType
  const originalInput = input.input

  if (!validationType) {
    return failedVerdict('unknown', originalInput || '', 'Missing required field: validationType')
  }
  if (originalInput === undefined || originalInput === null) {
    return failedVerdict(validationType, '', 'Input is missing or undefined')
  }
  if (!['json', 'regex', 'hallucination', 'pii'].includes(validationType)) {
    return failedVerdict(
      validationType,
      originalInput || '',
      'Invalid validationType. Must be "json", "regex", "hallucination", or "pii"'
    )
  }
  if (validationType === 'regex' && !input.regex) {
    return failedVerdict(
      validationType,
      originalInput || '',
      'Regex pattern is required for regex validation'
    )
  }
  if (validationType === 'hallucination' && !input.model) {
    return failedVerdict(
      validationType,
      originalInput || '',
      'Model is required for hallucination validation'
    )
  }
  if (validationType === 'hallucination' && !input.workflowId) {
    return failedVerdict(
      validationType,
      originalInput || '',
      'Workflow context is required for hallucination validation. Call this endpoint via a workflow execution, not directly.'
    )
  }

  const inputString = convertInputToString(originalInput)
  let hallucinationContext: Awaited<ReturnType<typeof prepareHallucinationContext>> | undefined
  if (validationType === 'hallucination') {
    try {
      hallucinationContext = await prepareHallucinationContext(input, inputString, context)
    } catch (error) {
      if (isAbortError(error) || context.signal?.aborted) throw error
      if (
        error instanceof GuardrailsOperationError ||
        error instanceof ProviderNotAllowedError ||
        error instanceof ModelNotAllowedError
      ) {
        if (error instanceof GuardrailsOperationError) throw error
        return failedVerdict(validationType, originalInput || '', error.message)
      }
      return failedVerdict(
        validationType,
        originalInput || '',
        getErrorMessage(error, 'Workflow not found or access denied.')
      )
    }
  }

  context.signal?.throwIfAborted()
  const result = await executeValidation(input, inputString, context, hallucinationContext)
  context.signal?.throwIfAborted()
  await recordHallucinationUsage(input, result, context, hallucinationContext)

  return {
    success: true,
    output: {
      passed: result.passed,
      validationType,
      input: originalInput,
      error: result.error,
      score: result.score,
      reasoning: result.reasoning,
      detectedEntities: result.detectedEntities,
      maskedText: result.maskedText,
    },
  }
}
