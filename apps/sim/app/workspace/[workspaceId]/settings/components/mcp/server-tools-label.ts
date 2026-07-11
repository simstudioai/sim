import type { McpServer } from '@/lib/api/contracts/mcp'

interface NamedTool {
  name: string
}

export function getServerToolsLabel(
  tools: NamedTool[],
  connectionStatus?: McpServer['connectionStatus'],
  lastError?: McpServer['lastError']
): string {
  if (connectionStatus === 'error') {
    return lastError?.trim() || 'Unable to connect'
  }

  const count = tools.length
  const plural = count !== 1 ? 's' : ''
  const names = count > 0 ? `: ${tools.map((tool) => tool.name).join(', ')}` : ''
  return `${count} tool${plural}${names}`
}
