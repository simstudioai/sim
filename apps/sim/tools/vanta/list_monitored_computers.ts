import type { ToolConfig } from '@/tools/types'
import {
  VANTA_MONITORED_COMPUTER_OUTPUT_PROPERTIES,
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListMonitoredComputersParams,
  VantaListMonitoredComputersResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListMonitoredComputersTool: ToolConfig<
  VantaListMonitoredComputersParams,
  VantaListMonitoredComputersResponse
> = {
  id: 'vanta_list_monitored_computers',
  name: 'Vanta List Monitored Computers',
  description:
    'List the monitored computers in a Vanta account with screenlock, disk encryption, password manager, and antivirus check outcomes',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
    },
    complianceStatusFilterMatchesAny: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated compliance issues to filter by: PWM_NOT_INSTALLED, HD_NOT_ENCRYPTED, AV_NOT_INSTALLED, SCREENLOCK_NOT_CONFIGURED, LAST_CHECK_OVER_14_DAYS',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items per page (1-100, default 10)',
    },
    pageCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor: pass the endCursor from the previous response to fetch the next page',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_list_monitored_computers',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      complianceStatusFilterMatchesAny: params.complianceStatusFilterMatchesAny,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListMonitoredComputersResponse>(
    'Failed to list Vanta monitored computers'
  ),

  outputs: {
    computers: {
      type: 'array',
      description: 'Monitored computers matching the filters',
      items: { type: 'object', properties: VANTA_MONITORED_COMPUTER_OUTPUT_PROPERTIES },
    },
    pageInfo: {
      type: 'json',
      description:
        'Cursor pagination info for the returned page; pass endCursor as pageCursor to fetch the next page',
      optional: true,
      properties: VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
