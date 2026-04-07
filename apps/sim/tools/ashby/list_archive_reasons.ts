import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListArchiveReasonsParams {
  apiKey: string
}

interface AshbyListArchiveReasonsResponse extends ToolResponse {
  output: {
    archiveReasons: Array<{
      id: string
      text: string
      reasonType: string
      isArchived: boolean
    }>
  }
}

export const listArchiveReasonsTool: ToolConfig<
  AshbyListArchiveReasonsParams,
  AshbyListArchiveReasonsResponse
> = {
  id: 'ashby_list_archive_reasons',
  name: 'Ashby List Archive Reasons',
  description: 'Lists all archive reasons configured in Ashby.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/archiveReason.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list archive reasons')
    }

    return {
      success: true,
      output: {
        archiveReasons: (data.results ?? []).map((r: Record<string, unknown>) => ({
          id: r.id ?? null,
          text: r.text ?? null,
          reasonType: r.reasonType ?? null,
          isArchived: r.isArchived ?? false,
        })),
      },
    }
  },

  outputs: {
    archiveReasons: {
      type: 'array',
      description: 'List of archive reasons',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Archive reason UUID' },
          text: { type: 'string', description: 'Archive reason text' },
          reasonType: { type: 'string', description: 'Reason type' },
          isArchived: { type: 'boolean', description: 'Whether the reason is archived' },
        },
      },
    },
  },
}
