import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import type { MonacoDeleteAccountParams, MonacoDeleteResponse } from '@/tools/monaco/types'
import { MONACO_API_BASE, monacoHeaders } from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const monacoDeleteAccountTool: ToolConfig<MonacoDeleteAccountParams, MonacoDeleteResponse> =
  {
    id: 'monaco_delete_account',
    name: 'Monaco Delete Account',
    description:
      'Permanently delete a Monaco account. This cannot be undone. Its contacts and opportunities are not deleted but may become unlinked.',
    version: '1.0.0',
    oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
    errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

    params: {
      ...MONACO_ACCESS_TOKEN_PARAM,
      accountId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the account to delete',
      },
    },

    request: {
      url: (params) =>
        `${MONACO_API_BASE}/v1/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}`,
      method: 'DELETE',
      headers: (params) => monacoHeaders(params.accessToken),
    },

    transformResponse: async (_response, params) => ({
      success: true,
      output: { id: params?.accountId.trim() ?? '', deleted: true },
    }),

    outputs: {
      id: { type: 'string', description: 'ID of the deleted account' },
      deleted: { type: 'boolean', description: 'Whether Monaco deleted the account' },
    },
  }
