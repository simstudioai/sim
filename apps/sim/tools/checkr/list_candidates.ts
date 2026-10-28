import {
  CANDIDATE_PROPERTIES,
  type CheckrListCandidatesParams,
  type CheckrListCandidatesResponse,
  LIST_META_OUTPUTS,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrPaginationQuery,
  checkrUrl,
  mapCandidate,
  mapListMeta,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListCandidatesTool: ToolConfig<
  CheckrListCandidatesParams,
  CheckrListCandidatesResponse
> = {
  id: 'checkr_list_candidates',
  name: 'Checkr List Candidates',
  description:
    'List candidates, optionally filtered by email, name, custom ID, adjudication, dates, geo, or program. Candidates with non-US work locations are not returned.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with this email address',
    },
    fullName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with this full name',
    },
    customId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with this custom ID',
    },
    adjudication: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return candidates with this adjudication (engaged, pre_adverse_action, post_adverse_action)',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates created after this date (YYYY-MM-DD or ISO 8601)',
    },
    createdBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates created before this date (YYYY-MM-DD or ISO 8601)',
    },
    reportAdjudicatedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with a report adjudicated after this date',
    },
    reportAdjudicatedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with a report adjudicated before this date',
    },
    reportAdjudicatorEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with a report adjudicated by this user email',
    },
    reportRevisedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with a report revised after this date',
    },
    reportRevisedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with a report revised before this date',
    },
    driverLicenseNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates with this driver license number',
    },
    geoId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates assigned to this geo ID',
    },
    programId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return candidates in this program ID',
    },
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl('/candidates', {
        email: params.email,
        full_name: params.fullName,
        custom_id: params.customId,
        adjudication: params.adjudication,
        created_after: params.createdAfter,
        created_before: params.createdBefore,
        report_adjudicated_after: params.reportAdjudicatedAfter,
        report_adjudicated_before: params.reportAdjudicatedBefore,
        report_adjudicator_email: params.reportAdjudicatorEmail,
        report_revised_after: params.reportRevisedAfter,
        report_revised_before: params.reportRevisedBefore,
        driver_license_number: params.driverLicenseNumber,
        geo_id: params.geoId,
        program_id: params.programId,
        ...checkrPaginationQuery(params),
      }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        candidates: (Array.isArray(data.data) ? data.data : []).map(mapCandidate),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    candidates: {
      type: 'array',
      description: 'Matching candidates',
      items: { type: 'object', properties: CANDIDATE_PROPERTIES },
    },
    ...LIST_META_OUTPUTS,
  },
}
