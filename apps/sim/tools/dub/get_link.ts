import type { DubGetLinkParams, DubGetLinkResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const getLinkTool: ToolConfig<DubGetLinkParams, DubGetLinkResponse> = {
  id: 'dub_get_link',
  name: 'Dub Get Link',
  description:
    'Retrieve information about a short link by its link ID, external ID, or domain + key combination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    linkId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The unique ID of the short link',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The external ID of the link in your database',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The domain of the link (use with key)',
    },
    key: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The slug of the link (use with domain)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/links/info')
      if (params.linkId) url.searchParams.set('linkId', params.linkId)
      if (params.externalId) url.searchParams.set('externalId', params.externalId)
      if (params.domain) url.searchParams.set('domain', params.domain)
      if (params.key) url.searchParams.set('key', params.key)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to get link')
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        domain: data.domain ?? '',
        key: data.key ?? '',
        url: data.url ?? '',
        shortLink: data.shortLink ?? '',
        qrCode: data.qrCode ?? '',
        archived: data.archived ?? false,
        externalId: data.externalId ?? null,
        title: data.title ?? null,
        description: data.description ?? null,
        tags: data.tags ?? [],
        clicks: data.clicks ?? 0,
        leads: data.leads ?? 0,
        sales: data.sales ?? 0,
        saleAmount: data.saleAmount ?? 0,
        lastClicked: data.lastClicked ?? null,
        createdAt: data.createdAt ?? '',
        updatedAt: data.updatedAt ?? '',
        utm_source: data.utm_source ?? null,
        utm_medium: data.utm_medium ?? null,
        utm_campaign: data.utm_campaign ?? null,
        utm_term: data.utm_term ?? null,
        utm_content: data.utm_content ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique ID of the link' },
    domain: { type: 'string', description: 'Domain of the short link' },
    key: { type: 'string', description: 'Slug of the short link' },
    url: { type: 'string', description: 'Destination URL' },
    shortLink: { type: 'string', description: 'Full short link URL' },
    qrCode: { type: 'string', description: 'QR code URL for the short link' },
    archived: { type: 'boolean', description: 'Whether the link is archived' },
    externalId: { type: 'string', description: 'External ID', optional: true },
    title: { type: 'string', description: 'OG title', optional: true },
    description: { type: 'string', description: 'OG description', optional: true },
    tags: { type: 'json', description: 'Tags assigned to the link (id, name, color)' },
    clicks: { type: 'number', description: 'Number of clicks' },
    leads: { type: 'number', description: 'Number of leads' },
    sales: { type: 'number', description: 'Number of sales' },
    saleAmount: { type: 'number', description: 'Total sale amount in cents' },
    lastClicked: { type: 'string', description: 'Last clicked timestamp', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    utm_source: { type: 'string', description: 'UTM source parameter', optional: true },
    utm_medium: { type: 'string', description: 'UTM medium parameter', optional: true },
    utm_campaign: { type: 'string', description: 'UTM campaign parameter', optional: true },
    utm_term: { type: 'string', description: 'UTM term parameter', optional: true },
    utm_content: { type: 'string', description: 'UTM content parameter', optional: true },
  },
}
