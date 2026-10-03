import type {
  SemrushBacklinksOverviewParams,
  SemrushBacklinksOverviewResponse,
  SemrushBacklinksOverviewRow,
} from '@/tools/semrush/types'
import { buildSemrushUrl, readSemrushReport, SEMRUSH_BACKLINKS_URL } from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = [
  'ascore',
  'total',
  'domains_num',
  'urls_num',
  'ips_num',
  'ipclassc_num',
  'follows_num',
  'nofollows_num',
  'sponsored_num',
  'ugc_num',
  'texts_num',
  'images_num',
  'forms_num',
  'frames_num',
] as const

export const semrushBacklinksOverviewTool: ToolConfig<
  SemrushBacklinksOverviewParams,
  SemrushBacklinksOverviewResponse
> = {
  id: 'semrush_backlinks_overview',
  name: 'Semrush Backlinks Overview',
  description:
    'Get the Authority Score and backlink profile totals for a domain, subdomain, or URL.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Semrush API key',
    },
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Root domain, subdomain, or URL to analyze',
    },
    targetType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Scope of the target: root_domain, domain, or url. Defaults to root_domain',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_BACKLINKS_URL, {
        apiKey: params.apiKey,
        type: 'backlinks_overview',
        columnCodes: COLUMNS,
        extra: {
          target: params.target,
          target_type: params.targetType || 'root_domain',
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushBacklinksOverviewRow>(response, COLUMNS)

    return {
      success: true,
      output: { overview: rows[0] ?? null },
    }
  },

  outputs: {
    overview: {
      type: 'json',
      description: 'Backlink profile totals for the target',
      nullable: true,
      properties: {
        authorityScore: {
          type: 'number',
          description: 'Semrush Authority Score (0-100)',
          optional: true,
          nullable: true,
        },
        total: {
          type: 'number',
          description: 'Total number of backlinks',
          optional: true,
          nullable: true,
        },
        domainsNum: {
          type: 'number',
          description: 'Number of referring domains',
          optional: true,
          nullable: true,
        },
        urlsNum: {
          type: 'number',
          description: 'Number of referring URLs',
          optional: true,
          nullable: true,
        },
        ipsNum: {
          type: 'number',
          description: 'Number of referring IPs',
          optional: true,
          nullable: true,
        },
        ipClassCNum: {
          type: 'number',
          description: 'Number of referring class C subnets',
          optional: true,
          nullable: true,
        },
        followsNum: {
          type: 'number',
          description: 'Number of followed backlinks',
          optional: true,
          nullable: true,
        },
        nofollowsNum: {
          type: 'number',
          description: 'Number of nofollow backlinks',
          optional: true,
          nullable: true,
        },
        sponsoredNum: {
          type: 'number',
          description: 'Number of backlinks marked rel="sponsored"',
          optional: true,
          nullable: true,
        },
        ugcNum: {
          type: 'number',
          description: 'Number of backlinks marked rel="ugc"',
          optional: true,
          nullable: true,
        },
        textsNum: {
          type: 'number',
          description: 'Number of text backlinks',
          optional: true,
          nullable: true,
        },
        imagesNum: {
          type: 'number',
          description: 'Number of image backlinks',
          optional: true,
          nullable: true,
        },
        formsNum: {
          type: 'number',
          description: 'Number of form backlinks',
          optional: true,
          nullable: true,
        },
        framesNum: {
          type: 'number',
          description: 'Number of frame backlinks',
          optional: true,
          nullable: true,
        },
      },
    },
  },
}
