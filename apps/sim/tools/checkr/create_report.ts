import {
  type CheckrCreateReportParams,
  type CheckrReportResponse,
  REPORT_PROPERTIES,
} from '@/tools/checkr/types'
import {
  applyHierarchyFields,
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_HIERARCHY_PARAMS,
  checkrHeaders,
  checkrUrl,
  mapReport,
  parseCheckrArray,
  parseCheckrStringList,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCreateReportTool: ToolConfig<CheckrCreateReportParams, CheckrReportResponse> = {
  id: 'checkr_create_report',
  name: 'Checkr Create Report',
  description:
    'Order a background check report for a candidate using a package. Use only when you collect the candidate’s PII and consent yourself; otherwise create an invitation. Packages with international screenings must use invitations.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the candidate to screen',
    },
    package: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Slug of the package to run, e.g. driver_pro',
    },
    ...CHECKR_HIERARCHY_PARAMS,
    tags: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags for the report',
    },
    selfDisclosures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Candidate statement about the record' },
          date: { type: 'string', description: 'Conviction date (YYYY-MM-DD)' },
          location: {
            type: 'object',
            properties: {
              county: { type: 'string', description: 'County name from List Counties' },
              state: { type: 'string', description: 'Two-letter state code' },
              country: { type: 'string', description: 'Country, defaults to US' },
            },
            required: ['county', 'state'],
          },
          offense_level: { type: 'string', description: 'Offense level, e.g. Misdemeanor' },
          offense_category: { type: 'string', description: 'Criminal charge' },
          sentence: { type: 'string', description: 'Sentence imposed' },
          time_served: { type: 'string', description: 'Time served' },
        },
        required: ['description', 'date', 'location'],
      },
      required: false,
      visibility: 'user-or-llm',
      description:
        'Candidate self-disclosed criminal history. Cannot be changed after the report is created',
    },
  },

  request: {
    url: () => checkrUrl('/reports'),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        candidate_id: trimmed(params.candidateId),
        package: trimmed(params.package),
      }
      applyHierarchyFields(body, params)
      const tags = parseCheckrStringList(params.tags)
      if (tags) body.tags = tags
      const selfDisclosures = parseCheckrArray(params.selfDisclosures, 'selfDisclosures')
      if (selfDisclosures) body.self_disclosures = selfDisclosures
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { report: mapReport(data) } }
  },

  outputs: {
    report: { type: 'object', description: 'The created report', properties: REPORT_PROPERTIES },
  },
}
