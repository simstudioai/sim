import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_ACCOUNT_DETAIL_OUTPUT_PROPERTIES,
  type MonacoGetAccountParams,
  type MonacoGetAccountResponse,
} from '@/tools/monaco/types'
import { MONACO_API_BASE, mapMonacoAccountDetail, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoGetAccountTool: ToolConfig<MonacoGetAccountParams, MonacoGetAccountResponse> = {
  id: 'monaco_get_account',
  name: 'Monaco Get Account',
  description:
    'Get one Monaco account by ID, including enriched company information, scoring, heat score explanations, and custom fields.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the account to fetch',
    },
    includeReasoning: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Return each custom field as {value, reasoning, confidence, citations} instead of the bare value. Defaults to false.',
    },
  },

  request: {
    url: (params) => {
      const url = `${MONACO_API_BASE}/v1/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}`
      return params.includeReasoning === undefined
        ? url
        : `${url}?include_reasoning=${params.includeReasoning}`
    },
    method: 'GET',
    headers: (params) => monacoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { account: mapMonacoAccountDetail(data.data) } }
  },

  outputs: {
    account: {
      type: 'object',
      description: 'The account',
      properties: MONACO_ACCOUNT_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
