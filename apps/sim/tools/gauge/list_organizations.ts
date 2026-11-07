import { DIRECTORY_ORGANIZATION_PROPERTIES } from '@/tools/gauge/outputs'
import type {
  GaugeListOrganizationsParams,
  GaugeListOrganizationsResponse,
  GaugeOrganizationList,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'

export const gaugeListOrganizationsTool: ToolConfig<
  GaugeListOrganizationsParams,
  GaugeListOrganizationsResponse
> = {
  id: 'gauge_list_organizations',
  name: 'Gauge List Organizations',
  description: 'List organizations and agency clients accessible to the connected API key.',
  version: '1.0.0',
  oauth: gaugeOAuth,
  params: {
    ...gaugeAuthParams,
  },
  request: {
    url: () => buildGaugeUrl(`/orgs`),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as GaugeOrganizationList
    return {
      success: true,
      output: {
        organizations: (data.data ?? []).map((item) => ({
          id: item.id,
          slug: item.slug,
          name: item.name,
          products: { chat: item.products.chat, agents: item.products.agents ?? null },
        })),
        nextCursor: data.nextCursor ?? null,
      },
    }
  },
  outputs: {
    organizations: {
      type: 'array',
      items: { type: 'object', properties: DIRECTORY_ORGANIZATION_PROPERTIES },
      description: 'Organizations',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for the next page; null when complete',
      nullable: true,
      optional: true,
    },
  },
}
