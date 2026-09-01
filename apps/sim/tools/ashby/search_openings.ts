import type { AshbyOpening } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  mapOpenings,
  OPENINGS_OUTPUT,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface Params {
  apiKey: string
  identifier: string
}
interface Response extends ToolResponse {
  output: { openings: AshbyOpening[] }
}
export const searchOpeningsTool: ToolConfig<Params, Response> = {
  id: 'ashby_search_openings',
  name: 'Ashby Search Openings',
  description: 'Searches Ashby headcount openings by human-readable identifier.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Opening identifier',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/opening.search',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey),
    body: (p) => ({ identifier: p.identifier.trim() }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(ashbyErrorMessage(data, 'Failed to search openings'))
    return { success: true, output: { openings: mapOpenings(data.results) } }
  },
  outputs: { openings: OPENINGS_OUTPUT },
}
