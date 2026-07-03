import type { UsageLogSource } from '@/lib/api/contracts/user'

/**
 * Humanized labels for `usage_log.source`, shared by the Credit usage page's
 * row rendering and the CSV export so both read identically. Avoids the
 * internal "copilot" / "mothership" naming — the agent is always "Sim", the
 * surface is "Chat". Pure data, no server-only imports, so it's safe from
 * both the client page and the export route.
 */
export const USAGE_LOG_SOURCE_LABELS: Record<UsageLogSource, string> = {
  workflow: 'Workflow',
  wand: 'Wand',
  copilot: 'Chat',
  'workspace-chat': 'Chat',
  mcp_copilot: 'Chat (MCP)',
  mothership_block: 'Agent block',
  'knowledge-base': 'Knowledge Base',
  'voice-input': 'Voice input',
  enrichment: 'Enrichment',
}
