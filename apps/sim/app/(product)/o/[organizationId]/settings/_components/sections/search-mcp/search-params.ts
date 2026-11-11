import { parseAsStringLiteral } from 'nuqs/server'

/** The apps Search MCP has setup instructions for, in the order the picker lists them. */
const SEARCH_MCP_CLIENTS = ['claude', 'codex', 'claude-code', 'cursor', 'devin', 'other'] as const

/** The app whose setup the page shows, so a link can open straight to Cursor's instructions. */
export const searchMcpParsers = {
  client: parseAsStringLiteral(SEARCH_MCP_CLIENTS).withDefault('claude'),
}

export const searchMcpUrlKeys = { history: 'replace', clearOnDefault: true } as const
