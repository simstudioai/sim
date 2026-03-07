import { createLogger } from '@sim/logger'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { trackPlatformEvent } from '@/lib/core/telemetry'
import type { BrowserUseRunTaskParams, BrowserUseRunTaskResponse } from '@/tools/browser_use/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('BrowserUseTool')

const POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = getMaxExecutionTimeout()
const MAX_CONSECUTIVE_ERRORS = 3

async function createSessionWithProfile(
  profileId: string,
  apiKey: string
): Promise<{ sessionId: string } | { error: string }> {
  try {
    const response = await fetch('https://api.browser-use.com/api/v2/sessions', {
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
    const response = await fetch(`https://api.browser-use.com/api/v2/sessions/${sessionId}`, {
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

function buildRequestBody(
  params: BrowserUseRunTaskParams,
  sessionId?: string
): Record<string, any> {
  const requestBody: Record<string, any> = {
    task: params.task,
  }

  if (sessionId) {
    requestBody.sessionId = sessionId
    logger.info(`Using session ${sessionId} for task`)
  }

  if (params.variables) {
    let secrets: Record<string, string> = {}

    if (Array.isArray(params.variables)) {
      logger.info('Converting variables array to dictionary format')
      params.variables.forEach((row: any) => {
        if (row.cells?.Key && row.cells.Value !== undefined) {
          secrets[row.cells.Key] = row.cells.Value
          logger.info(`Added secret for key: ${row.cells.Key}`)
        } else if (row.Key && row.Value !== undefined) {
          secrets[row.Key] = row.Value
          logger.info(`Added secret for key: ${row.Key}`)
        }
      })
    } else if (typeof params.variables === 'object' && params.variables !== null) {
      logger.info('Using variables object directly')
      secrets = params.variables
    }

    if (Object.keys(secrets).length > 0) {
      logger.info(`Found ${Object.keys(secrets).length} secrets to include`)
      requestBody.secrets = secrets
    } else {
      logger.warn('No usable secrets found in variables')
    }
  }

  if (params.model) {
    requestBody.llm_model = params.model
  }

  if (params.save_browser_data) {
    requestBody.save_browser_data = params.save_browser_data
  }

  requestBody.use_adblock = true
  requestBody.highlight_elements = true

  return requestBody
}

async function fetchTaskStatus(
  taskId: string,
  apiKey: string
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const response = await fetch(`https://api.browser-use.com/api/v2/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        'X-Browser-Use-API-Key': apiKey,
      },
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` }
    }

    const data = await response.json()
    return { ok: true, data }
  } catch (error: any) {
    return { ok: false, error: error.message || 'Network error' }
  }
}

async function pollForCompletion(
  taskId: string,
  apiKey: string
): Promise<{ success: boolean; output: any; steps: any[]; error?: string }> {
  let liveUrlLogged = false
  let consecutiveErrors = 0
  const startTime = Date.now()

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const result = await fetchTaskStatus(taskId, apiKey)

    if (!result.ok) {
      consecutiveErrors++
      logger.warn(
        `Error polling task ${taskId} (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${result.error}`
      )

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.error(`Max consecutive errors reached for task ${taskId}`)
        return {
          success: false,
          output: null,
          steps: [],
          error: `Failed to poll task status after ${MAX_CONSECUTIVE_ERRORS} attempts: ${result.error}`,
        }
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      continue
    }

    consecutiveErrors = 0
    const taskData = result.data
    const status = taskData.status

    logger.info(`BrowserUse task ${taskId} status: ${status}`)

    if (['finished', 'failed', 'stopped'].includes(status)) {
      return {
        success: status === 'finished',
        output: taskData.output ?? null,
        steps: taskData.steps || [],
      }
    }

    if (!liveUrlLogged && taskData.live_url) {
      logger.info(`BrowserUse task ${taskId} live URL: ${taskData.live_url}`)
      liveUrlLogged = true
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  const finalResult = await fetchTaskStatus(taskId, apiKey)
  if (finalResult.ok && ['finished', 'failed', 'stopped'].includes(finalResult.data.status)) {
    return {
      success: finalResult.data.status === 'finished',
      output: finalResult.data.output ?? null,
      steps: finalResult.data.steps || [],
    }
  }

  logger.warn(
    `Task ${taskId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
  )
  return {
    success: false,
    output: null,
    steps: [],
    error: `Task did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
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
    variables: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Optional variables to use as secrets (format: {key: value})',
    },
    save_browser_data: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to save browser data',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'LLM model to use (default: gpt-4o)',
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

  hosting: {
    envKeyPrefix: 'BROWSER_USE_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'browser_use',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        if (!Array.isArray(output.steps)) {
          throw new Error('Browser Use response missing steps array, cannot determine cost')
        }
        const INIT_COST = 0.01
        const STEP_COSTS: Record<string, number> = {
          'browser-use-llm': 0.002,
          'browser-use-2.0': 0.006,
          o3: 0.03,
          'o4-mini': 0.03,
          'gemini-3-pro-preview': 0.03,
          'gemini-3-flash-preview': 0.015,
          'gemini-flash-latest': 0.0075,
          'gemini-flash-lite-latest': 0.005,
          'gemini-2.5-flash': 0.0075,
          'gemini-2.5-pro': 0.03,
          'claude-sonnet-4-5-20250929': 0.05,
          'claude-opus-4-5-20251101': 0.05,
          'claude-3-7-sonnet-20250219': 0.05,
          'gpt-4o': 0.006,
          'gpt-4o-mini': 0.006,
          'gpt-4.1': 0.006,
          'gpt-4.1-mini': 0.006,
          'llama-4-maverick-17b-128e-instruct': 0.006,
        }
        const DEFAULT_STEP_COST = 0.006
        const model = (params.model as string) || 'browser-use-2.0'
        const knownCost = STEP_COSTS[model]
        if (!knownCost) {
          logger.warn(
            `Unknown Browser Use model "${model}", using default step cost $${DEFAULT_STEP_COST}`
          )
          trackPlatformEvent('platform.hosted_key.unknown_model_cost', {
            'tool.id': 'browser_use_run_task',
            'model.name': model,
            'cost.default_step_cost': DEFAULT_STEP_COST,
          })
        }
        const stepCost = knownCost ?? DEFAULT_STEP_COST
        const stepCount = output.steps.length
        const total = INIT_COST + stepCount * stepCost
        return { cost: total, metadata: { model, stepCount, stepCost, initCost: INIT_COST } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  },

  request: {
    url: 'https://api.browser-use.com/api/v2/tasks',
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
        return {
          success: false,
          output: {
            id: null,
            success: false,
            output: null,
            steps: [],
          },
          error: sessionResult.error,
        }
      }
      sessionId = sessionResult.sessionId
    }

    const requestBody = buildRequestBody(params, sessionId)
    logger.info('Creating BrowserUse task', { hasSession: !!sessionId })

    try {
      const response = await fetch('https://api.browser-use.com/api/v2/tasks', {
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
          output: {
            id: null,
            success: false,
            output: null,
            steps: [],
          },
          error: `Failed to create task: ${response.statusText}`,
        }
      }

      const data = (await response.json()) as { id: string }
      const taskId = data.id
      logger.info(`Created BrowserUse task: ${taskId}`)

      const result = await pollForCompletion(taskId, params.apiKey)

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
        output: {
          id: null,
          success: false,
          output: null,
          steps: [],
        },
        error: `Error creating task: ${error.message}`,
      }
    }
  },

  outputs: {
    id: { type: 'string', description: 'Task execution identifier' },
    success: { type: 'boolean', description: 'Task completion status' },
    output: { type: 'json', description: 'Task output data' },
    steps: { type: 'json', description: 'Execution steps taken' },
  },
}
