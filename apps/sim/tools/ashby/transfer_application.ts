import type { AshbyApplication } from '@/tools/ashby/types'
import {
  APPLICATION_OUTPUTS,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  mapApplication,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface Params {
  apiKey: string
  onBehalfOfUserId?: string
  applicationId: string
  jobId: string
  interviewPlanId: string
  interviewStageId: string
  startAutomaticActivities?: boolean
}
interface Response extends ToolResponse {
  output: AshbyApplication
}
export const transferApplicationTool: ToolConfig<Params, Response> = {
  id: 'ashby_transfer_application',
  name: 'Ashby Transfer Application',
  description: 'Transfers an application to another job, interview plan, and stage.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    onBehalfOfUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Active Ashby user UUID to attribute this mutation to; the API key must permit on-behalf-of calls',
    },
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Application UUID',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination job UUID',
    },
    interviewPlanId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination interview plan UUID',
    },
    interviewStageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination interview stage UUID',
    },
    startAutomaticActivities: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start automatic activities configured for the destination stage',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/application.transfer',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey, p.onBehalfOfUserId),
    body: (p) => ({
      applicationId: p.applicationId.trim(),
      jobId: p.jobId.trim(),
      interviewPlanId: p.interviewPlanId.trim(),
      interviewStageId: p.interviewStageId.trim(),
      ...(p.startAutomaticActivities !== undefined
        ? { startAutomaticActivities: p.startAutomaticActivities }
        : {}),
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(ashbyErrorMessage(data, 'Failed to transfer application'))
    return { success: true, output: mapApplication(data.results) }
  },
  outputs: APPLICATION_OUTPUTS,
}
