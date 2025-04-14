// /sim/tools/semrush/domainKeywords.ts
import { ToolConfig } from '../types'
import { SemrushDomainKeywordsParams, SemrushDomainKeywordsResponse } from './types'

export const domainKeywordsTool: ToolConfig<SemrushDomainKeywordsParams, SemrushDomainKeywordsResponse> = {
  id: 'semrush_domain_keywords',
  name: 'Semrush Domain Keywords',
  description: 'Get keyword data for a domain via Semrush',
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
      description: 'Domain to retrieve keyword data for'
    },
    database: {
      type: 'string',
      required: false,
      description: 'Optional regional database'
    }
  },

  request: {
    url: (params: SemrushDomainKeywordsParams) => {
      let url = `https://api.semrush.com/?key=${encodeURIComponent(params.apiKey)}&type=domain_organic&export_columns=Ph,Po,Nq,Cp,Co,Nr&domain=${encodeURIComponent(params.domain)}`;
      if (params.database) {
        url += `&database=${encodeURIComponent(params.database)}`;
      }
      return url;
    },
    method: 'GET',
    headers: (): Record<string, string> => ({})
  },

  transformResponse: async (response: Response): Promise<SemrushDomainKeywordsResponse> => {
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

  transformError: (error) => `Domain keywords fetching failed: ${error.message}`
}