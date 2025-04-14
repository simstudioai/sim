// /sim/tools/semrush/keywordOverview.ts
import { ToolConfig } from '../types'
import { SemrushKeywordOverviewParams, SemrushKeywordOverviewResponse } from './types'

export const keywordOverviewTool: ToolConfig<SemrushKeywordOverviewParams, SemrushKeywordOverviewResponse> = {
  id: 'semrush_keyword_overview',
  name: 'Semrush Keyword Overview',
  description: 'Access SEO metrics for a specific keyword via Semrush',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      description: 'Semrush API key'
    },
    keyword: {
      type: 'string',
      required: true,
      description: 'The keyword to analyze'
    },
    database: {
      type: 'string',
      required: false,
      description: 'Optional regional database'
    },
  },

  request: {
    url: (params: SemrushKeywordOverviewParams) => {
      let url = `https://api.semrush.com/?key=${encodeURIComponent(params.apiKey)}&type=phrase_this&export_columns=Ph,Po,Nq,Cp,Co,Nr&phrase=${encodeURIComponent(params.keyword)}`;
      if (params.database) {
        url += `&database=${encodeURIComponent(params.database)}`;
      }
      return url;
    },
    method: 'GET',
    headers: (): Record<string, string> => ({})
  },

  transformResponse: async (response: Response): Promise<SemrushKeywordOverviewResponse> => {
    const data = await response.json();
    console.log("Keyword Overview response:", data);
    return {
      success: true,
      output: data
    };
  },

  transformError: async (error) => {
    console.error("=== keywordOverviewTool transformError called ===");
    if (error.response) {
      try {
        const errorText = await error.response.text();
        console.error("Error Response Text:", errorText);
        return errorText || error.message || 'An error occurred while retrieving keyword overview';
      } catch (readErr) {
        console.error("Error reading error response:", readErr);
      }
    }
    return error.message || 'An error occurred while retrieving keyword overview';
  }
}