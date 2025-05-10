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

    // Validate pollInterval (minimum 1000ms, fallback to default if invalid)
    const pollInterval =
      typeof params.pollInterval === 'number' && params.pollInterval >= 1000
        ? params.pollInterval
        : 5000

    // Validate maxPollTime (minimum 5000ms, fallback to default if invalid)
    const maxPollTime =
      typeof params.maxPollTime === 'number' && params.maxPollTime >= 5000
        ? params.maxPollTime
        : 300000

    let elapsedTime = 0

    // Poll until task is finished, failed, or max poll time is reached
    while (elapsedTime < maxPollTime) {
      try {
        // Fetch task status
        const taskResponse = await fetch(`https://api.browser-use.com/api/v1/task/${taskId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
          },
        })

        if (!taskResponse.ok) {
          if (taskResponse.status === 422) {
            const errorData = await taskResponse.json()
            throw new Error(JSON.stringify(errorData))
          }
          throw new Error(`Failed to get task status: ${taskResponse.statusText}`)
        }

        const taskData = await taskResponse.json()

        // Update the response with the latest task data
        result.output = taskData as BrowserUseTaskOutput

        // Check if the task has completed
        if (['finished', 'failed', 'stopped'].includes(taskData.status)) {
          return result
        }

        // Wait for the poll interval
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
        elapsedTime += pollInterval
      } catch (error: any) {
        // If there's an error polling, return the last successful result
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

    // If we've reached max poll time without completion
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
