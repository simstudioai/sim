import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  buildOpenCodeSessionMemoryKey,
  buildOpenCodeSessionTitle,
  createOpenCodeSession,
  getStoredOpenCodeSession,
  logOpenCodeFailure,
  promptOpenCodeSession,
  resolveOpenCodeRepositoryOption,
  shouldRetryWithFreshOpenCodeSession,
  storeOpenCodeSession,
} from '@/lib/opencode/service'
import { coerceOpenCodeBoolean } from '@/lib/opencode/utils'

const logger = createLogger('OpenCodePromptToolAPI')

const optionalTrimmedStringSchema = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional()
)

const OpenCodePromptSchema = z.object({
  repository: z.string().min(1, 'repository is required'),
  systemPrompt: optionalTrimmedStringSchema,
  providerId: z.string().min(1, 'providerId is required'),
  modelId: z.string().min(1, 'modelId is required'),
  agent: optionalTrimmedStringSchema,
  prompt: z.string().min(1, 'prompt is required'),
  newThread: z.union([z.boolean(), z.string()]).optional(),
  _context: z
    .object({
      workspaceId: z.string().optional(),
      workflowId: z.string().optional(),
      userId: z.string().optional(),
      executionId: z.string().optional(),
    })
    .passthrough()
    .optional(),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getSessionOwnerKey(params: z.infer<typeof OpenCodePromptSchema>): string {
  if (params._context?.userId) {
    return `user:${params._context.userId}`
  }

  if (params._context?.executionId) {
    return `execution:${params._context.executionId}`
  }

  return 'anonymous'
}

function buildSuccessResponse(threadId: string, content: string, cost?: number): NextResponse {
  return NextResponse.json({
    success: true,
    output: {
      content,
      threadId,
      ...(typeof cost === 'number' ? { cost } : {}),
    },
  })
}

function buildErrorResponse(
  threadId: string,
  content: string,
  cost: number | undefined,
  error: string
): NextResponse {
  return NextResponse.json({
    success: true,
    output: {
      content,
      threadId,
      ...(typeof cost === 'number' ? { cost } : {}),
      error,
    },
  })
}

async function executePrompt(
  params: z.infer<typeof OpenCodePromptSchema>,
  repository: string,
  repositoryOption: Awaited<ReturnType<typeof resolveOpenCodeRepositoryOption>>,
  threadId: string,
  prompt: string,
  providerId: string,
  modelId: string
) {
  return promptOpenCodeSession({
    repository,
    repositoryOption,
    sessionId: threadId,
    prompt,
    systemPrompt: params.systemPrompt?.trim() || undefined,
    providerId,
    modelId,
    agent: params.agent?.trim() || undefined,
  })
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized OpenCode prompt request`)
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
    }

    const body = OpenCodePromptSchema.parse(await request.json())
    const workspaceId = body._context?.workspaceId
    const workflowId = body._context?.workflowId

    if (!workspaceId || !workflowId) {
      return NextResponse.json(
        { error: 'workspaceId and workflowId are required in execution context' },
        { status: 400 }
      )
    }

    const repositoryOption = await resolveOpenCodeRepositoryOption(body.repository.trim())
    const repositoryId = repositoryOption.id
    const prompt = body.prompt.trim()
    const providerId = body.providerId.trim()
    const modelId = body.modelId.trim()
    const sessionOwnerKey = getSessionOwnerKey(body)
    const memoryKey = buildOpenCodeSessionMemoryKey(workflowId, sessionOwnerKey)
    const newThread = coerceOpenCodeBoolean(body.newThread)
    const storedThread = newThread ? null : await getStoredOpenCodeSession(workspaceId, memoryKey)
    const reusedStoredThread = Boolean(storedThread && storedThread.repository === repositoryId)
    let threadId =
      reusedStoredThread ? storedThread.sessionId : undefined

    if (!threadId) {
      const session = await createOpenCodeSession(
        repositoryOption,
        buildOpenCodeSessionTitle(repositoryId, sessionOwnerKey)
      )
      threadId = session.id
    }

    try {
      const result = await executePrompt(
        body,
        repositoryId,
        repositoryOption,
        threadId,
        prompt,
        providerId,
        modelId
      )

      await storeOpenCodeSession(workspaceId, memoryKey, {
        sessionId: result.threadId,
        repository: repositoryId,
        updatedAt: new Date().toISOString(),
      })

      if (result.assistantError) {
        return buildErrorResponse(
          result.threadId,
          result.content,
          result.cost,
          result.assistantError
        )
      }

      return buildSuccessResponse(result.threadId, result.content, result.cost)
    } catch (error) {
      if (reusedStoredThread && threadId && !newThread && shouldRetryWithFreshOpenCodeSession(error)) {
        let freshSessionId = threadId

        try {
          const freshSession = await createOpenCodeSession(
            repositoryOption,
            buildOpenCodeSessionTitle(repositoryId, sessionOwnerKey)
          )
          freshSessionId = freshSession.id

          await storeOpenCodeSession(workspaceId, memoryKey, {
            sessionId: freshSessionId,
            repository: repositoryId,
            updatedAt: new Date().toISOString(),
          })

          const result = await executePrompt(
            body,
            repositoryId,
            repositoryOption,
            freshSession.id,
            prompt,
            providerId,
            modelId
          )

          await storeOpenCodeSession(workspaceId, memoryKey, {
            sessionId: result.threadId,
            repository: repositoryId,
            updatedAt: new Date().toISOString(),
          })

          if (result.assistantError) {
            return buildErrorResponse(
              result.threadId,
              result.content,
              result.cost,
              result.assistantError
            )
          }

          return buildSuccessResponse(result.threadId, result.content, result.cost)
        } catch (retryError) {
          await logOpenCodeFailure(
            'Failed to retry OpenCode prompt with a fresh session',
            retryError
          )

          const errorMessage =
            retryError instanceof Error
              ? retryError.message
              : 'OpenCode prompt retry failed'
          return buildErrorResponse(freshSessionId, '', undefined, errorMessage)
        }
      }

      await logOpenCodeFailure('Failed to execute OpenCode prompt', error)
      const errorMessage =
        error instanceof Error ? error.message : 'OpenCode prompt failed'
      return buildErrorResponse(threadId || '', '', undefined, errorMessage)
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to execute OpenCode prompt tool`, { error })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to execute OpenCode prompt' },
      { status: 500 }
    )
  }
}
