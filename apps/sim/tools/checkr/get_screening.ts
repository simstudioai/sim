import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type { CheckrGetScreeningParams, CheckrGetScreeningResponse } from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

/** Screening type → Checkr collection path, exactly as the API reference spells each one. */
const SCREENING_PATHS: Record<string, string> = {
  ssn_trace: 'ssn_traces',
  sex_offender_search: 'sex_offender_searches',
  global_watchlist_search: 'global_watchlist_searches',
  national_criminal_search: 'national_criminal_searches',
  county_criminal_search: 'county_criminal_searches',
  state_criminal_search: 'state_criminal_searches',
  federal_criminal_search: 'federal_criminal_searches',
  federal_district_criminal_search: 'federal_district_criminal_searches',
  federal_civil_search: 'federal_civil_searches',
  federal_district_civil_search: 'federal_civil_district_searches',
  motor_vehicle_report: 'motor_vehicle_reports',
  drug_alcohol_clearinghouse_search: 'drug_alcohol_clearinghouse_searches',
  fmcsa_pre_employment_screening_program_search: 'fmcsa_pre_employment_screening_program_searches',
  education_verification: 'education_verifications',
  employment_verification: 'employment_verifications',
  personal_reference_verification: 'personal_reference_verifications',
  professional_reference_verification: 'professional_reference_verifications',
  professional_license_verification: 'professional_license_verifications',
  social_media_screening: 'social_media_screenings',
  facis_search: 'facis_searches',
  identity_data_evaluation: 'identity_data_evaluations',
  international_adverse_media_search: 'international_adverse_media_searches',
  international_criminal_search: 'international_criminal_searches',
  international_education_verification: 'international_education_verifications',
  international_employment_verification: 'international_employment_verifications',
  international_global_watchlist_search: 'international_global_watchlist_searches',
  international_identity_document_validation: 'international_identity_document_validation',
  international_motor_vehicle_report: 'international_motor_vehicle_reports',
}

export const checkrGetScreeningTool: ToolConfig<
  CheckrGetScreeningParams,
  CheckrGetScreeningResponse
> = {
  id: 'checkr_get_screening',
  name: 'Checkr Get Screening',
  description:
    'Retrieve the results of one screening in a report, such as an SSN trace, county criminal search, or motor vehicle report. Get the screening ID from the report.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    screeningType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: `Screening type, one of: ${Object.keys(SCREENING_PATHS).join(', ')}`,
    },
    screeningId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the screening, taken from the matching report field',
    },
  },

  request: {
    url: (params) => {
      const screeningType = params.screeningType?.trim() ?? ''
      const path = Object.hasOwn(SCREENING_PATHS, screeningType)
        ? SCREENING_PATHS[screeningType]
        : undefined
      if (!path) {
        throw new Error(
          `Invalid screeningType "${params.screeningType}". Expected one of: ${Object.keys(SCREENING_PATHS).join(', ')}.`
        )
      }
      return checkrUrl(`/${path}/${checkrId(params.screeningId, 'screeningId')}`)
    },
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        screening: {
          id: toStringOrNull(data.id) ?? '',
          object: toStringOrNull(data.object),
          uri: toStringOrNull(data.uri),
          status: toStringOrNull(data.status),
          result: toStringOrNull(data.result),
          assessment: toStringOrNull(data.assessment),
          createdAt: toStringOrNull(data.created_at),
          completedAt: toStringOrNull(data.completed_at),
          turnaroundTime: typeof data.turnaround_time === 'number' ? data.turnaround_time : null,
          estimatedCompletionTime: toStringOrNull(data.estimated_completion_time),
          cancellationReason: toStringOrNull(data.cancellation_reason),
          cancellationReasonDescription: toStringOrNull(data.cancellation_reason_description),
          records: toArray(data.records).map((record) => toRecord(record)),
          details: data,
        },
      },
    }
  },

  outputs: {
    screening: {
      type: 'object',
      description: 'The screening',
      properties: {
        id: { type: 'string', description: 'Screening ID' },
        object: {
          type: 'string',
          description: 'Screening object type, e.g. county_criminal_search',
          nullable: true,
        },
        uri: { type: 'string', description: 'Screening API URI', nullable: true },
        status: {
          type: 'string',
          description: 'Status (pending, complete, canceled, suspended)',
          nullable: true,
        },
        result: { type: 'string', description: 'Result (clear, consider)', nullable: true },
        assessment: {
          type: 'string',
          description: 'Assess result (eligible, review, escalated) for Assess-enabled accounts',
          nullable: true,
        },
        createdAt: {
          type: 'string',
          description: 'Time the screening was created',
          nullable: true,
        },
        completedAt: {
          type: 'string',
          description: 'Time the screening was completed',
          nullable: true,
        },
        turnaroundTime: {
          type: 'number',
          description: 'Seconds from creation to completion',
          nullable: true,
        },
        estimatedCompletionTime: {
          type: 'string',
          description: 'Estimated completion time, where Checkr provides one',
          nullable: true,
        },
        cancellationReason: {
          type: 'string',
          description: 'Cancellation reason code when the screening was canceled',
          nullable: true,
        },
        cancellationReasonDescription: {
          type: 'string',
          description: 'Cancellation reason description',
          nullable: true,
        },
        records: {
          type: 'json',
          description:
            'Records found by criminal and civil searches (case_number, county, state, charges with charge, classification, disposition, offense_date, and more); empty for screenings without records',
        },
        details: {
          type: 'json',
          description:
            'Complete screening object as returned by Checkr, including type-specific fields such as county, state, licenses, violations, or verification results',
        },
      },
    },
  },
}
