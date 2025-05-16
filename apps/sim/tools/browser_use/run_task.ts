import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { BrowserUseRunTaskParams, BrowserUseRunTaskResponse, BrowserUseTaskOutput } from './types'

const logger = createLogger('BrowserUseTool')

export const runTaskTool: ToolConfig<BrowserUseRunTaskParams, BrowserUseRunTaskResponse> = {
  id: 'browser_use_run_task',
  name: 'Browser Use',
  description: 'Runs a browser automation task using BrowserUse',
  version: '1.0.0',

  params: {
    task: {
      type: 'string',
      required: true,
      description: 'What should the browser agent do',
    },
    apiKey: {
      type: 'string',
      required: true,
      description: 'API key for BrowserUse API',
    },
    pollInterval: {
      type: 'number',
      required: false,
      default: 5000,
      description: 'Interval between polling requests in milliseconds (default: 5000)',
    },
    maxPollTime: {
      type: 'number',
      required: false,
      default: 300000,
      description:
        'Maximum time to poll for task completion in milliseconds (default: 300000 - 5 minutes)',
    },
  },

  request: {
    url: 'https://api.browser-use.com/api/v1/run-task',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      task: params.task,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      if (response.status === 422) {
        const errorData = await response.json()
        throw new Error(JSON.stringify(errorData))
      }
      throw new Error(`Request failed with status ${response.status}`)
    }

    const data = (await response.json()) as BrowserUseTaskOutput
    return {
      success: true,
      output: {
        id: data.id,
        task: '',
        output: null,
        status: 'created',
        steps: [],
        live_url: null,
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
          result.output.live_url = initialTaskData.live_url
          liveUrlLogged = true
        }
      }
    } catch (error) {
      logger.warn(`Failed to get initial task details for ${taskId}:`, error)
    }

    const pollInterval =
      typeof params.pollInterval === 'number' && params.pollInterval >= 1000
        ? params.pollInterval
        : 5000

    const maxPollTime =
      typeof params.maxPollTime === 'number' && params.maxPollTime >= 5000
        ? params.maxPollTime
        : 300000

    let elapsedTime = 0

    while (elapsedTime < maxPollTime) {
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
        result.output.status = status

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
            result.output = taskData as BrowserUseTaskOutput
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
              result.output.live_url = taskData.live_url
              liveUrlLogged = true
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval))
        elapsedTime += pollInterval
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
      `Task ${taskId} did not complete within the maximum polling time (${maxPollTime / 1000}s)`
    )
    return {
      ...result,
      error: `Task did not complete within the maximum polling time (${maxPollTime / 1000}s)`,
    }
  },

  transformError: (error) => {
    try {
      // Check if error message contains a JSON string (from 422 errors)
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
