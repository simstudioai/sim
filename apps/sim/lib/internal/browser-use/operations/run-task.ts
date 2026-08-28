import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { z } from 'zod'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type {
  BrowserUseRunTaskParams,
  BrowserUseRunTaskResponse,
  BrowserUseTaskStep,
} from '@/tools/browser_use/types'

const logger = createLogger('BrowserUseTool')

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = getMaxExecutionTimeout()
const MAX_CONSECUTIVE_ERRORS = 3
const API_BASE = 'https://api.browser-use.com/api/v2'

const createSessionResponseSchema = z.object({
  id: z.string().min(1),
})

const sessionDetailsResponseSchema = z.object({
  liveUrl: z.string().nullable().optional(),
  publicShareUrl: z.string().nullable().optional(),
})

const taskStepSchema: z.ZodType<BrowserUseTaskStep> = z
  .object({
    number: z.number(),
    memory: z.string(),
    evaluationPreviousGoal: z.string(),
    nextGoal: z.string(),
    url: z.string(),
    screenshotUrl: z.string().nullable().optional(),
    actions: z.array(z.string()),
    duration: z.number().nullable().optional(),
  })
  .passthrough()

const taskStatusResponseSchema = z.object({
  status: z.string(),
  sessionId: z.string().nullable().optional(),
  output: z.unknown().optional(),
  steps: z.array(taskStepSchema).optional(),
})

const createTaskResponseSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().nullable().optional(),
})

const shareResponseSchema = z.object({
  shareUrl: z.string().nullable().optional(),
})

interface BrowserUseTaskRequest {
  task: string
  sessionId?: string
  llm?: string
  startUrl?: string
  maxSteps?: number
  structuredOutput?: string
  flashMode?: boolean
  thinking?: boolean
  vision?: boolean | 'auto'
  systemPromptExtension?: string
  highlightElements?: boolean
  allowedDomains?: string[]
  secrets?: Record<string, unknown>
  metadata?: Record<string, string>
}

async function createSessionWithProfile(
  profileId: string,
  apiKey: string
): Promise<{ sessionId: string } | { error: string }> {
  try {
    const response = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Browser-Use-API-Key': apiKey,
      },
      body: JSON.stringify({
        profileId: profileId.trim(),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Failed to create session with profile: ${errorText}`)
      return { error: `Failed to create session with profile: ${response.statusText}` }
    }

    const parsed = createSessionResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      logger.error('BrowserUse returned an invalid create-session response')
      return { error: 'BrowserUse returned an invalid create-session response' }
    }
    const data = parsed.data
    logger.info(`Created session ${data.id} with profile ${profileId}`)
    return { sessionId: data.id }
  } catch (error: unknown) {
    logger.error('Error creating session with profile:', error)
    return { error: `Error creating session: ${getErrorMessage(error, 'Unknown error')}` }
  }
}

async function stopSession(sessionId: string, apiKey: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Browser-Use-API-Key': apiKey,
      },
      body: JSON.stringify({ action: 'stop' }),
    })

    if (response.ok) {
      logger.info(`Stopped session ${sessionId}`)
    } else {
      logger.warn(`Failed to stop session ${sessionId}: ${response.statusText}`)
    }
  } catch (error: unknown) {
    logger.warn(`Error stopping session ${sessionId}:`, error)
  }
}

async function fetchSessionLiveUrl(
  sessionId: string,
  apiKey: string
): Promise<{ liveUrl: string | null; publicShareUrl: string | null }> {
  try {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
      method: 'GET',
      headers: { 'X-Browser-Use-API-Key': apiKey },
    })
    if (!response.ok) {
      return { liveUrl: null, publicShareUrl: null }
    }
    const parsed = sessionDetailsResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      logger.warn(`BrowserUse returned an invalid session response for ${sessionId}`)
      return { liveUrl: null, publicShareUrl: null }
    }
    const data = parsed.data
    return {
      liveUrl: data.liveUrl ?? null,
      publicShareUrl: data.publicShareUrl ?? null,
    }
  } catch (error: unknown) {
    logger.warn(`Error fetching session ${sessionId}:`, error)
    return { liveUrl: null, publicShareUrl: null }
  }
}

function normalizeSecrets(
  variables: BrowserUseRunTaskParams['variables']
): Record<string, unknown> {
  const secrets: Record<string, unknown> = {}
  if (!variables) return secrets

  if (Array.isArray(variables)) {
    for (const row of variables) {
      const cells =
        typeof row.cells === 'object' && row.cells !== null
          ? (row.cells as Record<string, unknown>)
          : undefined
      const key = cells?.Key ?? row.Key
      const value = cells?.Value ?? row.Value
      if (key && value !== undefined) {
        secrets[String(key)] = value
      }
    }
  } else if (typeof variables === 'object') {
    for (const [k, v] of Object.entries(variables)) {
      if (typeof v === 'string') secrets[k] = v
    }
  }
  return secrets
}

function parseAllowedDomains(input?: string | string[]): string[] | undefined {
  if (!input) return undefined
  const arr = Array.isArray(input)
    ? input
    : input
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
  return arr.length > 0 ? arr : undefined
}

function buildRequestBody(
  params: BrowserUseRunTaskParams,
  sessionId?: string
): BrowserUseTaskRequest {
  const body: BrowserUseTaskRequest = { task: params.task }

  if (sessionId) body.sessionId = sessionId
  if (params.model) body.llm = params.model
  if (params.startUrl?.trim()) body.startUrl = params.startUrl.trim()
  if (typeof params.maxSteps === 'number' && params.maxSteps > 0) body.maxSteps = params.maxSteps
  if (params.structuredOutput) body.structuredOutput = params.structuredOutput
  if (typeof params.flashMode === 'boolean') body.flashMode = params.flashMode
  if (typeof params.thinking === 'boolean') body.thinking = params.thinking
  if (typeof params.vision === 'boolean' || params.vision === 'auto') body.vision = params.vision
  if (params.systemPromptExtension) body.systemPromptExtension = params.systemPromptExtension
  if (typeof params.highlightElements === 'boolean')
    body.highlightElements = params.highlightElements

  const allowedDomains = parseAllowedDomains(params.allowedDomains)
  if (allowedDomains) body.allowedDomains = allowedDomains

  const secrets = normalizeSecrets(params.variables)
  if (Object.keys(secrets).length > 0) body.secrets = secrets

  if (
    params.metadata &&
    typeof params.metadata === 'object' &&
    Object.keys(params.metadata).length > 0
  )
    body.metadata = params.metadata

  return body
}

async function fetchTaskStatus(
  taskId: string,
  apiKey: string
): Promise<
  { ok: true; data: z.infer<typeof taskStatusResponseSchema> } | { ok: false; error: string }
> {
  try {
    const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
      method: 'GET',
      headers: { 'X-Browser-Use-API-Key': apiKey },
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }

    const parsed = taskStatusResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      return { ok: false, error: 'BrowserUse returned an invalid task-status response' }
    }
    return { ok: true, data: parsed.data }
  } catch (error: unknown) {
    return { ok: false, error: getErrorMessage(error, 'Network error') }
  }
}

interface PollResult {
  success: boolean
  output: unknown
  steps: BrowserUseTaskStep[]
  sessionId: string | null
  liveUrl: string | null
  publicShareUrl: string | null
  error?: string
}

async function pollForCompletion(taskId: string, apiKey: string): Promise<PollResult> {
  let consecutiveErrors = 0
  let sessionId: string | null = null
  let liveUrl: string | null = null
  let publicShareUrl: string | null = null
  const startTime = Date.now()

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const result = await fetchTaskStatus(taskId, apiKey)

    if (!result.ok) {
      consecutiveErrors++
      logger.warn(
        `Error polling task ${taskId} (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${result.error}`
      )

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return {
          success: false,
          output: null,
          steps: [],
          sessionId,
          liveUrl,
          publicShareUrl,
          error: `Failed to poll task status after ${MAX_CONSECUTIVE_ERRORS} attempts: ${result.error}`,
        }
      }

      await sleep(POLL_INTERVAL_MS)
      continue
    }

    consecutiveErrors = 0
    const taskData = result.data
    if (taskData.sessionId) sessionId = taskData.sessionId
    const status = taskData.status

    logger.info(`BrowserUse task ${taskId} status: ${status}`)

    if (sessionId && !liveUrl) {
      const session = await fetchSessionLiveUrl(sessionId, apiKey)
      if (session.liveUrl) {
        liveUrl = session.liveUrl
        logger.info(`BrowserUse live URL: ${liveUrl}`)
      }
      if (session.publicShareUrl) publicShareUrl = session.publicShareUrl
    }

    if (['finished', 'failed', 'stopped'].includes(status)) {
      return {
        success: status === 'finished',
        output: taskData.output ?? null,
        steps: taskData.steps ?? [],
        sessionId,
        liveUrl,
        publicShareUrl,
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  const finalResult = await fetchTaskStatus(taskId, apiKey)
  if (finalResult.ok && ['finished', 'failed', 'stopped'].includes(finalResult.data.status)) {
    return {
      success: finalResult.data.status === 'finished',
      output: finalResult.data.output ?? null,
      steps: finalResult.data.steps ?? [],
      sessionId: finalResult.data.sessionId ?? sessionId,
      liveUrl,
      publicShareUrl,
    }
  }

  return {
    success: false,
    output: null,
    steps: [],
    sessionId,
    liveUrl,
    publicShareUrl,
    error: `Task did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
  }
}

async function createShareUrl(sessionId: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}/public-share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Browser-Use-API-Key': apiKey,
      },
    })

    if (!response.ok) {
      logger.warn(`Failed to create share URL for session ${sessionId}: ${response.statusText}`)
      return null
    }

    const parsed = shareResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      logger.warn(`BrowserUse returned an invalid share response for session ${sessionId}`)
      return null
    }
    return parsed.data.shareUrl ?? null
  } catch (error: unknown) {
    logger.warn(`Error creating share URL for session ${sessionId}:`, error)
    return null
  }
}

function emptyOutput(): BrowserUseRunTaskResponse['output'] {
  return {
    id: '',
    success: false,
    output: null,
    steps: [],
    liveUrl: null,
    shareUrl: null,
    sessionId: null,
  }
}

export const executeRunTaskOperation: InternalToolOperationImplementation<
  BrowserUseRunTaskParams
> = async (params: BrowserUseRunTaskParams): Promise<BrowserUseRunTaskResponse> => {
  let sessionId: string | undefined

  if (params.profile_id) {
    logger.info(`Creating session with profile ID: ${params.profile_id}`)
    const sessionResult = await createSessionWithProfile(params.profile_id, params.apiKey)
    if ('error' in sessionResult) {
      return { success: false, output: emptyOutput(), error: sessionResult.error }
    }
    sessionId = sessionResult.sessionId
  }

  const requestBody = buildRequestBody(params, sessionId)
  logger.info('Creating BrowserUse task', { hasSession: !!sessionId })

  try {
    const response = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Browser-Use-API-Key': params.apiKey,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Failed to create task: ${errorText}`)
      return {
        success: false,
        output: emptyOutput(),
        error: `Failed to create task: ${response.statusText}`,
      }
    }

    const parsed = createTaskResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      logger.error('BrowserUse returned an invalid create-task response')
      return {
        success: false,
        output: emptyOutput(),
        error: 'BrowserUse returned an invalid create-task response',
      }
    }
    const data = parsed.data
    const taskId = data.id
    const initialSessionId = sessionId ?? data.sessionId ?? null
    logger.info(`Created BrowserUse task ${taskId}`, { sessionId: initialSessionId })

    const result = await pollForCompletion(taskId, params.apiKey)

    const finalSessionId = result.sessionId ?? initialSessionId
    const shareUrl =
      result.publicShareUrl ??
      (finalSessionId ? await createShareUrl(finalSessionId, params.apiKey) : null)

    if (sessionId) {
      await stopSession(sessionId, params.apiKey)
    }

    return {
      success: result.success && !result.error,
      output: {
        id: taskId,
        success: result.success,
        output: result.output,
        steps: result.steps,
        liveUrl: result.liveUrl,
        shareUrl,
        sessionId: finalSessionId,
      },
      error: result.error,
    }
  } catch (error: unknown) {
    logger.error('Error creating BrowserUse task:', error)
    if (sessionId) {
      await stopSession(sessionId, params.apiKey)
    }
    return {
      success: false,
      output: emptyOutput(),
      error: `Error creating task: ${getErrorMessage(error, 'Unknown error')}`,
    }
  }
}
