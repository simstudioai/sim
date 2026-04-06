import type { RipplingCreateDraftHiresParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateDraftHiresTool: ToolConfig<RipplingCreateDraftHiresParams> = {
  id: 'rippling_create_draft_hires',
  name: 'Rippling Create Draft Hires',
  description: 'Create bulk draft hires',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    draftHires: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of draft hire objects',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/draft-hires/`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      return { draft_hires: params.draftHires }
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
        invalidItems: data.invalid_items ?? [],
        successfulResults: data.successful_results ?? [],
        totalInvalid: (data.invalid_items ?? []).length,
        totalSuccessful: (data.successful_results ?? []).length,
      },
    }
  },
  outputs: {
    invalidItems: { type: 'json', description: 'Failed draft hires' },
    successfulResults: { type: 'json', description: 'Successful draft hires' },
    totalInvalid: { type: 'number', description: 'Number of failures' },
    totalSuccessful: { type: 'number', description: 'Number of successes' },
  },
}
