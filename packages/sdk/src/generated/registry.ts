/**
 * This file is auto-generated. Do not edit directly.
 * Generated at 2025-03-18T23:55:40.504Z
 */

/**
 * List of all available tools in the main application
 */
export const availableTools = [
  "openai_embeddings",
  "http_request",
  "hubspot_contacts",
  "salesforce_opportunities",
  "function_execute",
  "webcontainer_execute",
  "vision_tool",
  "firecrawl_scrape",
  "jina_readurl",
  "slack_message",
  "github_repoinfo",
  "serper_search",
  "tavily_search",
  "tavily_extract",
  "supabase_query",
  "supabase_insert",
  "supabase_update",
  "youtube_search",
  "notion_read",
  "notion_write",
  "gmail_send",
  "gmail_read",
  "gmail_search",
  "whatsapp_send_message",
  "x_write",
  "x_read",
  "x_search",
  "x_user",
  "pinecone_fetch",
  "pinecone_generate_embeddings",
  "pinecone_search_text",
  "pinecone_search_vector",
  "pinecone_upsert_text",
  "github_pr",
  "github_comment",
  "exa_search",
  "exa_get_contents",
  "exa_find_similar_links",
  "exa_answer",
  "reddit_hot_posts",
  "google_drive_download",
  "google_drive_list",
  "google_drive_upload",
  "google_docs_read",
  "google_docs_write",
  "google_docs_create",
  "google_sheets_read",
  "google_sheets_write",
  "google_sheets_update",
  "guesty_reservation",
  "guesty_guest"
]

/**
 * List of all available blocks in the main application
 */
export const availableBlocks = [
  "agent",
  "api",
  "condition",
  "evaluator",
  "exa",
  "firecrawl",
  "function",
  "github",
  "gmail",
  "google_docs",
  "google_drive",
  "google_sheets",
  "jina",
  "notion",
  "openai",
  "pinecone",
  "reddit",
  "router",
  "serper",
  "slack",
  "starter",
  "supabase",
  "tavily",
  "translate",
  "vision",
  "whatsapp",
  "x",
  "youtube"
]

/**
 * Map of tool IDs to their block types
 */
export const toolToBlockMap: Record<string, string> = {
    'openai_embeddings': 'OpenaiEmbeddingsBlock',
  'http_request': 'HttpRequestBlock',
  'hubspot_contacts': 'HubspotContactsBlock',
  'salesforce_opportunities': 'SalesforceOpportunitiesBlock',
  'function_execute': 'FunctionExecuteBlock',
  'webcontainer_execute': 'WebcontainerExecuteBlock',
  'vision_tool': 'VisionToolBlock',
  'firecrawl_scrape': 'FirecrawlScrapeBlock',
  'jina_readurl': 'JinaReadurlBlock',
  'slack_message': 'SlackMessageBlock',
  'github_repoinfo': 'GithubRepoinfoBlock',
  'serper_search': 'SerperSearchBlock',
  'tavily_search': 'TavilySearchBlock',
  'tavily_extract': 'TavilyExtractBlock',
  'supabase_query': 'SupabaseQueryBlock',
  'supabase_insert': 'SupabaseInsertBlock',
  'supabase_update': 'SupabaseUpdateBlock',
  'youtube_search': 'YoutubeSearchBlock',
  'notion_read': 'NotionReadBlock',
  'notion_write': 'NotionWriteBlock',
  'gmail_send': 'GmailSendBlock',
  'gmail_read': 'GmailReadBlock',
  'gmail_search': 'GmailSearchBlock',
  'whatsapp_send_message': 'WhatsappSendMessageBlock',
  'x_write': 'XWriteBlock',
  'x_read': 'XReadBlock',
  'x_search': 'XSearchBlock',
  'x_user': 'XUserBlock',
  'pinecone_fetch': 'PineconeFetchBlock',
  'pinecone_generate_embeddings': 'PineconeGenerateEmbeddingsBlock',
  'pinecone_search_text': 'PineconeSearchTextBlock',
  'pinecone_search_vector': 'PineconeSearchVectorBlock',
  'pinecone_upsert_text': 'PineconeUpsertTextBlock',
  'github_pr': 'GithubPrBlock',
  'github_comment': 'GithubCommentBlock',
  'exa_search': 'ExaSearchBlock',
  'exa_get_contents': 'ExaGetContentsBlock',
  'exa_find_similar_links': 'ExaFindSimilarLinksBlock',
  'exa_answer': 'ExaAnswerBlock',
  'reddit_hot_posts': 'RedditHotPostsBlock',
  'google_drive_download': 'GoogleDriveDownloadBlock',
  'google_drive_list': 'GoogleDriveListBlock',
  'google_drive_upload': 'GoogleDriveUploadBlock',
  'google_docs_read': 'GoogleDocsReadBlock',
  'google_docs_write': 'GoogleDocsWriteBlock',
  'google_docs_create': 'GoogleDocsCreateBlock',
  'google_sheets_read': 'GoogleSheetsReadBlock',
  'google_sheets_write': 'GoogleSheetsWriteBlock',
  'google_sheets_update': 'GoogleSheetsUpdateBlock',
  'guesty_reservation': 'GuestyReservationBlock',
  'guesty_guest': 'GuestyGuestBlock'
}

/**
 * Required parameters for each tool
 */
export const toolRequiredParameters: Record<string, string[]> = {
    'openai_embeddings': [],
  'http_request': [],
  'hubspot_contacts': ["apiKey"],
  'salesforce_opportunities': ["apiKey"],
  'function_execute': [],
  'webcontainer_execute': [],
  'vision_tool': ["apiKey"],
  'firecrawl_scrape': ["apiKey"],
  'jina_readurl': ["apiKey"],
  'slack_message': ["apiKey"],
  'github_repoinfo': ["apiKey"],
  'serper_search': ["apiKey"],
  'tavily_search': ["apiKey"],
  'tavily_extract': ["apiKey"],
  'supabase_query': [],
  'supabase_insert': [],
  'supabase_update': [],
  'youtube_search': ["apiKey"],
  'notion_read': ["pageId","apiKey"],
  'notion_write': ["pageId","apiKey"],
  'gmail_send': [],
  'gmail_read': [],
  'gmail_search': [],
  'whatsapp_send_message': [],
  'x_write': ["apiKey"],
  'x_read': ["apiKey","tweetId"],
  'x_search': ["apiKey"],
  'x_user': ["apiKey"],
  'pinecone_fetch': ["apiKey","indexHost","ids"],
  'pinecone_generate_embeddings': ["apiKey"],
  'pinecone_search_text': ["apiKey","indexHost"],
  'pinecone_search_vector': ["apiKey","indexHost"],
  'pinecone_upsert_text': ["apiKey","indexHost"],
  'github_pr': ["apiKey"],
  'github_comment': ["apiKey"],
  'exa_search': ["apiKey"],
  'exa_get_contents': ["apiKey"],
  'exa_find_similar_links': ["apiKey"],
  'exa_answer': ["apiKey"],
  'reddit_hot_posts': [],
  'google_drive_download': [],
  'google_drive_list': [],
  'google_drive_upload': [],
  'google_docs_read': [],
  'google_docs_write': [],
  'google_docs_create': [],
  'google_sheets_read': [],
  'google_sheets_write': [],
  'google_sheets_update': [],
  'guesty_reservation': ["apiKey"],
  'guesty_guest': ["apiKey"]
}

/**
 * Required parameters for each block
 */
export const blockRequiredParameters: Record<string, string[]> = {
    'agent': ["model","apiKey"],
  'api': ["url","method"],
  'condition': [],
  'evaluator': ["metrics","model","apiKey","content"],
  'exa': ["operation","apiKey"],
  'firecrawl': ["apiKey","url"],
  'function': [],
  'github': ["operation","owner","repo","apiKey"],
  'gmail': ["operation","credential"],
  'google_docs': ["operation","credential"],
  'google_drive': ["operation","credential"],
  'google_sheets': ["operation","credential"],
  'jina': ["url","apiKey"],
  'notion': ["pageId","operation","apiKey"],
  'openai': ["input","apiKey"],
  'pinecone': ["operation","apiKey"],
  'reddit': ["subreddit"],
  'router': ["prompt","model","apiKey"],
  'serper': ["query","apiKey"],
  'slack': ["apiKey","channel","text"],
  'starter': [],
  'supabase': ["operation","credential","projectId","table"],
  'tavily': ["operation","apiKey"],
  'translate': ["context","targetLanguage","apiKey","systemPrompt"],
  'vision': ["apiKey","imageUrl"],
  'whatsapp': ["phoneNumber","message","phoneNumberId","accessToken"],
  'x': ["operation","apiKey"],
  'youtube': ["apiKey","query"]
}

/**
 * Check if a tool is available
 */
export function isToolAvailable(toolId: string): boolean {
  return availableTools.includes(toolId)
}

/**
 * Check if a block is available
 */
export function isBlockAvailable(blockId: string): boolean {
  return availableBlocks.includes(blockId)
}

/**
 * Get the block type for a tool
 */
export function getBlockTypeForTool(toolId: string): string | undefined {
  return toolToBlockMap[toolId]
}

/**
 * Get required parameters for a tool
 */
export function getToolRequiredParameters(toolId: string): string[] {
  return toolRequiredParameters[toolId] || []
}

/**
 * Get required parameters for a block
 */
export function getBlockRequiredParameters(blockId: string): string[] {
  return blockRequiredParameters[blockId] || []
}
