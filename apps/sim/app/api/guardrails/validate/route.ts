import { type NextRequest, NextResponse } from 'next/server'
import { validateHallucination } from '@/lib/guardrails/validate_hallucination'
import { validateJson } from '@/lib/guardrails/validate_json'
import { validatePII } from '@/lib/guardrails/validate_pii'
import { validateRegex } from '@/lib/guardrails/validate_regex'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('GuardrailsValidateAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Guardrails validation request received`)

  try {
    const body = await request.json()
    const {
      validationType,
      input,
      regex,
      knowledgeBaseId,
      threshold,
      topK,
      model,
      apiKey,
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

    const inputStr = convertInputToString(input)

    logger.info(`[${requestId}] Executing validation locally`, {
      validationType,
      inputType: typeof input,
    })

    const validationResult = await executeValidation(
      validationType,
      inputStr,
      regex,
      knowledgeBaseId,
      threshold,
      topK,
      model,
      apiKey,
      workflowId,
      piiEntityTypes,
      piiMode,
      piiLanguage,
      requestId
    )

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
}

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
  model: string,
  apiKey: string | undefined,
  workflowId: string | undefined,
  piiEntityTypes: string[] | undefined,
  piiMode: string | undefined,
  piiLanguage: string | undefined,
  requestId: string
): Promise<{
  passed: boolean
  error?: string
  score?: number
  reasoning?: string
  detectedEntities?: any[]
  maskedText?: string
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

    return await validateHallucination({
      userInput: inputStr,
      knowledgeBaseId,
      threshold: threshold != null ? Number.parseFloat(threshold) : 3, // Default threshold is 3 (confidence score, scores < 3 fail)
      topK: topK ? Number.parseInt(topK) : 10, // Default topK is 10
      model: model,
      apiKey,
      workflowId,
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
