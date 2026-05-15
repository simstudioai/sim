import type {
  PdlBulkPersonEnrichParams,
  PdlBulkPersonEnrichResponse,
  PdlBulkPersonResultItem,
} from '@/tools/peopledatalabs/types'
import { projectPerson } from '@/tools/peopledatalabs/utils'
import type { OutputProperty, ToolConfig } from '@/tools/types'

const BULK_PERSON_RESULT_PROPERTIES = {
  status: { type: 'number', description: 'Per-record HTTP status (200 on match)' },
  matched: { type: 'boolean', description: 'Whether this record was matched' },
  likelihood: {
    type: 'number',
    description: 'Match likelihood (1-10), null if no match',
    optional: true,
  },
  metadata: {
    type: 'object',
    description: 'Metadata echoed back from the request',
    optional: true,
  },
  person: { type: 'object', description: 'Matched person record', optional: true },
} as const satisfies Record<string, OutputProperty>

export const bulkPersonEnrichTool: ToolConfig<
  PdlBulkPersonEnrichParams,
  PdlBulkPersonEnrichResponse
> = {
  id: 'pdl_bulk_person_enrich',
  name: 'PDL Bulk Person Enrich',
  description:
    'Enrich up to 100 person records in a single call. Provide a JSON array of request objects, each with a `params` object (and optional `metadata` echoed back). Reference: https://docs.peopledatalabs.com/docs/bulk-person-enrichment-api',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    requests: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of request objects, max 100. Each item: { "params": { email | profile | first_name+last_name+company | ... }, "metadata": {...optional...} }',
    },
    required: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required-fields expression applied globally to every request',
    },
  },

  request: {
    url: () => 'https://api.peopledatalabs.com/v5/person/bulk',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(params.requests)
      } catch {
        throw new Error('`requests` must be valid JSON (an array of request objects)')
      }
      if (!Array.isArray(parsed)) {
        throw new Error('`requests` must be a JSON array')
      }
      const body: Record<string, unknown> = { requests: parsed }
      if (params.required) body.required = params.required
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      const error = (data as { error?: { message?: string } })?.error?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const items = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>
    const results: PdlBulkPersonResultItem[] = items.map((item) => {
      const status = (item.status as number) ?? 0
      const record = (item.data as Record<string, unknown>) ?? null
      return {
        status,
        matched: status === 200 && record !== null,
        likelihood: (item.likelihood as number) ?? null,
        metadata: (item.metadata as Record<string, unknown>) ?? null,
        person: record ? projectPerson(record) : null,
      }
    })

    return { success: true, output: { results } }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Per-record results in the same order as the input requests',
      items: { type: 'object', properties: BULK_PERSON_RESULT_PROPERTIES },
    },
  },
}
