import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskListOrganizationsParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { getZohoDeskApiBase, getZohoDeskErrorMessage } from '@/tools/zoho_desk/utils'

export const zohoDeskListOrganizationsTool: ToolConfig<
  ZohoDeskListOrganizationsParams,
  ZohoDeskResponse
> = {
  id: 'zoho_desk_list_organizations',
  name: 'Zoho Desk List Organizations',
  description: 'List the Zoho Desk organizations (portals) the connected account can access.',
  version: '1.0.0',

  oauth: { required: true, provider: 'zoho-desk' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zoho Desk OAuth access token',
    },
    apiDomain: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Zoho Desk data-center REST base URL',
    },
  },

  request: {
    // The organizations endpoint is the only Desk call that does not require the
    // orgId header, so it can be listed before an organization is selected.
    // No query params: Zoho documents none for /organizations and its sample is
    // a bare GET. Passing an unsupported `limit` risks a 422 on the one call
    // that bootstraps every other operation. Zoho's default page size applies.
    url: (params) => `${getZohoDeskApiBase(params)}/organizations`,
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) throw new Error('Zoho Desk access token is required')
      return {
        Authorization: `Zoho-oauthtoken ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        getZohoDeskErrorMessage(data, `Failed to list organizations (HTTP ${response.status})`)
      )
    }
    const organizations = Array.isArray(data.data) ? data.data : []
    return {
      success: true,
      output: { organizations, count: organizations.length },
    }
  },

  outputs: {
    organizations: {
      type: 'array',
      description: 'Accessible organizations',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Organization ID' },
          companyName: { type: 'string', description: 'Company name', optional: true },
          portalName: { type: 'string', description: 'Portal name', optional: true },
        },
      },
    },
    count: { type: 'number', description: 'Number of organizations returned' },
  },
}
