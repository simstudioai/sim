import type { ToolConfig } from '@/tools/types'
import {
  VANTA_PAGE_INFO_OUTPUT_PROPERTIES,
  VANTA_VULNERABLE_ASSET_OUTPUT_PROPERTIES,
} from '@/tools/vanta/outputs'
import type {
  VantaListVulnerableAssetsParams,
  VantaListVulnerableAssetsResponse,
} from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaListVulnerableAssetsTool: ToolConfig<
  VantaListVulnerableAssetsParams,
  VantaListVulnerableAssetsResponse
> = {
  id: 'vanta_list_vulnerable_assets',
  name: 'Vanta List Vulnerable Assets',
  description:
    'List the assets associated with vulnerabilities in a Vanta account (servers, repositories, workstations, and more)',
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
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query for vulnerable assets',
    },
    integrationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the integration scanning the asset',
    },
    assetType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by asset type: SERVER, SERVERLESS_FUNCTION, CONTAINER, CONTAINER_REPOSITORY, CONTAINER_REPOSITORY_IMAGE, CODE_REPOSITORY, MANIFEST_FILE, WORKSTATION, or OTHER',
    },
    assetExternalAccountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the external account ID the asset belongs to',
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
      operation: 'vanta_list_vulnerable_assets',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      q: params.q,
      integrationId: params.integrationId,
      assetType: params.assetType,
      assetExternalAccountId: params.assetExternalAccountId,
      pageSize: params.pageSize,
      pageCursor: params.pageCursor,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaListVulnerableAssetsResponse>(
    'Failed to list Vanta vulnerable assets'
  ),

  outputs: {
    assets: {
      type: 'array',
      description: 'Vulnerable assets matching the filters',
      items: { type: 'object', properties: VANTA_VULNERABLE_ASSET_OUTPUT_PROPERTIES },
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
