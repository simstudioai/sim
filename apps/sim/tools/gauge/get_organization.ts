import { DIRECTORY_ORGANIZATION_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeDirectoryOrganization,
  GaugeGetOrganizationParams,
  GaugeGetOrganizationResponse,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeGetOrganizationTool: ToolConfig<
  GaugeGetOrganizationParams,
  GaugeGetOrganizationResponse
> = {
  id: 'gauge_get_organization',
  name: 'Gauge Get Organization',
  description: 'Read an organization and its enabled Gauge products.',
  version: '1.0.0',
  oauth: gaugeOAuth,
  params: {
    ...gaugeAuthParams,
    org: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization slug or UUID',
    },
  },
  request: {
    url: (params) => buildGaugeUrl(`/orgs/${safeUrlPathSegment(params.org, 'org')}`),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeDirectoryOrganization
    return {
      success: true,
      output: {
        organization: {
          id: data.id,
          slug: data.slug,
          name: data.name,
          products: { chat: data.products.chat, agents: data.products.agents ?? null },
        },
      },
    }
  },
  outputs: {
    organization: {
      type: 'json',
      properties: DIRECTORY_ORGANIZATION_PROPERTIES,
      description: 'Organization',
    },
  },
}
