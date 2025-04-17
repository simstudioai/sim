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
<<<<<<< HEAD
    const data = await response.json();
    console.log("Domain Keywords response:", data);
=======
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    const data = await response.json();
>>>>>>> bdd0ab88cdcd053991e20edd0f509fa4f5f75110
    return { 
      success: true,
      output: data
    };
  },

<<<<<<< HEAD
  transformError: async (error) => {
    console.error("=== domainKeywordsTool transformError called ===");
    if (error.response) {
      try {
        const errorText = await error.response.text();
        console.error("Error Response Text:", errorText);
        return errorText || error.message || 'An error occurred while retrieving domain keywords';
      } catch (readErr) {
        console.error("Error reading error response:", readErr);
      }
    }
    return error.message || 'An error occurred while retrieving domain keywords';
  }
=======
  transformError: (error) => `Domain keywords fetching failed: ${error.message}`
>>>>>>> bdd0ab88cdcd053991e20edd0f509fa4f5f75110
}