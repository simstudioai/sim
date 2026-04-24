import type { AshbyGetJobParams, AshbyGetJobResponse } from '@/tools/ashby/types'
import { JOB_OUTPUTS, mapJob } from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

export const getJobTool: ToolConfig<AshbyGetJobParams, AshbyGetJobResponse> = {
  id: 'ashby_get_job',
  name: 'Ashby Get Job',
  description: 'Retrieves full details about a single job by its ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the job to fetch',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/job.info',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => ({
      id: params.jobId.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to get job')
    }

    return {
      success: true,
      output: mapJob(data.results),
    }
  },

  outputs: JOB_OUTPUTS,
}
