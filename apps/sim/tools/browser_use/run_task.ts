import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { BrowserUseRunTaskParams, BrowserUseRunTaskResponse } from './types'

const logger = createLogger('BrowserUseTool')

const POLL_INTERVAL_MS = 5000 // 5 seconds between polls
const MAX_POLL_TIME_MS = 180000 // 3 minutes maximum polling time

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
  },

  request: {
    url: 'https://api.browser-use.com/api/v1/run-task',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const requestBody: Record<string, any> = {
        task: params.task,
      }

      if (params.variables) {
        let secrets: Record<string, string> = {}

        if (Array.isArray(params.variables)) {
          logger.info('Converting variables array to dictionary format')
          params.variables.forEach((row) => {
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
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      if (response.status === 422) {
        const errorData = await response.json()
        throw new Error(JSON.stringify(errorData))
      }
      throw new Error(`Request failed with status ${response.status}`)
    }

    const data = (await response.json()) as { id: string }
    return {
      success: true,
      output: {
        id: data.id,
        success: true,
        output: null,
        steps: [],
      },
    }
  },

  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }

    const taskId = result.output.id
    let liveUrlLogged = false

    try {
      const initialTaskResponse = await fetch(`https://api.browser-use.com/api/v1/task/${taskId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
        },
      })

      if (initialTaskResponse.ok) {
        const initialTaskData = await initialTaskResponse.json()
        if (initialTaskData.live_url) {
          logger.info(
            `BrowserUse task ${taskId} launched with live URL: ${initialTaskData.live_url}`
          )
          liveUrlLogged = true
        }
      }
    } catch (error) {
      logger.warn(`Failed to get initial task details for ${taskId}:`, error)
    }

    let elapsedTime = 0

    while (elapsedTime < MAX_POLL_TIME_MS) {
      try {
        const statusResponse = await fetch(
          `https://api.browser-use.com/api/v1/task/${taskId}/status`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${params.apiKey}`,
            },
          }
        )

        if (!statusResponse.ok) {
          throw new Error(`Failed to get task status: ${statusResponse.statusText}`)
        }

        const status = await statusResponse.json()

        logger.info(`BrowserUse task ${taskId} status: ${status}`)

        if (['finished', 'failed', 'stopped'].includes(status)) {
          const taskResponse = await fetch(`https://api.browser-use.com/api/v1/task/${taskId}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${params.apiKey}`,
            },
          })

          if (taskResponse.ok) {
            const taskData = await taskResponse.json()
            result.output = {
              id: taskId,
              success: status === 'finished',
              output: taskData.output,
              steps: taskData.steps || [],
            }
          }

          return result
        }

        if (!liveUrlLogged && status === 'running') {
          const taskResponse = await fetch(`https://api.browser-use.com/api/v1/task/${taskId}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${params.apiKey}`,
            },
          })

          if (taskResponse.ok) {
            const taskData = await taskResponse.json()
            if (taskData.live_url) {
              logger.info(`BrowserUse task ${taskId} running with live URL: ${taskData.live_url}`)
              liveUrlLogged = true
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        elapsedTime += POLL_INTERVAL_MS
      } catch (error: any) {
        logger.error('Error polling for task status:', {
          message: error.message || 'Unknown error',
          taskId,
        })

        return {
          ...result,
          error: `Error polling for task status: ${error.message || 'Unknown error'}`,
        }
      }
    }

    logger.warn(
      `Task ${taskId} did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`
    )
    return {
      ...result,
      error: `Task did not complete within the maximum polling time (${MAX_POLL_TIME_MS / 1000}s)`,
    }
  },

  transformError: (error) => {
    try {
      const errorData = JSON.parse(error.message)
      if (errorData.detail && Array.isArray(errorData.detail)) {
        const formattedError = errorData.detail
          .map((item: any) => `${item.loc.join('.')}: ${item.msg}`)
          .join(', ')
        return `Validation error: ${formattedError}`
      }
    } catch {
      // Not a JSON string, use the regular error message
    }

    return `Failed to run BrowserUse task: ${error.message || 'Unknown error'}`
  },
}
