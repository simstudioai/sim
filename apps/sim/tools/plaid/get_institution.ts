import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PlaidGetInstitutionParams, PlaidGetInstitutionResponse } from '@/tools/plaid/types'
import {
  buildPlaidHeaders,
  mapPlaidInstitution,
  parsePlaidCountryCodes,
  plaidBaseParamFields,
  plaidBody,
  plaidInstitutionOutputProperties,
  plaidRecord,
  plaidUrl,
  requirePlaidInputString,
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
      description: "Comma-separated ISO country codes (defaults to 'US')",
    },
  },

  request: {
    url: (params) => plaidUrl(params, '/institutions/get_by_id'),
    method: 'POST',
    headers: (params) => buildPlaidHeaders(params),
    body: (params) =>
      plaidBody({
        institution_id: requirePlaidInputString(params.institutionId, 'institutionId'),
        country_codes: parsePlaidCountryCodes(params.countryCodes),
        options: { include_optional_metadata: true },
      }),
  },

  transformResponse: async (response) => {
    const data = await plaidRecord(response, 'institution')
    return {
      success: true,
      output: {
        institution: mapPlaidInstitution(data.institution),
      },
    }
  },

  outputs: {
    institution: {
      type: 'object',
      description: 'Institution details',
      properties: plaidInstitutionOutputProperties,
    },
  },
}
