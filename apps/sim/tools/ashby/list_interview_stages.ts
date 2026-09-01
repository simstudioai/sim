import { ashbyAuthHeaders, ashbyErrorMessage } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface Params {
  apiKey: string
  interviewPlanId: string
}
interface Response extends ToolResponse {
  output: {
    interviewStages: Array<{
      id: string
      title: string
      type: string
      interviewPlanId: string
      orderInInterviewPlan: number
      interviewStageGroupId: string | null
    }>
    moreDataAvailable: boolean
  }
}

export const listInterviewStagesTool: ToolConfig<Params, Response> = {
  id: 'ashby_list_interview_stages',
  name: 'Ashby List Interview Stages',
  description: 'Lists the ordered stages in an Ashby interview plan.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    interviewPlanId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Interview plan UUID',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/interviewStage.list',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey),
    body: (p) => ({ interviewPlanId: p.interviewPlanId.trim() }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(ashbyErrorMessage(data, 'Failed to list interview stages'))
    return {
      success: true,
      output: {
        interviewStages: data.results ?? [],
        moreDataAvailable: data.moreDataAvailable ?? false,
      },
    }
  },
  outputs: {
    interviewStages: {
      type: 'array',
      description: 'Interview stages in plan order',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stage UUID' },
          title: { type: 'string', description: 'Stage title' },
          type: { type: 'string', description: 'Stage type' },
          interviewPlanId: { type: 'string', description: 'Parent plan UUID' },
          orderInInterviewPlan: { type: 'number', description: 'Zero-based plan order' },
          interviewStageGroupId: {
            type: 'string',
            description: 'Stage group UUID',
            optional: true,
          },
        },
      },
    },
    moreDataAvailable: { type: 'boolean', description: 'Whether more data is available' },
  },
}
