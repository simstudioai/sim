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
  description:
    'Run a Rightbrain AI task. Tasks are created in the Rightbrain app and can be chained together or connected to other apps with Sim Studio to dynamically process inputs, outputs or a combination of both. A task response can be found in the `response.response` object.',
  version: '1.0.0',
  params: {
    url: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Rightbrain task URL',
    },
    inputs: {
      type: 'object',
      required: true,
      description: 'The task_input JSON object',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Rightbrain API key',
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
    body: (params) => params.inputs,
  },
  transformError: (error) => {
    const message =
      error.response?.detail?.message || error.message || error.error || 'Failed to run task'

    return message
  },
  transformResponse: async (response) => {
    const data = await response.json()

    if (data?.is_error) {
      throw new Error(data.response?.detail?.message || 'Failed to run task')
    }

    return {
      success: true,
      output: {
        charged_credits: data.charged_credits,
        created: data.created,
        id: data.id,
        input_processor_timing: data.input_processor_timing,
        input_tokens: data.input_tokens,
        llm_call_timing: data.llm_call_timing,
        output_tokens: data.output_tokens,
        response: data.response,
        run_data: data.run_data,
        task_id: data.task_id,
        task_revision_id: data.task_revision_id,
        total_tokens: data.total_tokens,
        is_error: data.is_error,
      },
    }
  },
}
