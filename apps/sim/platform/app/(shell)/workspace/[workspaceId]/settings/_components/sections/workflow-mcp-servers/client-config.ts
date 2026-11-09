/** The MCP clients a workflow MCP server has connection instructions for. */
export const MCP_CLIENTS = [
  { value: 'cursor', label: 'Cursor' },
  { value: 'codex', label: 'Codex' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'claude-desktop', label: 'Claude Desktop' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'sim', label: 'Sim' },
] as const

export type McpClient = (typeof MCP_CLIENTS)[number]['value']

function configName(serverName: string): string {
  return serverName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

/** What a client needs to connect: a command, a TOML block or a JSON config. Sim needs none. */
export function getConfigSnippet(
  client: McpClient,
  serverUrl: string,
  isPublic: boolean,
  serverName: string
): string {
  const name = configName(serverName)
  if (client === 'sim') return ''
  if (client === 'claude-code') {
    return isPublic
      ? `claude mcp add "${name}" --url "${serverUrl}"`
      : `claude mcp add "${name}" --url "${serverUrl}" --header "X-API-Key:$SIM_API_KEY"`
  }
  if (client === 'codex') {
    return [
      `[mcp_servers."${name}"]`,
      `url = "${serverUrl}"`,
      ...(isPublic ? [] : ['env_http_headers = { "X-API-Key" = "SIM_API_KEY" }']),
    ].join('\n')
  }
  if (client === 'cursor') {
    const config = isPublic
      ? { url: serverUrl }
      : { url: serverUrl, headers: { 'X-API-Key': '$SIM_API_KEY' } }
    return JSON.stringify({ mcpServers: { [name]: config } }, null, 2)
  }
  const server = {
    command: 'npx',
    args: isPublic
      ? ['-y', 'mcp-remote', serverUrl]
      : ['-y', 'mcp-remote', serverUrl, '--header', 'X-API-Key:$SIM_API_KEY'],
  }
  if (client === 'vscode') {
    return JSON.stringify({ servers: { [name]: { type: 'stdio', ...server } } }, null, 2)
  }
  return JSON.stringify({ mcpServers: { [name]: server } }, null, 2)
}

/** Cursor's one-click install link for the server. */
export function getCursorInstallUrl(serverUrl: string, isPublic: boolean, serverName: string) {
  const config = isPublic
    ? { url: serverUrl }
    : { url: serverUrl, headers: { 'X-API-Key': '$SIM_API_KEY' } }
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(configName(serverName))}&config=${encodeURIComponent(btoa(JSON.stringify(config)))}`
}
