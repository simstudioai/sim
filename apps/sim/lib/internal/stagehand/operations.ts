import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { isSensitiveKey, REDACTED_MARKER } from '@/lib/core/security/redaction'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  createStagehandSession,
  getBrowserbaseApiKey,
  hasBrowserbaseConfiguration,
  type StagehandSession,
} from '@/lib/internal/stagehand/client'
import type { StagehandAgentInput, StagehandExtractInput } from '@/lib/internal/stagehand/schema'
import { ensureZodObject, normalizeStagehandUrl } from '@/lib/internal/stagehand/schema-conversion'

const logger = createLogger('StagehandOperations')
const MAX_BROWSERBASE_DEBUG_RESPONSE_BYTES = 256 * 1024

export interface StagehandOperationContext {
  signal?: AbortSignal
}

function getSchemaObject(outputSchema: unknown): Record<string, unknown> | undefined {
  if (!isRecordLike(outputSchema)) return undefined
  return isRecordLike(outputSchema.schema) ? outputSchema.schema : outputSchema
}

function formatSchemaForInstructions(schema: Record<string, unknown>): string {
  try {
    return JSON.stringify(schema, null, 2)
  } catch (error) {
    logger.error('Error formatting schema for instructions', { error })
    return JSON.stringify(schema)
  }
}

function processVariables(variables: unknown): Record<string, string> | undefined {
  if (!variables) return undefined
  let parsed: unknown = variables
  if (typeof variables === 'string') {
    try {
      parsed = JSON.parse(variables) as unknown
    } catch {
      logger.warn('Failed to parse variables string as JSON')
      return undefined
    }
  }

  const result: Record<string, string> = {}
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!isRecordLike(item) || !isRecordLike(item.cells) || typeof item.cells.Key !== 'string') {
        continue
      }
      result[item.cells.Key] = String(item.cells.Value ?? '')
    }
  } else if (isRecordLike(parsed)) {
    for (const [key, value] of Object.entries(parsed)) result[key] = String(value ?? '')
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function substituteVariables(text: string, variables?: Record<string, string>): string {
  if (!variables) return text
  let result = text
  for (const [key, value] of Object.entries(variables)) {
    result = result.split(`%${key}%`).join(value)
  }
  return result
}

function validateProviderApiKey(
  provider: 'openai' | 'anthropic',
  apiKey: string
): Response | undefined {
  if (!apiKey) return Response.json({ error: 'API key is required' }, { status: 400 })
  if (provider === 'openai' && !apiKey.startsWith('sk-')) {
    return Response.json({ error: 'Invalid OpenAI API key format' }, { status: 400 })
  }
  if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
    return Response.json({ error: 'Invalid Anthropic API key format' }, { status: 400 })
  }
  return undefined
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return {}
  const details: Record<string, unknown> = { name: error.name, stack: error.stack }
  if (isRecordLike(error)) {
    if (error.code !== undefined) details.code = error.code
    if (error.statusCode !== undefined) details.statusCode = error.statusCode
    if (error.response !== undefined) details.response = error.response
  }
  return details
}

async function getLiveViewUrl(sessionId: string, signal?: AbortSignal): Promise<string | null> {
  const browserbaseApiKey = getBrowserbaseApiKey()
  if (!browserbaseApiKey) return null
  try {
    const response = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/debug`, {
      method: 'GET',
      headers: { 'X-BB-API-Key': browserbaseApiKey },
      signal,
    })
    if (!response.ok) return null
    const data = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_BROWSERBASE_DEBUG_RESPONSE_BYTES,
      label: 'Browserbase debug response',
      signal,
    })
    if (!isRecordLike(data)) return null
    if (typeof data.debuggerFullscreenUrl === 'string') return data.debuggerFullscreenUrl
    return typeof data.debuggerUrl === 'string' ? data.debuggerUrl : null
  } catch (error) {
    signal?.throwIfAborted()
    logger.warn('Error fetching Browserbase debug URL', { error })
    return null
  }
}

export async function executeStagehandAgent(
  input: StagehandAgentInput,
  context: StagehandOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  let session: StagehandSession | undefined
  let sessionId: string | null = null
  let liveViewUrl: string | null = null

  try {
    const startUrl = normalizeStagehandUrl(input.startUrl)
    const urlValidation = await validateUrlWithDNS(startUrl, 'startUrl')
    context.signal?.throwIfAborted()
    if (!urlValidation.isValid) {
      return Response.json({ error: urlValidation.error }, { status: 400 })
    }
    if (!hasBrowserbaseConfiguration()) {
      return Response.json(
        { error: 'Server configuration error: Missing required environment variables' },
        { status: 500 }
      )
    }
    const apiKeyError = validateProviderApiKey(input.provider, input.apiKey)
    if (apiKeyError) return apiKeyError

    try {
      session = await createStagehandSession({
        provider: input.provider,
        apiKey: input.apiKey,
        disableApi: true,
        signal: context.signal,
      })
      const { stagehand } = session
      sessionId = stagehand.browserbaseSessionID ?? null
      if (sessionId) liveViewUrl = await getLiveViewUrl(sessionId, context.signal)

      const page = stagehand.context.pages()[0]
      await session.run(page.goto(startUrl, { waitUntil: 'networkidle' }))

      const variables = processVariables(input.variables)
      const task = substituteVariables(input.task, variables)
      let instructions = `You are a helpful web browsing assistant. Complete the following task: ${task}`
      if (variables) {
        const safeKeys = Object.keys(variables).map((key) =>
          isSensitiveKey(key) ? `${key}: ${REDACTED_MARKER}` : key
        )
        logger.info('Variables available for task', { variables: safeKeys })
      }
      const schemaObject = getSchemaObject(input.outputSchema)
      if (schemaObject) {
        instructions += `\n\nIMPORTANT: You MUST return your final result in the following JSON format exactly:\n${formatSchemaForInstructions(schemaObject)}\n\nYour response should consist of valid JSON only, with no additional text.`
      }

      const modelName =
        input.provider === 'anthropic' ? 'anthropic/claude-sonnet-4-6' : 'openai/gpt-5'
      const agent = stagehand.agent({
        model: { modelName, apiKey: input.apiKey },
        executionModel: { modelName, apiKey: input.apiKey },
        systemPrompt: instructions,
        mode: input.mode,
      })
      const execution = await session.run(
        agent.execute({ instruction: task, maxSteps: input.maxSteps })
      )
      const agentResult = {
        success: execution.success,
        completed: execution.completed,
        message: execution.message,
        actions: execution.actions,
      }

      let structuredOutput: unknown = null
      if (agentResult.message) {
        try {
          let jsonContent = agentResult.message
          const jsonBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
          if (jsonBlockMatch?.[1]) jsonContent = jsonBlockMatch[1]
          structuredOutput = JSON.parse(jsonContent) as unknown
        } catch (error) {
          if (schemaObject) {
            logger.warn('Failed to parse JSON from agent message, attempting fallback extraction', {
              error,
            })
            try {
              const zodSchema = ensureZodObject(logger, schemaObject)
              structuredOutput = await session.run(
                stagehand.extract(
                  'Extract the requested information from this page according to the schema',
                  zodSchema
                )
              )
            } catch (extractError) {
              context.signal?.throwIfAborted()
              logger.error('Fallback extraction also failed', { error: extractError })
            }
          }
        }
      }

      return Response.json({ agentResult, structuredOutput, liveViewUrl, sessionId })
    } catch (error) {
      context.signal?.throwIfAborted()
      return Response.json(
        {
          error: getErrorMessage(error, 'Unknown error during agent execution'),
          details: errorDetails(error),
          liveViewUrl,
          sessionId,
        },
        { status: 500 }
      )
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    return Response.json(
      { error: 'Internal server error', details: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  } finally {
    await session?.close()
  }
}

export async function executeStagehandExtract(
  input: StagehandExtractInput,
  context: StagehandOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  let session: StagehandSession | undefined

  try {
    const url = normalizeStagehandUrl(input.url)
    const urlValidation = await validateUrlWithDNS(url, 'url')
    context.signal?.throwIfAborted()
    if (!urlValidation.isValid) {
      return Response.json({ error: urlValidation.error }, { status: 400 })
    }
    if (!isRecordLike(input.schema)) {
      return Response.json(
        { error: 'Invalid schema format. Schema must be a valid JSON object.' },
        { status: 400 }
      )
    }
    if (!hasBrowserbaseConfiguration()) {
      return Response.json(
        { error: 'Server configuration error: Missing required environment variables' },
        { status: 500 }
      )
    }
    const apiKeyError = validateProviderApiKey(input.provider, input.apiKey)
    if (apiKeyError) return apiKeyError

    try {
      session = await createStagehandSession({
        provider: input.provider,
        apiKey: input.apiKey,
        disableApi: false,
        signal: context.signal,
      })
      const { stagehand } = session
      const page = stagehand.context.pages()[0]
      await session.run(page.goto(url, { waitUntil: 'networkidle' }))

      const schemaObject = isRecordLike(input.schema.schema) ? input.schema.schema : input.schema
      let zodSchema
      try {
        zodSchema = ensureZodObject(logger, schemaObject)
      } catch (error) {
        logger.error('Failed to convert JSON schema to Zod schema', { error })
      }
      const data = zodSchema
        ? await session.run(stagehand.extract(input.instruction, zodSchema))
        : await session.run(stagehand.extract(input.instruction))
      return Response.json({ data, schema: input.schema })
    } catch (error) {
      context.signal?.throwIfAborted()
      return Response.json(
        {
          error: getErrorMessage(error, 'Unknown error during extraction'),
          details: errorDetails(error),
        },
        { status: 500 }
      )
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    return Response.json(
      { error: 'Internal server error', details: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  } finally {
    await session?.close()
  }
}
