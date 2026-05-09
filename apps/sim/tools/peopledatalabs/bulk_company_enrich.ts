import type {
  PdlBulkCompanyEnrichParams,
  PdlBulkCompanyEnrichResponse,
  PdlBulkCompanyResultItem,
} from '@/tools/peopledatalabs/types'
import { projectCompany } from '@/tools/peopledatalabs/utils'
import type { OutputProperty, ToolConfig } from '@/tools/types'

const BULK_COMPANY_RESULT_PROPERTIES = {
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
  company: { type: 'object', description: 'Matched company record', optional: true },
} as const satisfies Record<string, OutputProperty>

export const bulkCompanyEnrichTool: ToolConfig<
  PdlBulkCompanyEnrichParams,
  PdlBulkCompanyEnrichResponse
> = {
  id: 'pdl_bulk_company_enrich',
  name: 'PDL Bulk Company Enrich',
  description:
    'Enrich up to 100 companies in a single call. Provide a JSON array of request objects, each with a `params` object. Reference: https://docs.peopledatalabs.com/docs/bulk-company-enrichment-api',
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
        'JSON array of request objects, max 100. Each item: { "params": { name | website | profile | ticker | pdl_id }, "metadata": {...optional...} }',
    },
    required: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required-fields expression applied globally to every request',
    },
  },

  request: {
    url: () => 'https://api.peopledatalabs.com/v5/company/enrich/bulk',
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
    const results: PdlBulkCompanyResultItem[] = items.map((item) => {
      const status = (item.status as number) ?? 0
      const record = (item.data as Record<string, unknown>) ?? null
      return {
        status,
        likelihood: (item.likelihood as number) ?? null,
        matched: status === 200 && record !== null,
        metadata: (item.metadata as Record<string, unknown>) ?? null,
        company: record ? projectCompany(record) : null,
      }
    })

    return { success: true, output: { results } }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Per-record results in the same order as the input requests',
      items: { type: 'object', properties: BULK_COMPANY_RESULT_PROPERTIES },
    },
  },
}
