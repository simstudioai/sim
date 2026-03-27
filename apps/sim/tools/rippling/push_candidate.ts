import type {
  RipplingPushCandidateParams,
  RipplingPushCandidateResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingPushCandidateTool: ToolConfig<
  RipplingPushCandidateParams,
  RipplingPushCandidateResponse
> = {
  id: 'rippling_push_candidate',
  name: 'Rippling Push Candidate',
  description: 'Push a candidate to onboarding in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    firstName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate first name',
    },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate last name',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate email address',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Candidate phone number',
    },
    jobTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title for the candidate',
    },
    department: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Department for the candidate',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date in ISO 8601 format (e.g., 2025-01-15)',
    },
  },

  request: {
    url: 'https://api.rippling.com/platform/api/ats_candidates/push_candidate',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        firstName: params.firstName,
        lastName: params.lastName,
        email: params.email,
      }
      if (params.phone !== undefined) {
        body.phone = params.phone
      }
      if (params.jobTitle !== undefined) {
        body.jobTitle = params.jobTitle
      }
      if (params.department !== undefined) {
        body.department = params.department
      }
      if (params.startDate !== undefined) {
        body.startDate = params.startDate
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        firstName: (data.firstName as string) ?? null,
        lastName: (data.lastName as string) ?? null,
        email: (data.email as string) ?? null,
        status: (data.status as string) ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Candidate ID' },
    firstName: { type: 'string', description: 'Candidate first name' },
    lastName: { type: 'string', description: 'Candidate last name' },
    email: { type: 'string', description: 'Candidate email address' },
    status: { type: 'string', description: 'Candidate onboarding status', optional: true },
  },
}
