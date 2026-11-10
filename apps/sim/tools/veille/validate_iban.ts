import { toBooleanOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { VeilleValidateIbanParams, VeilleValidateIbanResponse } from '@/tools/veille/types'

export const veilleValidateIbanTool: ToolConfig<
  VeilleValidateIbanParams,
  VeilleValidateIbanResponse
> = {
  id: 'veille_validate_iban',
  name: 'Veille Validate IBAN',
  description:
    "Check an IBAN's structure and checksum and get its bank name, BIC, bank and branch codes, country and SEPA membership.",
  version: '1.0.0',

  params: {
    iban: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The IBAN, with or without spaces (e.g., "FR7630006000011234567890189")',
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
      const url = new URL(`https://api.veille.io/v1/vat/iban`)
      url.searchParams.set('query', params.iban.trim())
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
        iban: toStringOrNull(data.iban),
        bic: toStringOrNull(data.bic),
        bankName: toStringOrNull(data.bank_name),
        bankCode: toStringOrNull(data.bank_code),
        branchCode: toStringOrNull(data.branch_code),
        accountNumber: toStringOrNull(data.account_number),
        bban: toStringOrNull(data.bban),
        checksumDigits: toStringOrNull(data.checksum_digits),
        countryCode: toStringOrNull(data.country_code),
        countryName: toStringOrNull(data.country_name),
        inSepaZone: toBooleanOrNull(data.in_sepa_zone),
      },
    }
  },

  outputs: {
    valid: {
      type: 'boolean',
      description: 'Whether the IBAN is valid',
      optional: true,
    },
    iban: {
      type: 'string',
      description: 'The IBAN without spaces',
      optional: true,
    },
    bic: {
      type: 'string',
      description: 'BIC of the bank',
      optional: true,
    },
    bankName: {
      type: 'string',
      description: 'Name of the bank',
      optional: true,
    },
    bankCode: {
      type: 'string',
      description: 'Bank code',
      optional: true,
    },
    branchCode: {
      type: 'string',
      description: 'Branch code',
      optional: true,
    },
    accountNumber: {
      type: 'string',
      description: 'Account number',
      optional: true,
    },
    bban: {
      type: 'string',
      description: 'Basic bank account number',
      optional: true,
    },
    checksumDigits: {
      type: 'string',
      description: 'Checksum digits',
      optional: true,
    },
    countryCode: {
      type: 'string',
      description: 'Country code of the IBAN',
      optional: true,
    },
    countryName: {
      type: 'string',
      description: 'Country of the IBAN',
      optional: true,
    },
    inSepaZone: {
      type: 'boolean',
      description: 'Whether the country is in the SEPA zone',
      optional: true,
    },
  },
}
