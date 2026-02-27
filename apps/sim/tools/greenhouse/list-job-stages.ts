import type {
  GreenhouseJobStage,
  GreenhouseJobStageInterview,
  GreenhouseListJobStagesParams,
  GreenhouseListJobStagesResponse,
  GreenhouseUserRef,
} from '@/tools/greenhouse/types'
import type { ToolConfig } from '@/tools/types'

export const greenhouseListJobStagesTool: ToolConfig<
  GreenhouseListJobStagesParams,
  GreenhouseListJobStagesResponse
> = {
  id: 'greenhouse_list_job_stages',
  name: 'Greenhouse List Job Stages',
  description: 'Lists all interview stages for a specific job in Greenhouse',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Greenhouse Harvest API key',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The job ID to list stages for',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (1-500, default 100)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params: GreenhouseListJobStagesParams) => {
      const url = new URL(`https://harvest.greenhouse.io/v1/jobs/${params.jobId}/stages`)
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.page) url.searchParams.append('page', String(params.page))
      return url.toString()
    },
    method: 'GET',
    headers: (params: GreenhouseListJobStagesParams) => ({
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GreenhouseListJobStagesResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { stages: [], count: 0 },
        error: `Greenhouse API error: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json()
    const stages: GreenhouseJobStage[] = (Array.isArray(data) ? data : []).map(
      (s: Record<string, unknown>) => ({
        id: (s.id as number) ?? 0,
        name: (s.name as string) ?? null,
        created_at: (s.created_at as string) ?? null,
        updated_at: (s.updated_at as string) ?? null,
        job_id: (s.job_id as number) ?? 0,
        priority: (s.priority as number) ?? 0,
        active: (s.active as boolean) ?? true,
        interviews: (Array.isArray(s.interviews) ? s.interviews : []).map(
          (i: Record<string, unknown>): GreenhouseJobStageInterview => ({
            id: (i.id as number) ?? 0,
            name: (i.name as string) ?? null,
            schedulable: (i.schedulable as boolean) ?? false,
            estimated_minutes: (i.estimated_minutes as number) ?? null,
            default_interviewer_users: (Array.isArray(i.default_interviewer_users)
              ? i.default_interviewer_users
              : []
            ).map(
              (u: Record<string, unknown>): GreenhouseUserRef => ({
                id: (u.id as number) ?? 0,
                first_name: (u.first_name as string) ?? '',
                last_name: (u.last_name as string) ?? '',
                name: (u.name as string) ?? '',
                employee_id: (u.employee_id as string) ?? null,
              })
            ),
            interview_kit: i.interview_kit
              ? {
                  id: ((i.interview_kit as Record<string, unknown>).id as number) ?? 0,
                  content: ((i.interview_kit as Record<string, unknown>).content as string) ?? null,
                  questions: (Array.isArray((i.interview_kit as Record<string, unknown>).questions)
                    ? (i.interview_kit as Record<string, unknown>).questions
                    : []) as Array<{ id: number; question: string }>,
                }
              : null,
          })
        ),
      })
    )
    return {
      success: true,
      output: { stages, count: stages.length },
    }
  },

  outputs: {
    stages: {
      type: 'array',
      description: 'List of job stages in order',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Stage ID' },
          name: { type: 'string', description: 'Stage name' },
          created_at: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
          updated_at: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
          job_id: { type: 'number', description: 'Associated job ID' },
          priority: { type: 'number', description: 'Stage order priority' },
          active: { type: 'boolean', description: 'Whether the stage is active' },
          interviews: {
            type: 'array',
            description: 'Interview steps in this stage',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Interview ID' },
                name: { type: 'string', description: 'Interview name' },
                schedulable: {
                  type: 'boolean',
                  description: 'Whether the interview is schedulable',
                },
                estimated_minutes: {
                  type: 'number',
                  description: 'Estimated duration in minutes',
                  optional: true,
                },
                default_interviewer_users: {
                  type: 'array',
                  description: 'Default interviewers',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'number', description: 'User ID' },
                      name: { type: 'string', description: 'Full name' },
                      first_name: { type: 'string', description: 'First name' },
                      last_name: { type: 'string', description: 'Last name' },
                      employee_id: { type: 'string', description: 'Employee ID', optional: true },
                    },
                  },
                },
                interview_kit: {
                  type: 'object',
                  description: 'Interview kit details',
                  optional: true,
                  properties: {
                    id: { type: 'number', description: 'Kit ID' },
                    content: { type: 'string', description: 'Kit content (HTML)', optional: true },
                    questions: {
                      type: 'array',
                      description: 'Interview kit questions',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'number', description: 'Question ID' },
                          question: { type: 'string', description: 'Question text' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of stages returned' },
  },
}
