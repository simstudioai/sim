import type { DubUpsertLinkParams, DubUpsertLinkResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const upsertLinkTool: ToolConfig<DubUpsertLinkParams, DubUpsertLinkResponse> = {
  id: 'dub_upsert_link',
  name: 'Dub Upsert Link',
  description:
    'Create or update a short link by its URL. If a link with the same URL already exists, update it. Otherwise, create a new link.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The destination URL of the short link',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom domain for the short link (defaults to dub.sh)',
    },
    key: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom slug for the short link (randomly generated if not provided)',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'External ID for the link in your database',
    },
    tagIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs to assign to the link',
    },
    comments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comments for the short link',
    },
    expiresAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expiration date in ISO 8601 format',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Password to protect the short link',
    },
    rewrite: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to enable link cloaking',
    },
    archived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to archive the link',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom OG title for the link preview',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom OG description for the link preview',
    },
    utm_source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UTM source parameter',
    },
    utm_medium: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UTM medium parameter',
    },
    utm_campaign: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UTM campaign parameter',
    },
    utm_term: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UTM term parameter',
    },
    utm_content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UTM content parameter',
    },
  },

  request: {
    url: 'https://api.dub.co/links/upsert',
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = { url: params.url }
      if (params.domain) body.domain = params.domain
      if (params.key) body.key = params.key
      if (params.externalId) body.externalId = params.externalId
      if (params.tagIds) body.tagIds = params.tagIds.split(',').map((id) => id.trim())
      if (params.comments) body.comments = params.comments
      if (params.expiresAt) body.expiresAt = params.expiresAt
      if (params.password) body.password = params.password
      if (params.rewrite !== undefined) body.rewrite = params.rewrite
      if (params.archived !== undefined) body.archived = params.archived
      if (params.title) body.title = params.title
      if (params.description) body.description = params.description
      if (params.utm_source) body.utm_source = params.utm_source
      if (params.utm_medium) body.utm_medium = params.utm_medium
      if (params.utm_campaign) body.utm_campaign = params.utm_campaign
      if (params.utm_term) body.utm_term = params.utm_term
      if (params.utm_content) body.utm_content = params.utm_content
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to upsert link')
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
