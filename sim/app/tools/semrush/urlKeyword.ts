// /sim/tools/semrush/urlKeywords.ts
import { ToolConfig } from '../types'
import { SemrushUrlKeywordsParams, SemrushUrlKeywordsResponse } from './types'

export const urlKeywordsTool: ToolConfig<SemrushUrlKeywordsParams, SemrushUrlKeywordsResponse> = {
  id: 'semrush_url_keywords',
  name: 'Semrush URL Keywords',
  description: 'Fetch keyword data associated with a specific URL via Semrush',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      description: 'Semrush API key'
    },
    url: {
      type: 'string',
      required: true,
      description: 'The URL to analyze for keyword data'
    },
    database: {
      type: 'string',
      required: false,
      description: 'Optional regional database'
    },
  },

  request: {
    url: (params: SemrushUrlKeywordsParams) => {
      let urlStr = `https://api.semrush.com/?key=${encodeURIComponent(params.apiKey)}&type=url_organic&export_columns=Ph,Po,Nq,Cp,Co,Nr&url=${encodeURIComponent(params.url)}`;
      if (params.database) {
        urlStr += `&database=${encodeURIComponent(params.database)}`;
      }
      return urlStr;
    },
    method: 'GET',
    headers: (): Record<string, string> => ({})
  },

  transformResponse: async (response: Response): Promise<SemrushUrlKeywordsResponse> => {
    const data = await response.json();
    console.log("URL Keywords response:", data);
    return {
      success: true,
      output: data
    };
  },

  transformError: async (error) => {
    console.error("=== urlKeywordsTool transformError called ===");
    if (error.response) {
      try {
        const errorText = await error.response.text();
        console.error("Error Response Text:", errorText);
        return errorText || error.message || 'An error occurred while retrieving URL keywords';
      } catch (readErr) {
        console.error("Error reading error response:", readErr);
      }
    }
    return error.message || 'An error occurred while retrieving URL keywords';
  }
}