import { ToolConfig } from '../types'
import { SemrushDomainOverviewParams, SemrushDomainOverviewResponse } from './types'

export const domainOverviewTool: ToolConfig<SemrushDomainOverviewParams, SemrushDomainOverviewResponse> = {
  id: 'semrush_domain_overview',
  name: 'Semrush Domain Overview',
  description: 'Retrieve live or historical SEO data for a domain from Semrush.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      description: 'Semrush API key'
    },
    domain: {
      type: 'string',
      required: true,
      description: 'The domain to analyze (e.g., example.com)'
    },
    database: {
      type: 'string',
      required: false,
      description: 'Optional regional database (e.g., us). If omitted, data for all databases is returned.'
    },
  },

  request: {
    url: (params: SemrushDomainOverviewParams) => {
      let url = `https://api.semrush.com/?key=${encodeURIComponent(params.apiKey)}&type=domain_ranks&export_columns=Db,Dn,Rk,Or,Ot,Oc,Ad,At,Ac,Sh,Sv&domain=${encodeURIComponent(params.domain)}`;
      if (params.database) {
        url += `&database=${encodeURIComponent(params.database)}`;
      }
      return url;
    },
    method: 'GET',
    headers: (params: SemrushDomainOverviewParams): Record<string, string> => ({})
  },

  transformResponse: async (response: Response): Promise<SemrushDomainOverviewResponse> => {
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    return {
      success: true,
      output: data
    };
  },

  transformError: (error) => `Domain overview fetching failed: ${error.message}`
}