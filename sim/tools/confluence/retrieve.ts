import { ToolConfig, ToolResponse } from '../types'

export interface ConfluenceRetrieveParams {
  apiKey: string
  pageId: string
  domain: string 
  email: string
}

export interface ConfluenceRetrieveResponse extends ToolResponse {
  output: {
    ts: string
    pageId: string
    content: string
    title: string
  }
}

export const confluenceRetrieveTool: ToolConfig<ConfluenceRetrieveParams, ConfluenceRetrieveResponse> = {
  id: 'confluence_retrieve',
  name: 'Confluence Retrieve',
  description: 'Retrieve content from Confluence pages using the Confluence API.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Confluence API token',
    },
    domain: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    email: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'Your Atlassian email address',
    },
    pageId: {
      type: 'string',
      required: true,
      description: 'Confluence page ID to retrieve',
    }
  },

  request: {
    url: (params: ConfluenceRetrieveParams) => {
      return `https://${params.domain}/wiki/rest/api/content/${params.pageId}?expand=body.view`;
    },
    method: 'GET',
    headers: (params: ConfluenceRetrieveParams) => {
      return {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${params.email}:${params.apiKey}`).toString('base64')}`,
      };
    }
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.message || 'Confluence API error')
    }
    
    const cleanContent = data.body.view.value
      .replace(/<[^>]*>/g, '') 
      .replace(/&nbsp;/g, ' ') 
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ') 
      .trim();

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        pageId: data.id,
        content: cleanContent,
        title: data.title,
      }
    }
  },

  transformError: (error: any) => {
    const message = error.message || 'Confluence retrieve failed'
    return message
  }
}
