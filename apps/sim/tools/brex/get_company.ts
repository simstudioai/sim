import type { BrexApiKeyParams, BrexGetCompanyResponse } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexGetCompanyTool: ToolConfig<BrexApiKeyParams, BrexGetCompanyResponse> = {
  id: 'brex_get_company',
  name: 'Brex Get Company',
  description: 'Get the Brex company associated with the API token',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
  },

  request: {
    url: `${BREX_API_BASE}/v2/company`,
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        id: data.id ?? '',
        legalName: data.legal_name ?? '',
        mailingAddress: data.mailing_address ?? null,
        accountType: data.account_type ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique company ID' },
    legalName: { type: 'string', description: 'Legal name of the company' },
    mailingAddress: {
      type: 'json',
      description: 'Company mailing address (line1, line2, city, state, country, postal_code)',
      optional: true,
    },
    accountType: {
      type: 'string',
      description: 'Brex account type (BREX_CLASSIC or BREX_EMPOWER)',
      optional: true,
    },
  },
}
