import { chatTool as anthropicChat } from './anthropic/chat'
import { visionTool as crewAIVision } from './crewai/vision'
import { chatTool as deepseekChat } from './deepseek/chat'
import { reasonerTool as deepseekReasoner } from './deepseek/reasoner'
import { scrapeTool } from './firecrawl/scrape'
import { functionExecuteTool as functionExecute } from './function/execute'
import { commentTool } from './github/comment'
import { prTool } from './github/pr'
import { repoInfoTool } from './github/repo'
import { gmailReadTool } from './gmail/read'
import { gmailSearchTool } from './gmail/search'
import { gmailSendTool } from './gmail/send'
import { chatTool as googleChat } from './google/chat'
import { requestTool as httpRequest } from './http/request'
import { contactsTool as hubspotContacts } from './hubspot/contacts'
import { readUrlTool } from './jina/reader'
import { notionReadTool } from './notion/read'
import { notionWriteTool } from './notion/write'
import { chatTool as openAIChat } from './openai/chat'
import { embeddingsTool as openAIEmbeddings } from './openai/embeddings'
import { fetchTool as pineconeFetchTool } from './pinecone/fetch'
import { generateEmbeddingsTool as pineconeGenerateEmbeddingsTool } from './pinecone/generate'
import { searchTextTool as pineconeSearchTextTool } from './pinecone/searchText'
import { searchVectorTool as pineconeSearchVectorTool } from './pinecone/searchVector'
import { upsertTextTool as pineconeUpsertTextTool } from './pinecone/upsertText'
import { opportunitiesTool as salesforceOpportunities } from './salesforce/opportunities'
import { searchTool as serperSearch } from './serper/search'
import { slackMessageTool } from './slack/message'
import { extractTool as tavilyExtract } from './tavily/extract'
import { searchTool as tavilySearch } from './tavily/search'
import { ToolConfig, ToolResponse } from './types'
import { readTool as xRead } from './x/read'
import { searchTool as xSearch } from './x/search'
import { userTool as xUser } from './x/user'
import { writeTool as xWrite } from './x/write'
import { chatTool as xaiChat } from './xai/chat'
import { youtubeSearchTool } from './youtube/search'

// Registry of all available tools
export const tools: Record<string, ToolConfig> = {
  openai_chat: openAIChat,
  openai_embeddings: openAIEmbeddings,
  anthropic_chat: anthropicChat,
  google_chat: googleChat,
  xai_chat: xaiChat,
  deepseek_chat: deepseekChat,
  deepseek_reasoner: deepseekReasoner,
  http_request: httpRequest,
  hubspot_contacts: hubspotContacts,
  salesforce_opportunities: salesforceOpportunities,
  function_execute: functionExecute,
  crewai_vision: crewAIVision,
  firecrawl_scrape: scrapeTool,
  jina_readurl: readUrlTool,
  slack_message: slackMessageTool,
  github_repoinfo: repoInfoTool,
  serper_search: serperSearch,
  tavily_search: tavilySearch,
  tavily_extract: tavilyExtract,
  youtube_search: youtubeSearchTool,
  notion_read: notionReadTool,
  notion_write: notionWriteTool,
  gmail_send: gmailSendTool,
  gmail_read: gmailReadTool,
  gmail_search: gmailSearchTool,
  x_write: xWrite,
  x_read: xRead,
  x_search: xSearch,
  x_user: xUser,
  pinecone_fetch: pineconeFetchTool,
  pinecone_generate_embeddings: pineconeGenerateEmbeddingsTool,
  pinecone_search_text: pineconeSearchTextTool,
  pinecone_search_vector: pineconeSearchVectorTool,
  pinecone_upsert_text: pineconeUpsertTextTool,
  github_pr: prTool,
  github_comment: commentTool,
}

// Get a tool by its ID
export function getTool(toolId: string): ToolConfig | undefined {
  return tools[toolId]
}

// Execute a tool by calling either the proxy for external APIs or directly for internal routes
export async function executeTool(
  toolId: string,
  params: Record<string, any>
): Promise<ToolResponse> {
  try {
    const tool = getTool(toolId)
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    // For internal routes, call the API directly
    if (tool.request.isInternalRoute) {
      const url =
        typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

      const response = await fetch(url, {
        method: tool.request.method,
        headers: tool.request.headers(params),
        body: JSON.stringify(tool.request.body ? tool.request.body(params) : params),
      })

      const result = await tool.transformResponse(response)
      return result
    }

    // For external APIs, use the proxy
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!baseUrl) {
      throw new Error('NEXT_PUBLIC_APP_URL environment variable is not set')
    }

    const proxyUrl = new URL('/api/proxy', baseUrl).toString()
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, params }),
    })

    const result = await response.json()

    if (!result.success) {
      return {
        success: false,
        output: {},
        error: result.error,
      }
    }

    return result
  } catch (error: any) {
    return {
      success: false,
      output: {},
      error: error.message || 'Unknown error',
    }
  }
}
