import { db } from '@sim/db'
import { userStats, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import OpenAI, { AzureOpenAI } from 'openai'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getSession } from '@/lib/auth'
import { logModelUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isBillingEnabled } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
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

const client = useWandAzure
  ? new AzureOpenAI({
      apiKey: azureApiKey,
      apiVersion: azureApiVersion,
      endpoint: azureEndpoint,
    })
  : openaiApiKey
    ? new OpenAI({
        apiKey: openaiApiKey,
      })
    : null

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
    let activeClient = client
    let byokApiKey: string | null = null

    if (workspaceId && !useWandAzure) {
      const byokResult = await getBYOKKey(workspaceId, 'openai')
      if (byokResult) {
        isBYOK = true
        byokApiKey = byokResult.apiKey
        activeClient = new OpenAI({ apiKey: byokResult.apiKey })
        logger.info(`[${requestId}] Using BYOK OpenAI key for wand generation`)
      }
    }

    if (!activeClient) {
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
          ? `${azureEndpoint}/openai/deployments/${wandModelName}/chat/completions?api-version=${azureApiVersion}`
          : 'https://api.openai.com/v1/chat/completions'

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }

        if (useWandAzure) {
          headers['api-key'] = azureApiKey!
        } else {
          headers.Authorization = `Bearer ${byokApiKey || openaiApiKey}`
        }

        logger.debug(`[${requestId}] Making streaming request to: ${apiUrl}`)

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: useWandAzure ? wandModelName : 'gpt-4o',
            messages: messages,
            temperature: 0.2,
            max_tokens: 10000,
            stream: true,
            stream_options: { include_usage: true },
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

            try {
              let buffer = ''
              let chunkCount = 0
              let finalUsage: any = null

              while (true) {
                const { done, value } = await reader.read()

                if (done) {
                  logger.info(`[${requestId}] Stream completed. Total chunks: ${chunkCount}`)
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
                  controller.close()
                  break
                }

                buffer += decoder.decode(value, { stream: true })

                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim()

                    if (data === '[DONE]') {
                      logger.info(`[${requestId}] Received [DONE] signal`)

                      if (finalUsage) {
                        await updateUserStatsForWand(session.user.id, finalUsage, requestId, isBYOK)
                      }

                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
                      )
                      controller.close()
                      return
                    }

                    try {
                      const parsed = JSON.parse(data)
                      const content = parsed.choices?.[0]?.delta?.content

                      if (content) {
                        chunkCount++
                        if (chunkCount === 1) {
                          logger.info(`[${requestId}] Received first content chunk`)
                        }

                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`)
                        )
                      }

                      if (parsed.usage) {
                        finalUsage = parsed.usage
                        logger.info(
                          `[${requestId}] Received usage data: ${JSON.stringify(parsed.usage)}`
                        )
                      }
                    } catch (parseError) {
                      logger.debug(
                        `[${requestId}] Skipped non-JSON line: ${data.substring(0, 100)}`
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
          responseStatus: error?.response?.status,
          responseData: error?.response?.data ? safeStringify(error.response.data) : undefined,
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

    const completion = await activeClient.chat.completions.create({
      model: useWandAzure ? wandModelName : 'gpt-4o',
      messages: messages,
      temperature: 0.3,
      max_tokens: 10000,
    })

    const generatedContent = completion.choices[0]?.message?.content?.trim()

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

    if (completion.usage) {
      await updateUserStatsForWand(session.user.id, completion.usage, requestId, isBYOK)
    }

    return NextResponse.json({ success: true, content: generatedContent })
  } catch (error: any) {
    logger.error(`[${requestId}] Wand generation failed`, {
      name: error?.name,
      message: error?.message || 'Unknown error',
      code: error?.code,
      status: error?.status,
      responseStatus: error instanceof OpenAI.APIError ? error.status : error?.response?.status,
      responseData: (error as any)?.response?.data
        ? safeStringify((error as any).response.data)
        : undefined,
      stack: error?.stack,
      useWandAzure,
      model: useWandAzure ? wandModelName : 'gpt-4o',
      endpoint: useWandAzure ? azureEndpoint : 'api.openai.com',
      apiVersion: useWandAzure ? azureApiVersion : 'N/A',
    })

    let clientErrorMessage = 'Wand generation failed. Please try again later.'
    let status = 500

    if (error instanceof OpenAI.APIError) {
      status = error.status || 500
      logger.error(
        `[${requestId}] ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} API Error: ${status} - ${error.message}`
      )

      if (status === 401) {
        clientErrorMessage = 'Authentication failed. Please check your API key configuration.'
      } else if (status === 429) {
        clientErrorMessage = 'Rate limit exceeded. Please try again later.'
      } else if (status >= 500) {
        clientErrorMessage =
          'The wand generation service is currently unavailable. Please try again later.'
      }
    } else if (useWandAzure && error.message?.includes('DeploymentNotFound')) {
      clientErrorMessage =
        'Azure OpenAI deployment not found. Please check your model deployment configuration.'
      status = 404
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
