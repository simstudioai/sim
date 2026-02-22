import type { HexGetProjectRunsParams, HexGetProjectRunsResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const getProjectRunsTool: ToolConfig<HexGetProjectRunsParams, HexGetProjectRunsResponse> = {
  id: 'hex_get_project_runs',
  name: 'Hex Get Project Runs',
  description:
    'Retrieve the run history for a Hex project with optional filtering by status and pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the Hex project',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of runs to return (1-100, default: 25)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for paginated results (default: 0)',
    },
    statusFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by run status: PENDING, RUNNING, ERRORED, COMPLETED, KILLED, UNABLE_TO_ALLOCATE_KERNEL',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.offset) searchParams.set('offset', String(params.offset))
      if (params.statusFilter) searchParams.set('statusFilter', params.statusFilter)
      const qs = searchParams.toString()
      return `https://app.hex.tech/api/v1/projects/${params.projectId}/runs${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const runs = Array.isArray(data) ? data : (data.runs ?? [])

    return {
      success: true,
      output: {
        runs: runs.map((r: Record<string, unknown>) => ({
          projectId: (r.projectId as string) ?? null,
          runId: (r.runId as string) ?? null,
          runUrl: (r.runUrl as string) ?? null,
          status: (r.status as string) ?? null,
          startTime: (r.startTime as string) ?? null,
          endTime: (r.endTime as string) ?? null,
          elapsedTime: (r.elapsedTime as number) ?? null,
          traceId: (r.traceId as string) ?? null,
          projectVersion: (r.projectVersion as number) ?? null,
        })),
        total: runs.length,
        traceId: data.traceId ?? null,
      },
    }
  },

  outputs: {
    runs: {
      type: 'array',
      description: 'List of project runs',
      items: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID' },
          runId: { type: 'string', description: 'Run UUID' },
          runUrl: { type: 'string', description: 'URL to view the run', optional: true },
          status: {
            type: 'string',
            description:
              'Run status (PENDING, RUNNING, COMPLETED, ERRORED, KILLED, UNABLE_TO_ALLOCATE_KERNEL)',
          },
          startTime: { type: 'string', description: 'Run start time', optional: true },
          endTime: { type: 'string', description: 'Run end time', optional: true },
          elapsedTime: { type: 'number', description: 'Elapsed time in ms', optional: true },
          traceId: { type: 'string', description: 'Trace ID', optional: true },
          projectVersion: {
            type: 'number',
            description: 'Project version number',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of runs returned' },
    traceId: { type: 'string', description: 'Top-level trace ID', optional: true },
  },
}
