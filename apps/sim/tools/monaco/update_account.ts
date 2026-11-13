import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_ACCOUNT_WRITE_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_ACCOUNT_WRITE_OUTPUT_PROPERTIES,
  type MonacoAccountWriteResponse,
  type MonacoUpdateAccountParams,
} from '@/tools/monaco/types'
import {
  buildMonacoUpdateAccountBody,
  MONACO_API_BASE,
  mapMonacoAccountWrite,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoUpdateAccountTool: ToolConfig<
  MonacoUpdateAccountParams,
  MonacoAccountWriteResponse
> = {
  id: 'monaco_update_account',
  name: 'Monaco Update Account',
  description:
    "Update fields on an existing Monaco account by ID. Only the fields sent change. Domains replace the account's whole domain list, and a domain another account already uses fails the request.",
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the account to update',
    },
    ...MONACO_ACCOUNT_WRITE_PARAMS,
    tags: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        "Tag IDs for the account, as an array or comma-separated list. Replaces the account's existing tags.",
    },
    domains: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        "The account's complete list of domains, primary first, as an array or comma-separated list (max 500). Replaces the whole list: domains left out are removed. Send [] to remove them all.",
    },
    resetFields: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        "Company fields to reset to the linked company's value, as an array or comma-separated list; later company updates fill them again. Allowed: linkedin_url, description, employee_count, founded_year, estimated_annual_revenue_usd, total_funding_usd, last_funding_round, last_funding_date, industries, business_model, company_status, location, domains.",
    },
    clearFields: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fields to clear on the account, as an array or comma-separated list. Clearing parent_account makes the account top-level and clearing company_id unlinks its company. Allowed: name, notes, owner, parent_account, company_id, linkedin_url, description, employee_count, founded_year, estimated_annual_revenue_usd, total_funding_usd, last_funding_round, last_funding_date, industries, business_model, company_status, location.',
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom field values to set, as a JSON object keyed by `custom_field_<id>` (e.g. {"custom_field_<id>": "value"}). Custom fields are always updatable; use Get Field Schemas to find the keys.',
    },
  },

  request: {
    url: (params) =>
      `${MONACO_API_BASE}/v1/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}`,
    method: 'PATCH',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoUpdateAccountBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { account: mapMonacoAccountWrite(data.data) } }
  },

  outputs: {
    account: {
      type: 'object',
      description: 'The updated account',
      properties: MONACO_ACCOUNT_WRITE_OUTPUT_PROPERTIES,
    },
  },
}
