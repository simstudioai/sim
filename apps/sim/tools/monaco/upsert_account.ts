import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM, MONACO_ACCOUNT_WRITE_PARAMS } from '@/tools/monaco/params'
import {
  MONACO_ACCOUNT_WRITE_OUTPUT_PROPERTIES,
  type MonacoAccountWriteResponse,
  type MonacoUpsertAccountParams,
} from '@/tools/monaco/types'
import {
  buildMonacoUpsertAccountBody,
  MONACO_API_BASE,
  mapMonacoAccountWrite,
  monacoHeaders,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoUpsertAccountTool: ToolConfig<
  MonacoUpsertAccountParams,
  MonacoAccountWriteResponse
> = {
  id: 'monaco_upsert_account',
  name: 'Monaco Upsert Account',
  description:
    'Create a Monaco account or update the one whose domain exactly matches the domain lookup. Pass an account ID instead to update that account by ID, or only a name to create an account without a domain where the workspace allows it. Creating an account enriches it with firmographic data and can take several seconds.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    domainLookup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Domain used to find the account, or to create it if none matches (a company record for the domain must exist in Monaco). Omit it to create an account from the name alone, where the workspace allows accounts without a company; every such call creates a new account. Not allowed with an account ID.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of an existing account to update by ID instead of matching by domain lookup; it is never created, and an unknown ID fails. Requires a user-scoped API key.',
    },
    ...MONACO_ACCOUNT_WRITE_PARAMS,
    linkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn company page URL for matching or creating the account',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        "Tag IDs to associate with the account, as an array or comma-separated list. Appended to the account's existing tags.",
    },
    domains: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        "The account's full ordered list of domains, primary first, as an array or comma-separated list (max 500). Only applies with an account ID. Send [] to remove them all.",
    },
    resetFields: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        "Company fields to reset to the linked company's value, as an array or comma-separated list. Only applies with an account ID. Allowed: linkedin_url, description, employee_count, founded_year, estimated_annual_revenue_usd, total_funding_usd, last_funding_round, last_funding_date, industries, business_model, company_status, location, domains.",
    },
    clearFields: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fields to clear on the account, as an array or comma-separated list. Only applies with an account ID; list company_id to unlink the company. Allowed: name, notes, owner, parent_account, company_id, linkedin_url, description, employee_count, founded_year, estimated_annual_revenue_usd, total_funding_usd, last_funding_round, last_funding_date, industries, business_model, company_status, location.',
    },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom field values as a JSON object keyed by `custom_field_<id>` (e.g. {"custom_field_7a1c...": "high"}). Use Get Field Schemas to find the keys.',
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/accounts/`,
    method: 'PUT',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => buildMonacoUpsertAccountBody(params),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { account: mapMonacoAccountWrite(data.data) } }
  },

  outputs: {
    account: {
      type: 'object',
      description: 'The created or updated account',
      properties: MONACO_ACCOUNT_WRITE_OUTPUT_PROPERTIES,
    },
  },
}
