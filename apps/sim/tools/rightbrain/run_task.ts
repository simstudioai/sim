import { BrainClient, BrainClientError } from '@rightbrain/sdk'
import { ToolConfig } from '../types'
import { RightBrainRunTaskParams, RightBrainRunTaskResponse } from './types'

export const isValidUUID = (uuid: string) =>
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
      requiredForToolCall: true,
      description: 'Task inputs',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Rightbrain API key',
    },
  },
  directExecution: async (params) => {
    const { baseUrl, orgId, projectId, taskId } = processUrl(params.url)

    const client = new BrainClient({
      accessToken: params.apiKey,
      baseUrl: `${baseUrl}/api/v1`,
      organizationId: orgId,
      projectId,
    })

    try {
      const response = await client.runTask({ id: taskId, inputs: params.inputs })
      return { output: response, success: true }
    } catch (error) {
      if (error instanceof BrainClientError) {
        if (
          error.response &&
          typeof error.response === 'object' &&
          'detail' in error.response &&
          typeof error.response.detail === 'object' &&
          error.response.detail &&
          'message' in error.response.detail &&
          typeof error.response.detail.message === 'string'
        ) {
          throw new Error(error.response.detail.message)
        }
      }

      if (error instanceof Error) {
        throw new Error(error.message)
      }

      throw new Error('failed to run task')
    }
  },
  request: {
    url: (params) => params.url,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => params.inputs,
  },
  transformError: (error) => {
    const message = error.response?.detail?.message || error.message || 'Failed to run task'

    return message
  },
}
