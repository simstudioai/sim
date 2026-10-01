/** Fixed providers and read operations available to live Search; models never select MCP tools. */
export const MANAGED_SEARCH_MCP_READ_TOOLS = {
  coda: ['search', 'url_convert', 'content_read', 'document_outline', 'table_rows_read'],
  fireflies: ['fireflies_get_transcripts', 'fireflies_get_transcript', 'fireflies_get_summary'],
  granola: ['query_granola_meetings', 'list_meetings', 'get_meetings', 'get_meeting_transcript'],
  hubspot: ['get_user_details', 'search_crm_objects', 'get_crm_objects'],
  lucid: ['search', 'fetch', 'lucid_search_document', 'lucid_get_document_metadata'],
  notion: ['notion-get-tool-access', 'notion-search', 'notion-ai-search', 'notion-fetch'],
  zoom: ['search_meetings', 'get_meeting_assets'],
} as const

export type ManagedSearchMcpProvider = keyof typeof MANAGED_SEARCH_MCP_READ_TOOLS

export function isManagedSearchMcpProvider(value: string): value is ManagedSearchMcpProvider {
  return Object.hasOwn(MANAGED_SEARCH_MCP_READ_TOOLS, value)
}
