import { DubIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { DubResponse } from '@/tools/dub/types'

export const DubBlock: BlockConfig<DubResponse> = {
  type: 'dub',
  name: 'Dub',
  description: 'Link management with Dub',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Create, manage, and track short links with Dub. Supports custom domains, UTM parameters, link analytics, and more.',
  docsLink: 'https://docs.sim.ai/tools/dub',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#181C1E',
  icon: DubIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Link', id: 'create_link' },
        { label: 'Upsert Link', id: 'upsert_link' },
        { label: 'Get Link', id: 'get_link' },
        { label: 'Update Link', id: 'update_link' },
        { label: 'Delete Link', id: 'delete_link' },
        { label: 'List Links', id: 'list_links' },
        { label: 'Get Analytics', id: 'get_analytics' },
      ],
      value: () => 'create_link',
    },
    {
      id: 'url',
      title: 'Destination URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: ['create_link', 'upsert_link'] },
      required: { field: 'operation', value: ['create_link', 'upsert_link'] },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'dub.sh (default)',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'key',
      title: 'Custom Slug',
      type: 'short-input',
      placeholder: 'my-link (randomly generated if empty)',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Custom OG title',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Custom OG description',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Your database ID for this link',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'tagIds',
      title: 'Tag IDs',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'comments',
      title: 'Comments',
      type: 'short-input',
      placeholder: 'Internal comments',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'expiresAt',
      title: 'Expires At',
      type: 'short-input',
      placeholder: 'ISO 8601 date (e.g., 2025-12-31T23:59:59Z)',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description. Return ONLY the timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the expiration (e.g., "in 30 days", "end of year")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Password to protect the link',
      password: true,
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_source',
      title: 'UTM Source',
      type: 'short-input',
      placeholder: 'e.g., twitter',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_medium',
      title: 'UTM Medium',
      type: 'short-input',
      placeholder: 'e.g., social',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_campaign',
      title: 'UTM Campaign',
      type: 'short-input',
      placeholder: 'e.g., summer-sale',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_term',
      title: 'UTM Term',
      type: 'short-input',
      placeholder: 'e.g., link-shortener',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'utm_content',
      title: 'UTM Content',
      type: 'short-input',
      placeholder: 'e.g., header-cta',
      condition: { field: 'operation', value: ['create_link', 'upsert_link', 'update_link'] },
      mode: 'advanced',
    },
    {
      id: 'linkId',
      title: 'Link ID',
      type: 'short-input',
      placeholder: 'Link ID or ext_<externalId>',
      condition: { field: 'operation', value: ['get_link', 'update_link', 'delete_link'] },
      required: { field: 'operation', value: ['update_link', 'delete_link'] },
    },
    {
      id: 'getLinkExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External ID from your database',
      condition: { field: 'operation', value: 'get_link' },
      mode: 'advanced',
    },
    {
      id: 'getLinkDomain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'dub.sh',
      condition: { field: 'operation', value: 'get_link' },
      mode: 'advanced',
    },
    {
      id: 'getLinkKey',
      title: 'Key',
      type: 'short-input',
      placeholder: 'Link slug',
      condition: { field: 'operation', value: 'get_link' },
      mode: 'advanced',
    },
    {
      id: 'updateUrl',
      title: 'New Destination URL',
      type: 'short-input',
      placeholder: 'https://example.com/new-page',
      condition: { field: 'operation', value: 'update_link' },
    },
    {
      id: 'listDomain',
      title: 'Filter by Domain',
      type: 'short-input',
      placeholder: 'dub.sh',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search links by slug or destination URL',
      condition: { field: 'operation', value: 'list_links' },
    },
    {
      id: 'listTagIds',
      title: 'Filter by Tag IDs',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'showArchived',
      title: 'Show Archived',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Created At', id: 'createdAt' },
        { label: 'Clicks', id: 'clicks' },
        { label: 'Sale Amount', id: 'saleAmount' },
        { label: 'Last Clicked', id: 'lastClicked' },
      ],
      value: () => 'createdAt',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'desc' },
        { label: 'Ascending', id: 'asc' },
      ],
      value: () => 'desc',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100 (max: 100)',
      condition: { field: 'operation', value: 'list_links' },
      mode: 'advanced',
    },
    {
      id: 'analyticsEvent',
      title: 'Event Type',
      type: 'dropdown',
      options: [
        { label: 'Clicks', id: 'clicks' },
        { label: 'Leads', id: 'leads' },
        { label: 'Sales', id: 'sales' },
        { label: 'Composite', id: 'composite' },
      ],
      value: () => 'clicks',
      condition: { field: 'operation', value: 'get_analytics' },
    },
    {
      id: 'analyticsGroupBy',
      title: 'Group By',
      type: 'dropdown',
      options: [
        { label: 'Count (total)', id: 'count' },
        { label: 'Timeseries', id: 'timeseries' },
        { label: 'Countries', id: 'countries' },
        { label: 'Cities', id: 'cities' },
        { label: 'Devices', id: 'devices' },
        { label: 'Browsers', id: 'browsers' },
        { label: 'OS', id: 'os' },
        { label: 'Referers', id: 'referers' },
        { label: 'Top Links', id: 'top_links' },
        { label: 'Top URLs', id: 'top_urls' },
      ],
      value: () => 'count',
      condition: { field: 'operation', value: 'get_analytics' },
    },
    {
      id: 'analyticsLinkId',
      title: 'Link ID',
      type: 'short-input',
      placeholder: 'Filter analytics by link ID',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'analyticsExternalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Filter by external ID (prefix with ext_)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'analyticsDomain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Filter by domain',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'analyticsInterval',
      title: 'Interval',
      type: 'dropdown',
      options: [
        { label: '24 Hours', id: '24h' },
        { label: '7 Days', id: '7d' },
        { label: '30 Days', id: '30d' },
        { label: '90 Days', id: '90d' },
        { label: '1 Year', id: '1y' },
        { label: 'Month to Date', id: 'mtd' },
        { label: 'Quarter to Date', id: 'qtd' },
        { label: 'Year to Date', id: 'ytd' },
        { label: 'All Time', id: 'all' },
      ],
      value: () => '24h',
      condition: { field: 'operation', value: 'get_analytics' },
    },
    {
      id: 'analyticsStart',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (overrides interval)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description. Return ONLY the timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the start date (e.g., "7 days ago", "start of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'analyticsEnd',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (defaults to now)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description. Return ONLY the timestamp string - no explanations, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "end of last month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'analyticsCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'ISO 3166-1 alpha-2 code (e.g., US)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'analyticsTimezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'IANA timezone (e.g., America/New_York)',
      condition: { field: 'operation', value: 'get_analytics' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Dub API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: [
      'dub_create_link',
      'dub_upsert_link',
      'dub_get_link',
      'dub_update_link',
      'dub_delete_link',
      'dub_list_links',
      'dub_get_analytics',
    ],
    config: {
      tool: (params) => `dub_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.operation === 'get_link') {
          if (params.getLinkExternalId) result.externalId = params.getLinkExternalId
          if (params.getLinkDomain) result.domain = params.getLinkDomain
          if (params.getLinkKey) result.key = params.getLinkKey
        }
        if (params.operation === 'update_link' && params.updateUrl) {
          result.url = params.updateUrl
        }
        if (params.operation === 'list_links') {
          if (params.listDomain) result.domain = params.listDomain
          if (params.listTagIds) result.tagIds = params.listTagIds
          if (params.showArchived && params.showArchived !== 'false') result.showArchived = true
          if (params.page) result.page = Number(params.page)
          if (params.pageSize) result.pageSize = Number(params.pageSize)
        }
        if (params.operation === 'get_analytics') {
          if (params.analyticsEvent) result.event = params.analyticsEvent
          if (params.analyticsGroupBy) result.groupBy = params.analyticsGroupBy
          if (params.analyticsLinkId) result.linkId = params.analyticsLinkId
          if (params.analyticsExternalId) result.externalId = params.analyticsExternalId
          if (params.analyticsDomain) result.domain = params.analyticsDomain
          if (params.analyticsInterval) result.interval = params.analyticsInterval
          if (params.analyticsStart) result.start = params.analyticsStart
          if (params.analyticsEnd) result.end = params.analyticsEnd
          if (params.analyticsCountry) result.country = params.analyticsCountry
          if (params.analyticsTimezone) result.timezone = params.analyticsTimezone
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Dub API key' },
    url: { type: 'string', description: 'Destination URL for the short link' },
    linkId: { type: 'string', description: 'Link ID for get/update/delete operations' },
    domain: { type: 'string', description: 'Custom domain for the short link' },
    key: { type: 'string', description: 'Custom slug for the short link' },
    search: { type: 'string', description: 'Search query for listing links' },
  },
  outputs: {
    id: { type: 'string', description: 'Link ID' },
    domain: { type: 'string', description: 'Domain of the short link' },
    key: { type: 'string', description: 'Slug of the short link' },
    url: { type: 'string', description: 'Destination URL' },
    shortLink: { type: 'string', description: 'Full short link URL' },
    qrCode: { type: 'string', description: 'QR code URL' },
    archived: { type: 'boolean', description: 'Whether the link is archived' },
    externalId: { type: 'string', description: 'External ID' },
    title: { type: 'string', description: 'OG title' },
    description: { type: 'string', description: 'OG description' },
    tags: { type: 'json', description: 'Tags assigned to the link (id, name, color)' },
    clicks: { type: 'number', description: 'Number of clicks' },
    leads: { type: 'number', description: 'Number of leads' },
    sales: { type: 'number', description: 'Number of sales' },
    saleAmount: { type: 'number', description: 'Total sale amount in cents' },
    lastClicked: { type: 'string', description: 'Last clicked timestamp' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    utm_source: { type: 'string', description: 'UTM source parameter' },
    utm_medium: { type: 'string', description: 'UTM medium parameter' },
    utm_campaign: { type: 'string', description: 'UTM campaign parameter' },
    utm_term: { type: 'string', description: 'UTM term parameter' },
    utm_content: { type: 'string', description: 'UTM content parameter' },
    links: {
      type: 'json',
      description: 'Array of links (id, domain, key, url, shortLink, clicks, tags, createdAt)',
    },
    count: { type: 'number', description: 'Number of links returned (list operation)' },
    data: {
      type: 'json',
      description: 'Grouped analytics data (timeseries, countries, devices, etc.)',
    },
  },
}

export const DubBlockMeta = {
  tags: ['link-management', 'marketing', 'data-analytics'],
  templates: [
    {
      icon: DubIcon,
      title: 'Dub short link factory',
      prompt:
        'Build a workflow that takes a destination URL and campaign metadata, creates a tracked short link in Dub with UTM parameters and a custom slug, stores the link in a table, and returns it to the caller for use in outreach and marketing.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: DubIcon,
      title: 'Campaign link batcher',
      prompt:
        'Create a workflow that reads a table of campaign destinations, upserts a Dub short link for each row with consistent UTM tags, writes the resulting short URL back into the table, and posts a Slack confirmation summarizing how many links were created or refreshed.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DubIcon,
      title: 'Dub analytics digest',
      prompt:
        'Build a scheduled weekly workflow that pulls Dub link analytics — clicks, leads, sales, and top referrers — for active campaigns, writes a narrative summary highlighting winners and decliners, and delivers the digest to Slack with deep links into the Dub dashboard.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DubIcon,
      title: 'Short link hygiene auditor',
      prompt:
        'Create a scheduled monthly workflow that lists all Dub links, checks each destination for 4xx and 5xx responses, flags broken links in a table, and emails the marketing team a remediation list so dead campaign links never go live.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: DubIcon,
      title: 'Outbound link personalizer',
      prompt:
        'Build a workflow that reads a leads table, generates a per-lead Dub short link with the lead identifier in UTM and metadata, attaches the personalized link to the outreach email body, and tracks delivery in the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'marketing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: DubIcon,
      title: 'Release announcement linker',
      prompt:
        'Create a workflow triggered by a GitHub release that creates a Dub short link for the release notes URL, posts the short link to the marketing Slack channel, and stores the mapping of release tag to short link in a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'devops', 'automation'],
      alsoIntegrations: ['github', 'slack'],
    },
    {
      icon: DubIcon,
      title: 'Top-converting links report',
      prompt:
        'Build a scheduled monthly workflow that pulls Dub analytics grouped by link, ranks top performers by leads and sales, identifies underperformers, writes a narrative report file with recommendations, and shares it with marketing leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis', 'reporting'],
    },
  ],
} as const satisfies BlockMeta
