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
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags for the report, as an array or comma-separated list',
    },
    selfDisclosures: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Candidate self-disclosed criminal history as a JSON array of { description, date, location: { county, state, country }, offense_level, offense_category, sentence, time_served } objects. Cannot be changed after the report is created',
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
