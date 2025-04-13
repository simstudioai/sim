import { ToolConfig } from '../types'
import { BrowserUseRunTaskParams, BrowserUseRunTaskResponse } from './types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('BrowserUseTools')

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
      description: 'Interval between polling requests in milliseconds (default: 5000)'
    },
    maxPollTime: {
      type: 'number',
      required: false,
      default: 300000,
      description: 'Maximum time to poll for task completion in milliseconds (default: 300000 - 5 minutes)'
    }
  },
  
  request: {
    url: 'https://api.browser-use.com/api/v1/run-task',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    }),
    body: (params) => ({
      task: params.task,
    }),
  },
  
  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        id: data.id,
        task: '',
        output: null,
        status: 'created',
        created_at: new Date().toISOString(),
        finished_at: null,
        steps: [],
        live_url: null,
        browser_data: null
      },
    }
  },
  
  postProcess: async (result, params) => {
    if (!result.success) {
      return result
    }
    
    const taskId = result.output.id
    const pollInterval = params.pollInterval || 5000
    const maxPollTime = params.maxPollTime || 300000
    let elapsedTime = 0
    
    // Poll until task is finished, failed, or max poll time is reached
    while (elapsedTime < maxPollTime) {
      try {
        // Fetch task status
        const taskResponse = await fetch(`https://api.browser-use.com/api/v1/task/${taskId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${params.apiKey}`,
          },
        })
        
        if (!taskResponse.ok) {
          throw new Error(`Failed to get task status: ${taskResponse.statusText}`)
        }
        
        const taskData = await taskResponse.json()
        
        // Update the response with the latest task data
        result.output = taskData
        
        // Check if the task has completed
        if (['finished', 'failed', 'stopped'].includes(taskData.status)) {
          return result
        }
        
        // Wait for the poll interval
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        elapsedTime += pollInterval
      } catch (error: any) {
        // If there's an error polling, return the last successful result
        logger.error('Error polling for task status:', error)
        return {
          ...result,
          error: `Error polling for task status: ${error.message}`,
        }
      }
    }
    
    // If we've reached max poll time without completion
    logger.warn(`Task ${taskId} did not complete within the maximum polling time (${maxPollTime / 1000}s)`)
    return {
      ...result,
      error: `Task did not complete within the maximum polling time (${maxPollTime / 1000}s)`,
    }
  },
  
  transformError: (error) => {
    return `Failed to run BrowserUse task: ${error.message || 'Unknown error'}`
  },
} 