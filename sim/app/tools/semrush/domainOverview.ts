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
    // No headers are needed since the API key and required parameters are in the URL.
    headers: (params: SemrushDomainOverviewParams): Record<string, string> => ({})
  },

  transformResponse: async (response: Response): Promise<SemrushDomainOverviewResponse> => {
    // Note: The Semrush API may return a CSV response by default.
    // If your response format is CSV, you might need to convert it to JSON.
    // For demonstration, we assume JSON.
    const data = await response.json();
    console.log("Domain Overview response:", data);
    return {
      success: true,
      output: data
    };
  },

  transformError: async (error) => {
    console.error("=== domainOverviewTool transformError called ===");
    if (error.response) {
      console.error("HTTP Status:", error.response.status);
      try {
        const errorText = await error.response.text();
        console.error("Error Response Text:", errorText);
        return errorText || error.message || 'An error occurred while retrieving the domain overview';
      } catch (readErr) {
        console.error("Error reading error response:", readErr);
      }
    }
    console.error("Full error object:", error);
    return error.message || 'An error occurred while retrieving the domain overview';
  }
}