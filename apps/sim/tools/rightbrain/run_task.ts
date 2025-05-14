import { ToolConfig } from '../types'
import { RightBrainRunTaskParams, RightBrainRunTaskResponse } from './types'

const isValidUUID = (uuid: string) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(uuid)

const processUrl = (url: string) => {
  const urlInstance = new URL(url)

  const baseUrl = urlInstance.pathname.split('/')
  const orgId = baseUrl[4]
  const projectId = baseUrl[6]
  const taskId = baseUrl[8]

  if (!isValidUUID(orgId) || !isValidUUID(projectId) || !isValidUUID(taskId)) {
    throw new Error('Invalid URL format')
  }

  return { baseUrl: urlInstance.origin, orgId, projectId, taskId }
}

export const runTaskTool: ToolConfig<RightBrainRunTaskParams, RightBrainRunTaskResponse> = {
  id: 'rightbrain_run_task',
  name: 'Rightbrain Run Task',
  description: 'Run a task on Rightbrain',
  version: '1.0.0',
  params: {
    url: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'The Rightbrain task URL',
    },
    inputs: {
      type: 'object',
      required: true,
      description: 'Task inputs',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Rightbrain API key',
    },
  },
  request: {
    url: (params) => {
      processUrl(params.url)
      return params.url
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      task_input: params.inputs,
    }),
  },
  transformError: (error) => {
    const message =
      error.response?.detail?.message || error.message || error.error || 'Failed to run task'

    return message
  },
}
