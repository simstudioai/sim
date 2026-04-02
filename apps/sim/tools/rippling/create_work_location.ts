import type { RipplingCreateWorkLocationParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateWorkLocationTool: ToolConfig<RipplingCreateWorkLocationParams> = {
  id: 'rippling_create_work_location',
  name: 'Rippling Create Work Location',
  description: 'Create a new work location',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Location name',
    },
    streetAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Street address',
    },
    locality: { type: 'string', required: false, visibility: 'user-or-llm', description: 'City' },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State/region',
    },
    postalCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Postal code',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code',
    },
    addressType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Address type (HOME, WORK, OTHER)',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/work-locations/`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { name: params.name }
      const address: Record<string, string> = { street_address: params.streetAddress }
      if (params.locality != null) address.locality = params.locality
      if (params.region != null) address.region = params.region
      if (params.postalCode != null) address.postal_code = params.postalCode
      if (params.country != null) address.country = params.country
      if (params.addressType != null) address.type = params.addressType
      body.address = address
      return body
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        name: (data.name as string) ?? null,
        address: data.address ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Location ID' },
    created_at: { type: 'string', description: 'Created timestamp', optional: true },
    updated_at: { type: 'string', description: 'Updated timestamp', optional: true },
    name: { type: 'string', description: 'Name' },
    address: { type: 'json', description: 'Address', optional: true },
  },
}
