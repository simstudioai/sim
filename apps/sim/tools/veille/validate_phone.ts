import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { VeilleValidatePhoneParams, VeilleValidatePhoneResponse } from '@/tools/veille/types'

export const veilleValidatePhoneTool: ToolConfig<
  VeilleValidatePhoneParams,
  VeilleValidatePhoneResponse
> = {
  id: 'veille_validate_phone',
  name: 'Veille Validate Phone',
  description:
    'Validate a phone number in E.164 format and get its line type, carrier, country, time zones, virtual or disposable flags and a 0-100 risk score.',
  version: '1.0.0',

  params: {
    phone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The phone number in E.164 format, starting with + (e.g., "+33142928100")',
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
      const url = new URL(`https://api.veille.io/v1/intelligence/phone`)
      url.searchParams.set('query', params.phone.trim())
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
        isValid: toBooleanOrNull(data.is_valid),
        e164Format: toStringOrNull(data.e164_format),
        internationalFormat: toStringOrNull(data.international_format),
        nationalFormat: toStringOrNull(data.national_format),
        lineType: toStringOrNull(data.line_type),
        carrier: toStringOrNull(data.carrier),
        carrierType: toStringOrNull(data.carrier_type),
        country: toStringOrNull(data.country),
        countryName: toStringOrNull(data.country_name),
        callingCode: toStringOrNull(data.country_code),
        region: toStringOrNull(data.location),
        timezones: toArray(data.timezones).filter(
          (item): item is string => typeof item === 'string'
        ),
        isVirtual: toBooleanOrNull(data.is_virtual),
        isDisposable: toBooleanOrNull(data.is_disposable),
        isSpam: toBooleanOrNull(data.is_spam),
        isThreat: toBooleanOrNull(data.is_threat),
        riskScore: toNumberOrNull(data.risk_score),
      },
    }
  },

  outputs: {
    isValid: {
      type: 'boolean',
      description: 'Whether the number is valid',
      optional: true,
    },
    e164Format: {
      type: 'string',
      description: 'The number in E.164 format',
      optional: true,
    },
    internationalFormat: {
      type: 'string',
      description: 'The number in international format',
      optional: true,
    },
    nationalFormat: {
      type: 'string',
      description: 'The number in national format',
      optional: true,
    },
    lineType: {
      type: 'string',
      description: 'Line type, such as mobile, fixed_line or voip',
      optional: true,
    },
    carrier: {
      type: 'string',
      description: 'Carrier of the number',
      optional: true,
    },
    carrierType: {
      type: 'string',
      description: 'Carrier type',
      optional: true,
    },
    country: {
      type: 'string',
      description: 'ISO 3166-1 alpha-2 country code of the number',
      optional: true,
    },
    countryName: {
      type: 'string',
      description: 'Country of the number',
      optional: true,
    },
    callingCode: {
      type: 'string',
      description: 'International calling code, without +',
      optional: true,
    },
    region: {
      type: 'string',
      description: 'City or region the number is registered to',
      optional: true,
    },
    timezones: {
      type: 'array',
      description: 'Time zones of the number',
      optional: true,
      items: { type: 'string' },
    },
    isVirtual: {
      type: 'boolean',
      description: 'Whether the number is virtual',
      optional: true,
    },
    isDisposable: {
      type: 'boolean',
      description: 'Whether the number is a disposable number',
      optional: true,
    },
    isSpam: {
      type: 'boolean',
      description: 'Whether the number is reported for spam',
      optional: true,
    },
    isThreat: {
      type: 'boolean',
      description: 'Whether the number is reported as a threat',
      optional: true,
    },
    riskScore: {
      type: 'number',
      description: 'Risk score from 0 (safe) to 100 (risky)',
      optional: true,
    },
  },
}
