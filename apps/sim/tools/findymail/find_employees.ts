import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailFindEmployeesParams,
  FindymailFindEmployeesResponse,
} from '@/tools/findymail/types'
import { FINDYMAIL_EMPLOYEES_OUTPUT } from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const findEmployeesTool: ToolConfig<
  FindymailFindEmployeesParams,
  FindymailFindEmployeesResponse
> = {
  id: 'findymail_find_employees',
  name: 'Findymail Find Employees',
  description:
    'Find employees at a company by website and target job titles. Uses 1 credit per found contact. Does not return email addresses.',
  version: '1.0.0',

  hosting: findymailHosting<FindymailFindEmployeesParams>((_params, output) => {
    // No employees array means no contacts found — no charge.
    if (!Array.isArray(output.employees)) {
      return 0
    }
    // 1 finder credit per contact found.
    return output.employees.length
  }),

  params: {
    website: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company website or domain (e.g., google.com)',
    },
    job_titles: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target job titles to search for (max 10, e.g., ["Software Engineer", "CEO"])',
      items: { type: 'string' },
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of contacts to return (max 5, default 1)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/search/employees',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        website: params.website,
        job_titles: params.job_titles,
      }
      if (params.count !== undefined) body.count = params.count
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          (errorData as Record<string, string>).error ||
          `Findymail API error: ${response.status} ${response.statusText}`,
        output: { employees: [] },
      }
    }
    const data = await response.json()
    const raw = Array.isArray(data) ? data : (data.data ?? [])
    const employees = Array.isArray(raw)
      ? raw.map(
          (e: {
            name?: string
            linkedinUrl?: string
            companyWebsite?: string
            companyName?: string
            jobTitle?: string
          }) => ({
            name: e.name ?? '',
            linkedinUrl: e.linkedinUrl ?? null,
            companyWebsite: e.companyWebsite ?? null,
            companyName: e.companyName ?? null,
            jobTitle: e.jobTitle ?? null,
          })
        )
      : []
    return { success: true, output: { employees } }
  },

  outputs: {
    employees: FINDYMAIL_EMPLOYEES_OUTPUT,
  },
}
