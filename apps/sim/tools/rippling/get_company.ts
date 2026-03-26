import type { RipplingGetCompanyParams, RipplingGetCompanyResponse } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCompanyTool: ToolConfig<
  RipplingGetCompanyParams,
  RipplingGetCompanyResponse
> = {
  id: 'rippling_get_company',
  name: 'Rippling Get Company',
  description: 'Get details for the current company in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
  },

  request: {
    url: 'https://api.rippling.com/platform/api/companies/current',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()

    const address = data.address ?? {}

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? null,
        address: {
          street: address.street ?? null,
          city: address.city ?? null,
          state: address.state ?? null,
          zip: address.zip ?? null,
          country: address.country ?? null,
        },
        email: data.email ?? null,
        phone: data.phone ?? null,
        workLocations: data.workLocations ?? [],
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Company ID' },
    name: { type: 'string', description: 'Company name', optional: true },
    address: {
      type: 'json',
      description: 'Company address with street, city, state, zip, country',
    },
    email: { type: 'string', description: 'Company email address', optional: true },
    phone: { type: 'string', description: 'Company phone number', optional: true },
    workLocations: {
      type: 'array',
      description: 'List of work location IDs',
      items: { type: 'string' },
    },
  },
}
