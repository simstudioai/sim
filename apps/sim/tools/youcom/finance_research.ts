import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type {
  YouComFinanceResearchParams,
  YouComFinanceResearchResponse,
} from '@/tools/youcom/types'
import {
  FINANCE_RESEARCH_EFFORTS,
  mapResearchSources,
  RESEARCH_SOURCE_OUTPUTS,
  YOUCOM_API_BASE_URL,
  youComApiKeyParam,
  youComHeaders,
} from '@/tools/youcom/utils'

export const youComFinanceResearchTool: ToolConfig<
  YouComFinanceResearchParams,
  YouComFinanceResearchResponse
> = {
  id: 'youcom_finance_research',
  name: 'You.com Finance Research',
  description:
    'Research a financial question across earnings reports, SEC filings, analyst coverage, and market news, and get a cited answer.',
  version: '1.0.0',

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Financial research question (up to 40,000 characters)',
    },
    researchEffort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Depth of research: deep (<120s) or exhaustive (<300s). Defaults to deep',
    },
    apiKey: youComApiKeyParam,
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ input: params.input }),
    },
    url: `${YOUCOM_API_BASE_URL}/finance_research`,
    method: 'POST',
    headers: youComHeaders,
    body: (params) => {
      const body: Record<string, unknown> = { input: params.input }
      if (params.researchEffort && FINANCE_RESEARCH_EFFORTS.has(params.researchEffort)) {
        body.research_effort = params.researchEffort
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const output = toRecordOrNull(data.output) ?? {}

    return {
      success: true,
      output: {
        content: String(output.content ?? ''),
        contentType: String(output.content_type ?? 'text'),
        sources: mapResearchSources(output.sources),
        warnings: toArray(data.warnings).map(String),
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Markdown answer with numbered inline citations referencing sources',
    },
    contentType: { type: 'string', description: 'Format of content (text)' },
    ...RESEARCH_SOURCE_OUTPUTS,
  },
}
