import {
  oracleFusionServiceAuthParams,
  oracleFusionServiceOAuth,
  oracleFusionServiceStatusesOutputs,
} from '@/tools/oracle_fusion_service/shared'
import type {
  OracleFusionServiceParams,
  OracleFusionServiceResponse,
} from '@/tools/oracle_fusion_service/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionServiceListServiceRequestStatusesTool: InternalToolConfig<
  OracleFusionServiceParams,
  OracleFusionServiceResponse
> = {
  id: 'oracle_fusion_service_list_service_request_statuses',
  name: 'Oracle Fusion Service List Service Request Statuses',
  description:
    "Read one page of Oracle Fusion Service service request statuses. Returns enabled tenant status codes using Oracle's service-request status finder.",
  version: '1.0.0',
  oauth: oracleFusionServiceOAuth,
  params: {
    ...oracleFusionServiceAuthParams,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size, 1–100 (default 50).',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zero-based page offset (default 0).',
    },
    totalResults: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request Oracle estimated totalResults (default false).',
    },
  },
  operation: {
    input: (params) => ({
      accessToken: params.accessToken,
      instanceUrl: params.instanceUrl,
      limit: params.limit,
      offset: params.offset,
      totalResults: params.totalResults,
    }),
  },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of documented Oracle records.',
      items: { type: 'object', properties: oracleFusionServiceStatusesOutputs },
    },
    count: { type: 'number', description: 'Records in this page.' },
    hasMore: { type: 'boolean', description: 'Whether another page is available.' },
    limit: { type: 'number', description: 'Oracle page limit.' },
    offset: { type: 'number', description: 'Oracle page offset.' },
    totalResults: {
      type: 'number',
      description: 'Oracle estimated matching record count when requested.',
      optional: true,
    },
    nextOffset: {
      type: 'number',
      description: 'Offset for the next page; absent on the final page.',
      optional: true,
    },
  },
}
