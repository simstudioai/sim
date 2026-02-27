import type { ShortIoListDomainsParams } from '@/tools/short_io/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const shortIoListDomainsTool: ToolConfig<ShortIoListDomainsParams, ToolResponse> = {
  id: 'short_io_list_domains',
  name: 'Short.io List Domains',
  description: 'List Short.io domains. Returns domain IDs and details for use in List Links.',
  version: '1.0',
  params: {
    apiKey: { type: 'string', required: true, visibility: 'user-only', description: 'Short.io Secret API Key' },
  },
  request: {
    url: 'https://api.short.io/api/domains',
    method: 'GET',
    headers: (params) => ({
      Authorization: params.apiKey,
      Accept: 'application/json',
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const err = await response.text().catch(() => response.statusText)
      return { success: false, output: { success: false, error: err } }
    }
    const data = await response.json().catch(() => ({}))
    const list = Array.isArray(data) ? data : data.domains ?? data.list ?? []
    return {
      success: true,
      output: { success: true, domains: list, count: list.length },
    }
  },
  outputs: {
    success: { type: 'boolean', description: 'Success status' },
    domains: { type: 'array', description: 'List of domain objects (id, hostname, etc.)' },
    count: { type: 'number', description: 'Number of domains' },
    error: { type: 'string', description: 'Error message' },
  },
}
