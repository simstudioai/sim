import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { BrowserUseRunTaskParams, BrowserUseRunTaskResponse } from '@/tools/browser_use/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('BrowserUseTool')

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = getMaxExecutionTimeout()
const MAX_CONSECUTIVE_ERRORS = 3
const API_BASE = 'https://api.browser-use.com/api/v2'

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

    const data = (await response.json()) as { id: string }
    logger.info(`Created session ${data.id} with profile ${profileId}`)
    return { sessionId: data.id }
  } catch (error: any) {
    logger.error('Error creating session with profile:', error)
    return { error: `Error creating session: ${error.message}` }
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
  } catch (error: any) {
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
    const data = (await response.json()) as { liveUrl?: string; publicShareUrl?: string }
    return {
      liveUrl: data.liveUrl ?? null,
      publicShareUrl: data.publicShareUrl ?? null,
    }
  } catch (error: any) {
    logger.warn(`Error fetching session ${sessionId}:`, error)
    return { liveUrl: null, publicShareUrl: null }
  }
}

function normalizeSecrets(variables: BrowserUseRunTaskParams['variables']): Record<string, string> {
  const secrets: Record<string, string> = {}
  if (!variables) return secrets

  if (Array.isArray(variables)) {
    for (const row of variables as Array<Record<string, any>>) {
      if (row?.cells?.Key && row.cells.Value !== undefined) {
        secrets[row.cells.Key] = row.cells.Value
      } else if (row?.Key && row.Value !== undefined) {
        secrets[row.Key] = row.Value
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
): Record<string, any> {
  const body: Record<string, any> = { task: params.task }

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
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
      method: 'GET',
      headers: { 'X-Browser-Use-API-Key': apiKey },
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }

    return { ok: true, data: await response.json() }
  } catch (error: any) {
    return { ok: false, error: error.message || 'Network error' }
  }
}

interface PollResult {
  success: boolean
  output: any
  steps: any[]
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
        steps: taskData.steps || [],
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
      steps: finalResult.data.steps || [],
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

    const data = (await response.json()) as { shareUrl?: string; shareToken?: string }
    return data.shareUrl ?? null
  } catch (error: any) {
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

export const runTaskTool: ToolConfig<BrowserUseRunTaskParams, BrowserUseRunTaskResponse> = {
  id: 'browser_use_run_task',
  name: 'Browser Use',
  description: 'Runs a browser automation task using BrowserUse',
  version: '1.0.0',

  params: {
    task: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'What should the browser agent do',
    },
    startUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Initial page URL to start the agent on (reduces navigation steps)',
    },
    variables: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Optional secrets injected into the task (format: {key: value})',
    },
    allowedDomains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains the agent is allowed to visit',
    },
    maxSteps: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of steps the agent may take (default 100, max 10000)',
    },
    flashMode: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable flash mode (faster, less careful navigation)',
    },
    thinking: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Enable extended reasoning mode',
    },
    vision: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vision capability: "true", "false", or "auto"',
    },
    systemPromptExtension: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional text appended to the agent system prompt (max 2000 chars)',
    },
    structuredOutput: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Stringified JSON schema for the structured output',
    },
    highlightElements: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Highlight interactive elements on the page (default true)',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Custom key-value metadata (up to 10 pairs) for tracking',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'LLM model identifier (e.g. browser-use-2.0)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key for BrowserUse API',
    },
    profile_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Browser profile ID for persistent sessions (cookies, login state)',
    },
  },

  request: {
    url: `${API_BASE}/tasks`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-Browser-Use-API-Key': params.apiKey,
    }),
  },

  directExecution: async (params: BrowserUseRunTaskParams): Promise<ToolResponse> => {
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

      const data = (await response.json()) as { id: string; sessionId?: string }
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
    } catch (error: any) {
      logger.error('Error creating BrowserUse task:', error)
      if (sessionId) {
        await stopSession(sessionId, params.apiKey)
      }
      return {
        success: false,
        output: emptyOutput(),
        error: `Error creating task: ${error.message}`,
      }
    }
  },

  outputs: {
    id: { type: 'string', description: 'Task execution identifier' },
    success: { type: 'boolean', description: 'Task completion status' },
    output: { type: 'json', description: 'Final task output (string or structured)' },
    steps: {
      type: 'array',
      description: 'Steps the agent executed (number, memory, nextGoal, url, actions, duration)',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number', description: 'Sequential step number' },
          memory: { type: 'string', description: 'Agent memory at this step' },
          evaluationPreviousGoal: {
            type: 'string',
            description: 'Evaluation of previous goal completion',
          },
          nextGoal: { type: 'string', description: 'Goal for the next step' },
          url: { type: 'string', description: 'Current URL of the browser' },
          screenshotUrl: { type: 'string', description: 'Optional screenshot URL', optional: true },
          actions: {
            type: 'array',
            description: 'Stringified JSON actions performed',
            items: { type: 'string', description: 'Action JSON' },
          },
          duration: {
            type: 'number',
            description: 'Step duration in seconds',
            optional: true,
          },
        },
      },
    },
    liveUrl: {
      type: 'string',
      description: 'Embeddable live browser session URL (active during execution)',
    },
    shareUrl: {
      type: 'string',
      description: 'Public shareable URL for the recorded session (post-run)',
    },
    sessionId: { type: 'string', description: 'Browser Use session identifier' },
  },
}
