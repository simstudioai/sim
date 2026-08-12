import type { ToolConfig } from '@/tools/types'
import {
  WINDCHILL_LIST_DOCUMENTS_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillReadUrl,
  transformWindchillDirectRead,
  windchillReadHeaders,
} from '@/tools/windchill/utils'

export const windchillListDocumentsTool: ToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_list_documents',
  name: 'Windchill List Documents',
  description: 'List documents with an OData query, sorting, and pagination',
  version: '1.0.0',
  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Complete WRS 2.7 versioned service root using Basic authentication, for example https://host/Windchill/servlet/odata/v6',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Windchill service-account username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Windchill service-account password',
    },
    select: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated normalized document properties to return',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData $filter expression',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData $orderby expression',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum documents in the OData result set ($top), from 1 to 2000',
    },
    skip: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Documents to skip',
    },
    count: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ask Windchill to include the total matching count',
    },
    latestVersion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only the latest version of matching documents',
    },
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Verified @odata.nextLink from a previous list response',
    },
  },
  request: {
    url: (params) => buildWindchillReadUrl('windchill_list_documents', params),
    method: 'GET',
    headers: windchillReadHeaders,
    stripAuthOnRedirect: true,
    retry: { enabled: true, maxRetries: 2, retryIdempotentOnly: true },
  },
  transformResponse: (response) =>
    transformWindchillDirectRead('windchill_list_documents', response),
  outputs: WINDCHILL_LIST_DOCUMENTS_OUTPUTS,
}
