import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookPatentSearchParams, PitchbookResponse } from '@/tools/pitchbook/types'
import {
  mapStats,
  PITCHBOOK_API_BASE,
  pitchbookAuthHeaders,
  throwIfNotOk,
} from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookPatentSearchTool: ToolConfig<PitchbookPatentSearchParams, PitchbookResponse> =
  {
    id: 'pitchbook_patent_search',
    name: 'PitchBook Patent Search',
    description:
      'Search the patents held by a company by status, filing and publication date, authority, and CPC classification',
    version: '1.0.0',
    errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'PitchBook API key',
      },
      pbId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'PitchBook company ID, e.g. 10618-03. Use PitchBook Search to resolve a name to an ID.',
      },
      status: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Patent status: Active, Pending, or Inactive. Separate multiple values with a comma.',
      },
      publicationDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Publication date filter. Use >YYYY-MM-DD, <YYYY-MM-DD, or YYYY-MM-DD^YYYY-MM-DD for a range.',
      },
      firstFilingDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'First filing date filter. Use >YYYY-MM-DD, <YYYY-MM-DD, or YYYY-MM-DD^YYYY-MM-DD for a range.',
      },
      filingAuthorityLocation: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Filing authority location, e.g. EP or US. Separate multiple values with a comma.',
      },
      cpcSectionCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'CPC section code. Separate multiple values with a comma.',
      },
      cpcClassCode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'CPC class code. Separate multiple values with a comma.',
      },
      page: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page of results to return, starting at 1',
      },
      perPage: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'How many results to return per page',
      },
      currency: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
      },
    },

    request: {
      url: (params) => {
        const qs = new URLSearchParams()
        if (params.status) qs.set('status', params.status)
        if (params.publicationDate) qs.set('publicationDate', params.publicationDate)
        if (params.firstFilingDate) qs.set('firstFilingDate', params.firstFilingDate)
        if (params.filingAuthorityLocation) {
          qs.set('filingAuthorityLocation', params.filingAuthorityLocation)
        }
        if (params.cpcSectionCode) qs.set('cpcSectionCode', params.cpcSectionCode)
        if (params.cpcClassCode) qs.set('cpcClassCode', params.cpcClassCode)
        if (params.page !== undefined && params.page !== null) qs.set('page', String(params.page))
        if (params.perPage !== undefined && params.perPage !== null) {
          qs.set('perPage', String(params.perPage))
        }
        const query = qs.toString()
        return `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/patents/search${query ? `?${query}` : ''}`
      },
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to search patents')
      const data = await response.json()

      return {
        success: true,
        output: {
          companyId: data.companyId ?? null,
          stats: mapStats(data.stats),
          items: data.items ?? [],
        },
      }
    },

    outputs: {
      companyId: { type: 'string', description: 'PitchBook company ID' },
      stats: {
        type: 'object',
        description: 'Summary statistics for the response',
        properties: {
          total: { type: 'number', description: 'Total number of matching results' },
          perPage: { type: 'number', description: 'Results returned per page' },
          page: { type: 'number', description: 'Current page number' },
          lastPage: { type: 'number', description: 'Number of the last available page' },
        },
      },
      items: {
        type: 'array',
        description: 'Records returned',
        items: {
          type: 'object',
          properties: {
            patentId: { type: 'string', description: 'Patent ID' },
            patentTitle: { type: 'string', description: 'Patent title' },
            status: { type: 'string', description: 'Status' },
            publicationDate: { type: 'string', description: 'Publication date (YYYY-MM-DD)' },
            firstFilingDate: { type: 'string', description: 'First filing date (YYYY-MM-DD)' },
            expirationDate: { type: 'string', description: 'Expiration date (YYYY-MM-DD)' },
            filingAuthorityLocation: { type: 'string', description: 'Filing authority location' },
            cpcSection: {
              type: 'object',
              description: 'CPC section',
              properties: {
                code: { type: 'string', description: 'PitchBook code' },
                description: { type: 'string', description: 'Human-readable label for the code' },
              },
            },
            cpcClass: {
              type: 'object',
              description: 'CPC class',
              properties: {
                code: { type: 'string', description: 'PitchBook code' },
                description: { type: 'string', description: 'Human-readable label for the code' },
              },
            },
            cpcSubclass: {
              type: 'object',
              description: 'CPC subclass',
              properties: {
                code: { type: 'string', description: 'PitchBook code' },
                description: { type: 'string', description: 'Human-readable label for the code' },
              },
            },
          },
        },
      },
    },
  }
