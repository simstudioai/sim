import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import { guardrailsValidateContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { validateHallucination } from '@/lib/guardrails/validate_hallucination'
import { validateJson } from '@/lib/guardrails/validate_json'
import { validatePII } from '@/lib/guardrails/validate_pii'
import { validateRegex } from '@/lib/guardrails/validate_regex'
import {
  assertPermissionsAllowed,
  ModelNotAllowedError,
  ProviderNotAllowedError,
} from '@/ee/access-control/utils/permission-check'
import { getProviderFromModel } from '@/providers/utils'

const logger = createLogger('GuardrailsValidateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Guardrails validation request received`)

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(guardrailsValidateContract, request, {})
    if (!parsed.success) return parsed.response
    const { body } = parsed.data
    const {
      validationType,
      input,
      regex,
      knowledgeBaseId,
      threshold,
      topK,
      model,
      apiKey,
      azureEndpoint,
      azureApiVersion,
      vertexProject,
      vertexLocation,
      vertexCredential,
      bedrockAccessKeyId,
      bedrockSecretKey,
      bedrockRegion,
      workflowId,
      piiEntityTypes,
      piiMode,
      piiLanguage,
    } = body

    if (!validationType) {
      return NextResponse.json({
        success: true,
        output: {
          passed: false,
          validationType: 'unknown',
          input: input || '',
          error: 'Missing required field: validationType',
        },
      })
    }

    if (input === undefined || input === null) {
      return NextResponse.json({
        success: true,
        output: {
          passed: false,
          validationType,
          input: '',
          error: 'Input is missing or undefined',
        },
      })
    }

    if (
      validationType !== 'json' &&
      validationType !== 'regex' &&
      validationType !== 'hallucination' &&
      validationType !== 'pii'
    ) {
      return NextResponse.json({
        success: true,
        output: {
          passed: false,
          validationType,
          input: input || '',
          error: 'Invalid validationType. Must be "json", "regex", "hallucination", or "pii"',
        },
      })
    }

    if (validationType === 'regex' && !regex) {
      return NextResponse.json({
        success: true,
        output: {
          passed: false,
          validationType,
          input: input || '',
          error: 'Regex pattern is required for regex validation',
        },
      })
    }

    if (validationType === 'hallucination' && !model) {
      return NextResponse.json({
        success: true,
        output: {
          passed: false,
          validationType,
          input: input || '',
          error: 'Model is required for hallucination validation',
        },
      })
    }

    let resolvedWorkspaceId: string | undefined

    if (validationType === 'hallucination' && model) {
      if (!workflowId || typeof workflowId !== 'string') {
        return NextResponse.json({
          success: true,
          output: {
            passed: false,
            validationType,
            input: input || '',
            error:
              'Workflow context is required for hallucination validation. Call this endpoint via a workflow execution, not directly.',
          },
        })
      }

      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: auth.userId,
        action: 'read',
      })

      if (!authorization.allowed || !authorization.workflow?.workspaceId) {
        return NextResponse.json({
          success: true,
          output: {
            passed: false,
            validationType,
            input: input || '',
            error: authorization.message || 'Workflow not found or access denied.',
          },
        })
      }

      resolvedWorkspaceId = authorization.workflow.workspaceId

      try {
        await assertPermissionsAllowed({
          userId: auth.userId,
          workspaceId: resolvedWorkspaceId,
          model,
        })
      } catch (err) {
        if (err instanceof ProviderNotAllowedError || err instanceof ModelNotAllowedError) {
          return NextResponse.json({
            success: true,
            output: {
              passed: false,
              validationType,
              input: input || '',
              error: err.message,
            },
          })
        }
        throw err
      }

      // Gate the actor's usage before incurring hosted LLM + RAG cost. In a normal
      // workflow run this already passed at preprocessing; this also blocks direct
      // calls to this route by an over-limit or frozen actor.
      const usage = await checkActorUsageLimits(auth.userId, resolvedWorkspaceId)
      if (usage.isExceeded) {
        return NextResponse.json(
          { error: usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.' },
          { status: 402 }
        )
      }

      if (vertexCredential && getProviderFromModel(model) === 'vertex') {
        const vertexCredAccess = await authorizeCredentialUse(request, {
          credentialId: vertexCredential,
          workflowId,
          requireWorkflowIdForInternal: false,
        })
        if (!vertexCredAccess.ok) {
          logger.warn(`[${requestId}] Vertex credential access denied`, {
            error: vertexCredAccess.error,
            credentialId: vertexCredential,
          })
          return NextResponse.json(
            { error: vertexCredAccess.error || 'Unauthorized' },
            { status: 401 }
          )
        }
      }
    }

    const inputStr = convertInputToString(input)

    logger.info(`[${requestId}] Executing validation locally`, {
      validationType,
      inputType: typeof input,
    })
    const authHeaders = {
      cookie: request.headers.get('cookie') || undefined,
      authorization: request.headers.get('authorization') || undefined,
    }

    const validationResult = await executeValidation(
      validationType,
      inputStr,
      regex,
      knowledgeBaseId,
      threshold,
      topK,
      model,
      apiKey,
      {
        azureEndpoint,
        azureApiVersion,
        vertexProject,
        vertexLocation,
        vertexCredential,
        bedrockAccessKeyId,
        bedrockSecretKey,
        bedrockRegion,
      },
      workflowId,
      resolvedWorkspaceId,
      piiEntityTypes,
      piiMode,
      piiLanguage,
      authHeaders,
      requestId
    )

    // Bill the guardrail's LLM scoring cost (hallucination only; BYOK/non-hosted
    // already resolve to 0). Attributed to the caller + the workflow's workspace
    // so it lands in the per-member meter. Best-effort — never fail validation on
    // a billing error.
    if (
      resolvedWorkspaceId &&
      typeof validationResult.cost === 'number' &&
      validationResult.cost > 0
    ) {
      const { recordUsage } = await import('@/lib/billing/core/usage-log')
      await recordUsage({
        userId: auth.userId,
        workspaceId: resolvedWorkspaceId,
        entries: [
          {
            category: 'model',
            source: 'workflow',
            description: `guardrail-hallucination:${model ?? 'unknown'}`,
            cost: validationResult.cost,
            sourceReference: `guardrail:${workflowId ?? 'unknown'}:${requestId}`,
          },
        ],
      }).catch((billingError) => {
        logger.error(`[${requestId}] Failed to record guardrail usage`, { error: billingError })
      })
    }

    logger.info(`[${requestId}] Validation completed`, {
      passed: validationResult.passed,
      hasError: !!validationResult.error,
      score: validationResult.score,
    })

    return NextResponse.json({
      success: true,
      output: {
        passed: validationResult.passed,
        validationType,
        input,
        error: validationResult.error,
        score: validationResult.score,
        reasoning: validationResult.reasoning,
        detectedEntities: validationResult.detectedEntities,
        maskedText: validationResult.maskedText,
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Guardrails validation failed`, { error })
    return NextResponse.json({
      success: true,
      output: {
        passed: false,
        validationType: 'unknown',
        input: '',
        error: error.message || 'Validation failed due to unexpected error',
      },
    })
  }
})

/**
 * Convert input to string for validation
 */
function convertInputToString(input: any): string {
  if (typeof input === 'string') {
    return input
  }
  if (input === null || input === undefined) {
    return ''
  }
  if (typeof input === 'object') {
    return JSON.stringify(input)
  }
  return String(input)
}

/**
 * Execute validation using TypeScript validators
 */
async function executeValidation(
  validationType: string,
  inputStr: string,
  regex: string | undefined,
  knowledgeBaseId: string | undefined,
  threshold: string | undefined,
  topK: string | undefined,
  model: string | undefined,
  apiKey: string | undefined,
  providerCredentials: {
    azureEndpoint?: string
    azureApiVersion?: string
    vertexProject?: string
    vertexLocation?: string
    vertexCredential?: string
    bedrockAccessKeyId?: string
    bedrockSecretKey?: string
    bedrockRegion?: string
  },
  workflowId: string | undefined,
  workspaceId: string | undefined,
  piiEntityTypes: string[] | undefined,
  piiMode: string | undefined,
  piiLanguage: string | undefined,
  authHeaders: { cookie?: string; authorization?: string } | undefined,
  requestId: string
): Promise<{
  passed: boolean
  error?: string
  score?: number
  reasoning?: string
  detectedEntities?: any[]
  maskedText?: string
  cost?: number
}> {
  // Use TypeScript validators for all validation types
  if (validationType === 'json') {
    return validateJson(inputStr)
  }
  if (validationType === 'regex') {
    if (!regex) {
      return {
        passed: false,
        error: 'Regex pattern is required',
      }
    }
    return validateRegex(inputStr, regex)
  }
  if (validationType === 'hallucination') {
    if (!knowledgeBaseId) {
      return {
        passed: false,
        error: 'Knowledge base ID is required for hallucination check',
      }
    }
    if (!model) {
      return {
        passed: false,
        error: 'Model is required for hallucination validation',
      }
    }

    return await validateHallucination({
      userInput: inputStr,
      knowledgeBaseId,
      threshold: threshold != null ? Number.parseFloat(threshold) : 3, // Default threshold is 3 (confidence score, scores < 3 fail)
      topK: topK ? Number.parseInt(topK) : 10, // Default topK is 10
      model: model,
      apiKey,
      providerCredentials,
      workflowId,
      workspaceId,
      authHeaders,
      requestId,
    })
  }
  if (validationType === 'pii') {
    return await validatePII({
      text: inputStr,
      entityTypes: piiEntityTypes || [], // Empty array = detect all PII types
      mode: (piiMode as 'block' | 'mask') || 'block', // Default to block mode
      language: piiLanguage || 'en',
      requestId,
    })
  }
  return {
    passed: false,
    error: 'Unknown validation type',
  }
}
