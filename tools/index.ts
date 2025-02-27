import { visionTool as crewAIVision } from './crewai/vision'
import { scrapeTool } from './firecrawl/scrape'
import { functionExecuteTool as functionExecute } from './function/execute'
import { commentTool } from './github/comment'
import { prTool } from './github/pr'
import { repoInfoTool } from './github/repo'
import { gmailReadTool } from './gmail/read'
import { gmailSearchTool } from './gmail/search'
import { gmailSendTool } from './gmail/send'
import { requestTool as httpRequest } from './http/request'
import { contactsTool as hubspotContacts } from './hubspot/contacts'
import { readUrlTool } from './jina/reader'
import { notionReadTool } from './notion/read'
import { notionWriteTool } from './notion/write'
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
import { executeRequest, formatRequestParams, validateToolRequest } from './utils'
import { readTool as xRead } from './x/read'
import { searchTool as xSearch } from './x/search'
import { userTool as xUser } from './x/user'
import { writeTool as xWrite } from './x/write'
import { youtubeSearchTool } from './youtube/search'

// Registry of all available tools
export const tools: Record<string, ToolConfig> = {
  openai_embeddings: openAIEmbeddings,
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
  params: Record<string, any>,
  skipProxy = false
): Promise<ToolResponse> {
  try {
    const tool = getTool(toolId)
    console.log(`Tool being called: ${toolId}`, {
      params: { ...params, apiKey: params.apiKey ? '[REDACTED]' : undefined },
      skipProxy,
    })

    // Validate the tool and its parameters
    validateToolRequest(toolId, tool, params)

    // After validation, we know tool exists
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    // For internal routes or when skipProxy is true, call the API directly
    if (tool.request.isInternalRoute || skipProxy) {
      console.log(`Calling internal request for ${toolId}`)
      const result = await handleInternalRequest(toolId, tool, params)
      console.log(`Tool ${toolId} execution result:`, {
        success: result.success,
        outputKeys: result.success ? Object.keys(result.output) : [],
        error: result.error,
      })
      return result
    }

    // For external APIs, use the proxy
    console.log(`Calling proxy request for ${toolId}`)
    return await handleProxyRequest(toolId, params)
  } catch (error: any) {
    console.error(`Error executing tool ${toolId}:`, error)
    return {
      success: false,
      output: {},
      error: error.message || 'Unknown error',
    }
  }
}

/**
 * Handle an internal/direct tool request
 */
async function handleInternalRequest(
  toolId: string,
  tool: ToolConfig,
  params: Record<string, any>
): Promise<ToolResponse> {
  // Log the request for debugging
  console.log(`Executing tool ${toolId} with params:`, {
    toolId,
    params: { ...params, apiKey: params.apiKey ? '[REDACTED]' : undefined },
  })

  // Format the request parameters
  const requestParams = formatRequestParams(tool, params)

  // Execute the request
  return await executeRequest(toolId, tool, requestParams)
}

/**
 * Handle a request via the proxy
 */
async function handleProxyRequest(
  toolId: string,
  params: Record<string, any>
): Promise<ToolResponse> {
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
}
