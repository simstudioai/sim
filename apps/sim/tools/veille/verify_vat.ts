import { toBooleanOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { VeilleVerifyVatParams, VeilleVerifyVatResponse } from '@/tools/veille/types'

export const veilleVerifyVatTool: ToolConfig<VeilleVerifyVatParams, VeilleVerifyVatResponse> = {
  id: 'veille_verify_vat',
  name: 'Veille Verify VAT Number',
  description:
    'Check an EU VAT number against VIES and get whether it is valid, with the registered company name and address when the member state shares them.',
  version: '1.0.0',

  params: {
    vatNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The VAT number with its country prefix (e.g., "FR40303265045")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Veille API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.veille.io/v1/vat`)
      url.searchParams.set('query', params.vatNumber.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        valid: toBooleanOrNull(data.valid),
        vatNumber: toStringOrNull(data.vat_number),
        countryCode: toStringOrNull(data.country_code),
        companyName: toStringOrNull(data.company_name),
        companyAddress: toStringOrNull(data.company_address),
      },
    }
  },

  outputs: {
    valid: {
      type: 'boolean',
      description: 'Whether the number is valid',
      optional: true,
    },
    vatNumber: {
      type: 'string',
      description: 'The VAT number without its country prefix',
      optional: true,
    },
    countryCode: {
      type: 'string',
      description: 'Country code of the number',
      optional: true,
    },
    companyName: {
      type: 'string',
      description: 'Registered company name, when the member state shares it',
      optional: true,
    },
    companyAddress: {
      type: 'string',
      description: 'Registered company address, when the member state shares it',
      optional: true,
    },
  },
}
