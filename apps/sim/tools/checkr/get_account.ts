import { toBooleanOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { CheckrGetAccountParams, CheckrGetAccountResponse } from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrUrl,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetAccountTool: ToolConfig<CheckrGetAccountParams, CheckrGetAccountResponse> = {
  id: 'checkr_get_account',
  name: 'Checkr Get Account',
  description:
    'Retrieve the authenticated Checkr account, including whether it is authorized to order checks and which screenings are available.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
  },

  request: {
    url: () => checkrUrl('/account'),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        account: {
          id: toStringOrNull(data.id) ?? '',
          name: toStringOrNull(data.name),
          uriName: toStringOrNull(data.uri_name),
          purpose: toStringOrNull(data.purpose),
          authorized: toBooleanOrNull(data.authorized),
          apiAuthorized: toBooleanOrNull(data.api_authorized),
          geosRequired: toBooleanOrNull(data.geos_required),
          segmentationEnabled: toBooleanOrNull(data.segmentation_enabled),
          availableScreenings: toArray(data.available_screenings).filter(
            (screening): screening is string => typeof screening === 'string'
          ),
          adverseActionEmail: toStringOrNull(data.adverse_action_email),
          billingEmail: toStringOrNull(data.billing_email),
          complianceContactEmail: toStringOrNull(data.compliance_contact_email),
          technicalContactEmail: toStringOrNull(data.technical_contact_email),
          supportEmail: toStringOrNull(data.support_email),
          supportPhone: toStringOrNull(data.support_phone),
          defaultComplianceCity: toStringOrNull(data.default_compliance_city),
          defaultComplianceState: toStringOrNull(data.default_compliance_state),
          createdAt: toStringOrNull(data.created_at),
          company: toRecordOrNull(data.company),
          accountDeauthorization: toRecordOrNull(data.account_deauthorization),
        },
      },
    }
  },

  outputs: {
    account: {
      type: 'object',
      description: 'The authenticated account',
      properties: {
        id: { type: 'string', description: 'Account ID' },
        name: { type: 'string', description: 'Account name', nullable: true },
        uriName: { type: 'string', description: 'Account slug used in URLs', nullable: true },
        purpose: {
          type: 'string',
          description: 'Permissible purpose (employment, business, insurance, tenant)',
          nullable: true,
        },
        authorized: {
          type: 'boolean',
          description: 'Whether the account is credentialed to order checks',
          nullable: true,
        },
        apiAuthorized: {
          type: 'boolean',
          description: 'Whether the account can order checks through the API',
          nullable: true,
        },
        geosRequired: {
          type: 'boolean',
          description: 'Whether a geo is required to order a report',
          nullable: true,
        },
        segmentationEnabled: {
          type: 'boolean',
          description: 'Whether the account hierarchy (nodes) is enabled',
          nullable: true,
        },
        availableScreenings: {
          type: 'array',
          description: 'Screening types available to the account',
          items: { type: 'string' },
        },
        adverseActionEmail: {
          type: 'string',
          description: 'Email that sends adverse action notices',
          nullable: true,
        },
        billingEmail: { type: 'string', description: 'Billing contact email', nullable: true },
        complianceContactEmail: {
          type: 'string',
          description: 'Compliance contact email',
          nullable: true,
        },
        technicalContactEmail: {
          type: 'string',
          description: 'Technical contact email',
          nullable: true,
        },
        supportEmail: {
          type: 'string',
          description: 'Email candidates use to contact you',
          nullable: true,
        },
        supportPhone: {
          type: 'string',
          description: 'Phone number candidates use to contact you',
          nullable: true,
        },
        defaultComplianceCity: {
          type: 'string',
          description: 'Fallback compliance city',
          nullable: true,
        },
        defaultComplianceState: {
          type: 'string',
          description: 'Fallback compliance state',
          nullable: true,
        },
        createdAt: { type: 'string', description: 'Time the account was created', nullable: true },
        company: {
          type: 'json',
          description:
            'Company details (name, dba_name, street, city, state, zipcode, phone, website, industry, incorporation_state, incorporation_type, tax_id)',
          nullable: true,
        },
        accountDeauthorization: {
          type: 'json',
          description: 'Deauthorization details (reason) when the account is deauthorized',
          nullable: true,
        },
      },
    },
  },
}
