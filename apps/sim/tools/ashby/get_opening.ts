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
  openingId: string
}
interface Response extends ToolResponse {
  output: AshbyOpening
}
export const getOpeningTool: ToolConfig<Params, Response> = {
  id: 'ashby_get_opening',
  name: 'Ashby Get Opening',
  description: 'Retrieves one Ashby headcount opening by UUID.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    openingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Opening UUID',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/opening.info',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey),
    body: (p) => ({ openingId: p.openingId.trim() }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(ashbyErrorMessage(data, 'Failed to get opening'))
    return { success: true, output: mapOpenings([data.results])[0] }
  },
  outputs: OPENINGS_OUTPUT.items.properties,
}
