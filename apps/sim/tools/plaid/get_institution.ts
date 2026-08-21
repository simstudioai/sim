import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetInstitutionParams, PlaidGetInstitutionResponse } from '@/tools/plaid/types'
import {
  PLAID_INSTITUTION_OUTPUT_PROPERTIES,
  PLAID_REQUEST_ID_OUTPUT_PROPERTY,
} from '@/tools/plaid/types'
import {
  buildPlaidInternalBody,
  mapPlaidInstitution,
  parsePlaidCountryCodes,
  plaidBaseParamFields,
  plaidRecord,
  requirePlaidInputString,
  requirePlaidStringField,
} from '@/tools/plaid/utils'
import type { ToolConfig } from '@/tools/types'

export const plaidGetInstitutionTool: ToolConfig<
  PlaidGetInstitutionParams,
  PlaidGetInstitutionResponse
> = {
  id: 'plaid_get_institution',
  name: 'Plaid Get Institution',
  description: 'Get details for a financial institution by its Plaid institution ID',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PLAID_ERRORS,

  params: {
    ...plaidBaseParamFields,
    institutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Plaid institution ID, e.g. 'ins_109508'",
    },
    countryCodes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Comma-separated Plaid-supported country codes (defaults to 'US')",
    },
  },

  request: {
    url: '/api/tools/plaid',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) =>
      buildPlaidInternalBody('plaid_get_institution', params, {
        institution_id: requirePlaidInputString(params.institutionId, 'institutionId'),
        country_codes: parsePlaidCountryCodes(params.countryCodes),
      }),
    internalAuth: 'executor_delegation',
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'institution')
    return {
      success: true,
      output: {
        requestId: requirePlaidStringField(data, 'request_id', 'institution.request_id'),
        institution: mapPlaidInstitution(data.institution),
      },
    }
  },

  outputs: {
    requestId: PLAID_REQUEST_ID_OUTPUT_PROPERTY,
    institution: {
      type: 'object',
      description: 'Institution details',
      properties: PLAID_INSTITUTION_OUTPUT_PROPERTIES,
    },
  },
}
