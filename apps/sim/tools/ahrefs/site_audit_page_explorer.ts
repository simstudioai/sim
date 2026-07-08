import type {
  AhrefsSiteAuditPageExplorerParams,
  AhrefsSiteAuditPageExplorerResponse,
} from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS =
  'url,http_code,title,internal_links,external_links,backlinks,compliant,traffic'

export const siteAuditPageExplorerTool: ToolConfig<
  AhrefsSiteAuditPageExplorerParams,
  AhrefsSiteAuditPageExplorerResponse
> = {
  id: 'ahrefs_site_audit_page_explorer',
  name: 'Ahrefs Site Audit Page Explorer',
  description:
    'Get crawled pages from an Ahrefs Site Audit project with health and SEO metrics: HTTP status, title, link counts, backlinks, indexability, and traffic. Optionally filter to pages affected by a specific issue.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Site Audit project ID (found in the project URL in Ahrefs)',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Crawl date in YYYY-MM-DDThh:mm:ss format (defaults to the most recent crawl)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return. Example: 50 (default: 1000)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip, for pagination',
    },
    issueId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return pages affected by this issue ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ahrefs API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.ahrefs.com/v3/site-audit/page-explorer')
      url.searchParams.set('project_id', String(params.projectId))
      url.searchParams.set('select', SELECT_FIELDS)
      if (params.date) url.searchParams.set('date', params.date)
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.offset) url.searchParams.set('offset', String(params.offset))
      if (params.issueId) url.searchParams.set('issue_id', params.issueId)
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
      throw new Error(data.error?.message || data.error || 'Failed to get site audit pages')
    }

    const auditPages = (data.pages || []).map((page: any) => ({
      url: page.url || '',
      httpCode: page.http_code ?? null,
      title: page.title ?? [],
      internalLinks: (page.internal_links || []).length,
      externalLinks: (page.external_links || []).length,
      backlinks: page.backlinks ?? null,
      compliant: page.compliant ?? null,
      traffic: page.traffic ?? null,
    }))

    return {
      success: true,
      output: {
        auditPages,
      },
    }
  },

  outputs: {
    auditPages: {
      type: 'array',
      description: 'List of crawled pages with health and SEO metrics',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The crawled page URL' },
          httpCode: {
            type: 'number',
            description: 'HTTP status code returned by the URL',
            optional: true,
          },
          title: {
            type: 'array',
            description: 'Page title tag(s)',
            items: { type: 'string' },
          },
          internalLinks: { type: 'number', description: 'Number of internal outgoing links' },
          externalLinks: { type: 'number', description: 'Number of external outgoing links' },
          backlinks: {
            type: 'number',
            description: 'Number of incoming external links to the page',
            optional: true,
          },
          compliant: {
            type: 'boolean',
            description: 'Whether the page is indexable (200 status, no canonical/noindex)',
            optional: true,
          },
          traffic: {
            type: 'number',
            description: 'Estimated monthly organic traffic to the page',
            optional: true,
          },
        },
      },
    },
  },
}
