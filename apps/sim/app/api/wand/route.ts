import { db } from '@sim/db'
import { userStats, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getSession } from '@/lib/auth'
import { logModelUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isBillingEnabled } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import { extractResponseText, parseResponsesUsage } from '@/providers/openai/utils'
import { getModelPricing } from '@/providers/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const logger = createLogger('WandGenerateAPI')

const azureApiKey = env.AZURE_OPENAI_API_KEY
const azureEndpoint = env.AZURE_OPENAI_ENDPOINT
const azureApiVersion = env.AZURE_OPENAI_API_VERSION
const wandModelName = env.WAND_OPENAI_MODEL_NAME || 'gpt-4o'
const openaiApiKey = env.OPENAI_API_KEY

const useWandAzure = azureApiKey && azureEndpoint && azureApiVersion

if (!useWandAzure && !openaiApiKey) {
  logger.warn(
    'Neither Azure OpenAI nor OpenAI API key found. Wand generation API will not function.'
  )
} else {
  logger.info(`Using ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} for wand generation`)
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface RequestBody {
  prompt: string
  systemPrompt?: string
  stream?: boolean
  history?: ChatMessage[]
  workflowId?: string
  generationType?: string
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

async function updateUserStatsForWand(
  userId: string,
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  },
  requestId: string,
  isBYOK = false
): Promise<void> {
  if (!isBillingEnabled) {
    logger.debug(`[${requestId}] Billing is disabled, skipping wand usage cost update`)
    return
  }

  if (!usage.total_tokens || usage.total_tokens <= 0) {
    logger.debug(`[${requestId}] No tokens to update in user stats`)
    return
  }

  try {
    const totalTokens = usage.total_tokens || 0
    const promptTokens = usage.prompt_tokens || 0
    const completionTokens = usage.completion_tokens || 0

    const modelName = useWandAzure ? wandModelName : 'gpt-4o'
    let costToStore = 0

    if (!isBYOK) {
      const pricing = getModelPricing(modelName)
      const costMultiplier = getCostMultiplier()
      let modelCost = 0

      if (pricing) {
        const inputCost = (promptTokens / 1000000) * pricing.input
        const outputCost = (completionTokens / 1000000) * pricing.output
        modelCost = inputCost + outputCost
      } else {
        modelCost = (promptTokens / 1000000) * 0.005 + (completionTokens / 1000000) * 0.015
      }

      costToStore = modelCost * costMultiplier
    }

    await db
      .update(userStats)
      .set({
        totalTokensUsed: sql`total_tokens_used + ${totalTokens}`,
        totalCost: sql`total_cost + ${costToStore}`,
        currentPeriodCost: sql`current_period_cost + ${costToStore}`,
        lastActive: new Date(),
      })
      .where(eq(userStats.userId, userId))

    logger.debug(`[${requestId}] Updated user stats for wand usage`, {
      userId,
      tokensUsed: totalTokens,
      costAdded: costToStore,
      isBYOK,
    })

    await logModelUsage({
      userId,
      source: 'wand',
      model: modelName,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cost: costToStore,
    })

    await checkAndBillOverageThreshold(userId)
  } catch (error) {
    logger.error(`[${requestId}] Failed to update user stats for wand usage`, error)
  }
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Received wand generation request`)

  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized wand generation attempt`)
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await req.json()) as RequestBody

    const { prompt, systemPrompt, stream = false, history = [], workflowId, generationType } = body

    if (!prompt) {
      logger.warn(`[${requestId}] Invalid request: Missing prompt.`)
      return NextResponse.json(
        { success: false, error: 'Missing required field: prompt.' },
        { status: 400 }
      )
    }

    let workspaceId: string | null = null
    if (workflowId) {
      const [workflowRecord] = await db
        .select({ workspaceId: workflow.workspaceId, userId: workflow.userId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowRecord) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 })
      }

      workspaceId = workflowRecord.workspaceId

      if (workflowRecord.workspaceId) {
        const permission = await verifyWorkspaceMembership(
          session.user.id,
          workflowRecord.workspaceId
        )
        if (!permission || (permission !== 'admin' && permission !== 'write')) {
          logger.warn(
            `[${requestId}] User ${session.user.id} does not have write access to workspace for workflow ${workflowId}`
          )
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
        }
      } else if (workflowRecord.userId !== session.user.id) {
        logger.warn(`[${requestId}] User ${session.user.id} does not own workflow ${workflowId}`)
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 })
      }
    }

    let isBYOK = false
    let activeOpenAIKey = openaiApiKey

    if (workspaceId && !useWandAzure) {
      const byokResult = await getBYOKKey(workspaceId, 'openai')
      if (byokResult) {
        isBYOK = true
        activeOpenAIKey = byokResult.apiKey
        logger.info(`[${requestId}] Using BYOK OpenAI key for wand generation`)
      }
    }

    if (!useWandAzure && !activeOpenAIKey) {
      logger.error(`[${requestId}] AI client not initialized. Missing API key.`)
      return NextResponse.json(
        { success: false, error: 'Wand generation service is not configured.' },
        { status: 503 }
      )
    }

    let finalSystemPrompt =
      systemPrompt ||
      'You are a helpful AI assistant. Generate content exactly as requested by the user.'

    if (generationType === 'timestamp') {
      const now = new Date()
      const currentTimeContext = `\n\nCurrent date and time context for reference:
- Current UTC timestamp: ${now.toISOString()}
- Current Unix timestamp (seconds): ${Math.floor(now.getTime() / 1000)}
- Current Unix timestamp (milliseconds): ${now.getTime()}
- Current date (UTC): ${now.toISOString().split('T')[0]}
- Current year: ${now.getUTCFullYear()}
- Current month: ${now.getUTCMonth() + 1}
- Current day of month: ${now.getUTCDate()}
- Current day of week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()]}

Use this context to calculate relative dates like "yesterday", "last week", "beginning of this month", etc.`
      finalSystemPrompt += currentTimeContext
    }

    if (generationType === 'json-object') {
      finalSystemPrompt +=
        '\n\nIMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (no ```json or ```). Do NOT include any explanation or text before or after the JSON. The response must start with { and end with }.'
    }

    const messages: ChatMessage[] = [{ role: 'system', content: finalSystemPrompt }]

    messages.push(...history.filter((msg) => msg.role !== 'system'))

    messages.push({ role: 'user', content: prompt })

    logger.debug(
      `[${requestId}] Calling ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} API for wand generation`,
      {
        stream,
        historyLength: history.length,
        endpoint: useWandAzure ? azureEndpoint : 'api.openai.com',
        model: useWandAzure ? wandModelName : 'gpt-4o',
        apiVersion: useWandAzure ? azureApiVersion : 'N/A',
      }
    )

    if (stream) {
      try {
        logger.debug(
          `[${requestId}] Starting streaming request to ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'}`
        )

        logger.info(
          `[${requestId}] About to create stream with model: ${useWandAzure ? wandModelName : 'gpt-4o'}`
        )

        const apiUrl = useWandAzure
          ? `${azureEndpoint?.replace(/\/$/, '')}/openai/v1/responses?api-version=${azureApiVersion}`
          : 'https://api.openai.com/v1/responses'

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'responses=v1',
        }

        if (useWandAzure) {
          headers['api-key'] = azureApiKey!
        } else {
          headers.Authorization = `Bearer ${activeOpenAIKey}`
        }

        logger.debug(`[${requestId}] Making streaming request to: ${apiUrl}`)

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: useWandAzure ? wandModelName : 'gpt-4o',
            input: messages,
            temperature: 0.2,
            max_output_tokens: 10000,
            stream: true,
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          logger.error(`[${requestId}] API request failed`, {
            status: response.status,
            statusText: response.statusText,
            error: errorText,
          })
          throw new Error(`API request failed: ${response.status} ${response.statusText}`)
        }

        logger.info(`[${requestId}] Stream response received, starting processing`)

        const encoder = new TextEncoder()
        const decoder = new TextDecoder()

        const readable = new ReadableStream({
          async start(controller) {
            const reader = response.body?.getReader()
            if (!reader) {
              controller.close()
              return
            }

            let finalUsage: any = null
            let usageRecorded = false

            const recordUsage = async () => {
              if (usageRecorded || !finalUsage) {
                return
              }

              usageRecorded = true
              await updateUserStatsForWand(session.user.id, finalUsage, requestId, isBYOK)
            }

            try {
              let buffer = ''
              let chunkCount = 0
              let activeEventType: string | undefined

              while (true) {
                const { done, value } = await reader.read()

                if (done) {
                  logger.info(`[${requestId}] Stream completed. Total chunks: ${chunkCount}`)
                  await recordUsage()
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
                  controller.close()
                  break
                }

                buffer += decoder.decode(value, { stream: true })

                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                  const trimmed = line.trim()
                  if (!trimmed) {
                    continue
                  }

                  if (trimmed.startsWith('event:')) {
                    activeEventType = trimmed.slice(6).trim()
                    continue
                  }

                  if (!trimmed.startsWith('data:')) {
                    continue
                  }

                  const data = trimmed.slice(5).trim()
                  if (data === '[DONE]') {
                    logger.info(`[${requestId}] Received [DONE] signal`)

                    await recordUsage()

                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
                    )
                    controller.close()
                    return
                  }

                  let parsed: any
                  try {
                    parsed = JSON.parse(data)
                  } catch (parseError) {
                    logger.debug(`[${requestId}] Skipped non-JSON line: ${data.substring(0, 100)}`)
                    continue
                  }

                  const eventType = parsed?.type ?? activeEventType

                  if (
                    eventType === 'response.error' ||
                    eventType === 'error' ||
                    eventType === 'response.failed'
                  ) {
                    throw new Error(parsed?.error?.message || 'Responses stream error')
                  }

                  if (
                    eventType === 'response.output_text.delta' ||
                    eventType === 'response.output_json.delta'
                  ) {
                    let content = ''
                    if (typeof parsed.delta === 'string') {
                      content = parsed.delta
                    } else if (parsed.delta && typeof parsed.delta.text === 'string') {
                      content = parsed.delta.text
                    } else if (parsed.delta && parsed.delta.json !== undefined) {
                      content = JSON.stringify(parsed.delta.json)
                    } else if (parsed.json !== undefined) {
                      content = JSON.stringify(parsed.json)
                    } else if (typeof parsed.text === 'string') {
                      content = parsed.text
                    }

                    if (content) {
                      chunkCount++
                      if (chunkCount === 1) {
                        logger.info(`[${requestId}] Received first content chunk`)
                      }

                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`)
                      )
                    }
                  }

                  if (eventType === 'response.completed') {
                    const usage = parseResponsesUsage(parsed?.response?.usage ?? parsed?.usage)
                    if (usage) {
                      finalUsage = {
                        prompt_tokens: usage.promptTokens,
                        completion_tokens: usage.completionTokens,
                        total_tokens: usage.totalTokens,
                      }
                      logger.info(
                        `[${requestId}] Received usage data: ${JSON.stringify(finalUsage)}`
                      )
                    }
                  }
                }
              }
            } catch (streamError: any) {
              logger.error(`[${requestId}] Streaming error`, {
                name: streamError?.name,
                message: streamError?.message || 'Unknown error',
                stack: streamError?.stack,
              })

              try {
                await recordUsage()
              } catch (usageError) {
                logger.warn(`[${requestId}] Failed to record usage after stream error`, usageError)
              }

              const errorData = `data: ${JSON.stringify({ error: 'Streaming failed', done: true })}\n\n`
              controller.enqueue(encoder.encode(errorData))
              controller.close()
            } finally {
              reader.releaseLock()
            }
          },
        })

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      } catch (error: any) {
        logger.error(`[${requestId}] Failed to create stream`, {
          name: error?.name,
          message: error?.message || 'Unknown error',
          code: error?.code,
          status: error?.status,
          stack: error?.stack,
          useWandAzure,
          model: useWandAzure ? wandModelName : 'gpt-4o',
          endpoint: useWandAzure ? azureEndpoint : 'api.openai.com',
          apiVersion: useWandAzure ? azureApiVersion : 'N/A',
        })

        return NextResponse.json(
          { success: false, error: 'An error occurred during wand generation streaming.' },
          { status: 500 }
        )
      }
    }

    const apiUrl = useWandAzure
      ? `${azureEndpoint?.replace(/\/$/, '')}/openai/v1/responses?api-version=${azureApiVersion}`
      : 'https://api.openai.com/v1/responses'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'responses=v1',
    }

    if (useWandAzure) {
      headers['api-key'] = azureApiKey!
    } else {
      headers.Authorization = `Bearer ${activeOpenAIKey}`
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: useWandAzure ? wandModelName : 'gpt-4o',
        input: messages,
        temperature: 0.2,
        max_output_tokens: 10000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      const apiError = new Error(
        `API request failed: ${response.status} ${response.statusText} - ${errorText}`
      )
      ;(apiError as any).status = response.status
      throw apiError
    }

    const completion = await response.json()
    const generatedContent = extractResponseText(completion.output)?.trim()

    if (!generatedContent) {
      logger.error(
        `[${requestId}] ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} response was empty or invalid.`
      )
      return NextResponse.json(
        { success: false, error: 'Failed to generate content. AI response was empty.' },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Wand generation successful`)

    const usage = parseResponsesUsage(completion.usage)
    if (usage) {
      await updateUserStatsForWand(
        session.user.id,
        {
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          total_tokens: usage.totalTokens,
        },
        requestId,
        isBYOK
      )
    }

    return NextResponse.json({ success: true, content: generatedContent })
  } catch (error: any) {
    logger.error(`[${requestId}] Wand generation failed`, {
      name: error?.name,
      message: error?.message || 'Unknown error',
      code: error?.code,
      status: error?.status,
      stack: error?.stack,
      useWandAzure,
      model: useWandAzure ? wandModelName : 'gpt-4o',
      endpoint: useWandAzure ? azureEndpoint : 'api.openai.com',
      apiVersion: useWandAzure ? azureApiVersion : 'N/A',
    })

    let clientErrorMessage = 'Wand generation failed. Please try again later.'
    let status = typeof (error as any)?.status === 'number' ? (error as any).status : 500

    if (useWandAzure && error?.message?.includes('DeploymentNotFound')) {
      clientErrorMessage =
        'Azure OpenAI deployment not found. Please check your model deployment configuration.'
      status = 404
    } else if (status === 401) {
      clientErrorMessage = 'Authentication failed. Please check your API key configuration.'
    } else if (status === 429) {
      clientErrorMessage = 'Rate limit exceeded. Please try again later.'
    } else if (status >= 500) {
      clientErrorMessage =
        'The wand generation service is currently unavailable. Please try again later.'
    }

    return NextResponse.json(
      {
        success: false,
        error: clientErrorMessage,
      },
      { status }
    )
  }
}
